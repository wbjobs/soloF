import json
import time
import signal
import traceback
import multiprocessing
from typing import Dict, Any, Callable, Optional

from RestrictedPython import compile_restricted, safe_globals
from RestrictedPython.Eval import default_guarded_getiter
from RestrictedPython.PrintCollector import PrintCollector

from utils.config import config
from utils.logger import get_logger

logger = get_logger(__name__)


class AlgorithmSandbox:
    BUILTINS_ALLOWED = {
        'abs': abs, 'all': all, 'any': any, 'bool': bool,
        'dict': dict, 'float': float, 'int': int, 'len': len,
        'list': list, 'max': max, 'min': min, 'pow': pow,
        'range': range, 'round': round, 'set': set, 'sorted': sorted,
        'str': str, 'sum': sum, 'tuple': tuple,
    }

    MODULES_ALLOWED = {
        'math': __import__('math'),
        'json': __import__('json'),
        'random': __import__('random'),
        'statistics': __import__('statistics'),
    }

    def __init__(self, timeout: int = None, memory_limit: str = None):
        self.timeout = timeout or config.SANDBOX_TIMEOUT
        self.memory_limit = memory_limit or config.SANDBOX_MEMORY_LIMIT

    def _build_safe_globals(self) -> Dict[str, Any]:
        safe_builtins = self.BUILTINS_ALLOWED.copy()
        safe_builtins['_getiter_'] = default_guarded_getiter
        safe_builtins['_print_'] = PrintCollector

        globals_dict = safe_globals.copy()
        globals_dict['__builtins__'] = safe_builtins
        globals_dict.update(self.MODULES_ALLOWED)

        return globals_dict

    def _run_in_process(self, script: str, graph_data: Dict[str, Any],
                        parameters: Dict[str, str],
                        result_queue: multiprocessing.Queue) -> None:
        try:
            locals_dict = {
                'graph': graph_data,
                'parameters': parameters,
                'result': None,
            }

            byte_code = compile_restricted(script, '<algorithm>', 'exec')
            safe_globals = self._build_safe_globals()

            exec(byte_code, safe_globals, locals_dict)

            result = locals_dict.get('result', {})
            result_queue.put(('success', result))

        except Exception as e:
            error_info = {
                'type': type(e).__name__,
                'message': str(e),
                'traceback': traceback.format_exc()
            }
            result_queue.put(('error', error_info))

    def execute(self, script: str, graph_data: Dict[str, Any],
                parameters: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        parameters = parameters or {}
        result_queue = multiprocessing.Queue()

        process = multiprocessing.Process(
            target=self._run_in_process,
            args=(script, graph_data, parameters, result_queue)
        )

        start_time = time.time()
        process.start()
        process.join(timeout=self.timeout)

        if process.is_alive():
            process.terminate()
            process.join(timeout=5)
            if process.is_alive():
                process.kill()
            return {
                'status': config.TASK_STATUS_TIMEOUT,
                'error': f'Script execution timed out after {self.timeout} seconds',
                'execution_time': time.time() - start_time
            }

        if not result_queue.empty():
            status, data = result_queue.get()
            if status == 'success':
                return {
                    'status': config.TASK_STATUS_SUCCESS,
                    'result': data,
                    'execution_time': time.time() - start_time
                }
            else:
                return {
                    'status': config.TASK_STATUS_FAILED,
                    'error': data,
                    'execution_time': time.time() - start_time
                }
        else:
            return {
                'status': config.TASK_STATUS_FAILED,
                'error': {'type': 'UnknownError', 'message': 'No result returned from sandbox'},
                'execution_time': time.time() - start_time
            }


def validate_algorithm_script(script: str) -> Dict[str, Any]:
    dangerous_patterns = [
        'import os', 'import sys', 'import subprocess',
        '__import__', 'exec(', 'eval(', 'open(',
        'file(', 'input(', '__', 'exit(', 'quit(',
        'os.', 'sys.', 'subprocess.',
        'while True', 'while 1',
    ]

    for pattern in dangerous_patterns:
        if pattern in script:
            return {
                'valid': False,
                'error': f'Forbidden pattern detected: {pattern}'
            }

    if 'result' not in script:
        return {
            'valid': False,
            'error': 'Script must assign result to variable "result"'
        }

    try:
        compile_restricted(script, '<validate>', 'exec')
        return {'valid': True}
    except SyntaxError as e:
        return {
            'valid': False,
            'error': f'Syntax error: {str(e)}'
        }
    except Exception as e:
        return {
            'valid': False,
            'error': f'Validation error: {str(e)}'
        }
