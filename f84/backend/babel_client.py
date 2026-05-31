import subprocess
import json
import os
from typing import Optional
from config import settings
from schemas import ParseResult


class BabelClient:
    def __init__(self, parser_dir: Optional[str] = None):
        self.parser_dir = parser_dir or settings.BABEL_PARSER_DIR
        self._node_available = None
        self._parser_script = os.path.join(self.parser_dir, "parse.js")

    def check_node_available(self) -> bool:
        if self._node_available is None:
            try:
                subprocess.run(["node", "--version"], capture_output=True, check=True)
                self._node_available = True
            except (FileNotFoundError, subprocess.CalledProcessError):
                self._node_available = False
        return self._node_available

    def parse_file(self, file_path: str) -> ParseResult:
        if not os.path.exists(file_path):
            return ParseResult(file=file_path, error="File not found")

        if not os.path.exists(self._parser_script):
            return ParseResult(file=file_path, error="Babel parser script not found")

        try:
            result = subprocess.run(
                ["node", self._parser_script, file_path],
                capture_output=True,
                text=True,
                timeout=30,
                cwd=self.parser_dir
            )
            if result.returncode != 0:
                error_msg = result.stderr.strip() or "Unknown parsing error"
                return ParseResult(file=file_path, error=error_msg)

            output = result.stdout.strip()
            if not output:
                return ParseResult(file=file_path, error="Empty parser output")

            data = json.loads(output)
            if "error" in data:
                return ParseResult(file=file_path, error=data["error"])

            return ParseResult(**data)

        except subprocess.TimeoutExpired:
            return ParseResult(file=file_path, error="Parsing timed out")
        except json.JSONDecodeError as e:
            return ParseResult(file=file_path, error=f"Invalid JSON: {e}")
        except Exception as e:
            return ParseResult(file=file_path, error=str(e))
