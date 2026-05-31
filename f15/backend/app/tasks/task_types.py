from app.celery_app import celery
from app.tasks.base_task import BaseTask
import subprocess
import sys
import io
import requests
import json
from celery.utils.log import get_task_logger

logger = get_task_logger(__name__)

@celery.task(base=BaseTask, bind=True, name='tasks.execute_shell')
def execute_shell(self, script: str, timeout: int = 600):
    logger.info(f"Executing shell task: {script[:50]}...")
    try:
        result = subprocess.run(
            script,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return {
            'success': result.returncode == 0,
            'stdout': result.stdout,
            'stderr': result.stderr,
            'returncode': result.returncode
        }
    except subprocess.TimeoutExpired:
        logger.error(f"Shell task timeout after {timeout}s")
        raise Exception(f"Task timeout after {timeout} seconds")
    except Exception as e:
        logger.error(f"Shell task error: {str(e)}")
        raise

@celery.task(base=BaseTask, bind=True, name='tasks.execute_python')
def execute_python(self, script: str, timeout: int = 600):
    logger.info("Executing Python script task...")
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    redirected_output = sys.stdout = io.StringIO()
    redirected_error = sys.stderr = io.StringIO()
    
    try:
        exec(script, {'__name__': '__main__'})
        sys.stdout = old_stdout
        sys.stderr = old_stderr
        return {
            'success': True,
            'stdout': redirected_output.getvalue(),
            'stderr': redirected_error.getvalue()
        }
    except Exception as e:
        sys.stdout = old_stdout
        sys.stderr = old_stderr
        logger.error(f"Python task error: {str(e)}")
        raise
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr

@celery.task(base=BaseTask, bind=True, name='tasks.execute_http')
def execute_http(self, url: str, method: str = 'GET', headers: dict = None, 
                 body: dict = None, timeout: int = 60):
    logger.info(f"Executing HTTP {method} request to: {url}")
    try:
        response = requests.request(
            method=method.upper(),
            url=url,
            headers=headers or {},
            json=body,
            timeout=timeout
        )
        try:
            response_body = response.json()
        except:
            response_body = response.text
        
        return {
            'success': response.status_code < 400,
            'status_code': response.status_code,
            'headers': dict(response.headers),
            'body': response_body
        }
    except requests.Timeout:
        logger.error(f"HTTP request timeout")
        raise Exception("HTTP request timeout")
    except Exception as e:
        logger.error(f"HTTP request error: {str(e)}")
        raise