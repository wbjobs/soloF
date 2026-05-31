import json
import os
import re
from pathlib import Path
from typing import Optional


class PathResolver:
    JS_TS_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']
    INDEX_FILES = ['index.js', 'index.jsx', 'index.ts', 'index.tsx', 'index.mjs']

    def __init__(self, project_root: str):
        self.project_root = os.path.abspath(project_root)
        self.path_aliases = {}
        self.base_url = None
        self._load_tsconfig()

    def _load_tsconfig(self):
        tsconfig_path = os.path.join(self.project_root, "tsconfig.json")
        if os.path.exists(tsconfig_path):
            try:
                with open(tsconfig_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                content = self._strip_comments(content)
                config = json.loads(content)
                compiler_options = config.get("compilerOptions", {})
                self.base_url = compiler_options.get("baseUrl")
                paths = compiler_options.get("paths", {})
                for alias, mappings in paths.items():
                    cleaned_alias = alias.rstrip("/*")
                    for mapping in mappings:
                        cleaned_mapping = mapping.rstrip("/*")
                        self.path_aliases[cleaned_alias] = cleaned_mapping
            except (json.JSONDecodeError, IOError):
                pass

        jsconfig_path = os.path.join(self.project_root, "jsconfig.json")
        if os.path.exists(jsconfig_path):
            try:
                with open(jsconfig_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                content = self._strip_comments(content)
                config = json.loads(content)
                compiler_options = config.get("compilerOptions", {})
                if not self.base_url:
                    self.base_url = compiler_options.get("baseUrl")
                paths = compiler_options.get("paths", {})
                for alias, mappings in paths.items():
                    cleaned_alias = alias.rstrip("/*")
                    for mapping in mappings:
                        cleaned_mapping = mapping.rstrip("/*")
                        if cleaned_alias not in self.path_aliases:
                            self.path_aliases[cleaned_alias] = cleaned_mapping
            except (json.JSONDecodeError, IOError):
                pass

    @staticmethod
    def _strip_comments(content: str) -> str:
        content = re.sub(r'//.*', '', content)
        content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
        return content

    def is_relative_import(self, source: str) -> bool:
        return source.startswith('.')

    def is_absolute_import(self, source: str) -> bool:
        return source.startswith('/')

    def is_npm_package(self, source: str) -> bool:
        if source.startswith('.') or source.startswith('/'):
            return False
        if source.startswith('@'):
            return True
        return not any(source.startswith(alias) for alias in self.path_aliases)

    def resolve_path_alias(self, source: str) -> Optional[str]:
        if self.path_aliases:
            for alias, mapping in self.path_aliases.items():
                if source == alias:
                    return os.path.join(self.project_root, mapping)
                if source.startswith(alias + '/'):
                    suffix = source[len(alias) + 1:]
                    return os.path.join(self.project_root, mapping, suffix)
        return None

    def resolve_import(self, source: str, current_file: str) -> dict:
        result = {
            "source": source,
            "resolved_path": None,
            "is_external": False,
            "package_name": None
        }

        if self.is_npm_package(source):
            package_name = source.split('/')[0]
            if source.startswith('@') and '/' in source:
                parts = source.split('/')
                package_name = parts[0] + '/' + parts[1]
            result["is_external"] = True
            result["package_name"] = package_name
            result["resolved_path"] = source
            return result

        if self.is_relative_import(source):
            current_dir = os.path.dirname(current_file)
            base_path = os.path.normpath(os.path.join(current_dir, source))
        elif self.is_absolute_import(source):
            base_path = os.path.normpath(source)
        else:
            alias_path = self.resolve_path_alias(source)
            if alias_path:
                base_path = alias_path
            else:
                package_name = source.split('/')[0]
                if source.startswith('@') and '/' in source:
                    parts = source.split('/')
                    package_name = parts[0] + '/' + parts[1]
                result["is_external"] = True
                result["package_name"] = package_name
                result["resolved_path"] = source
                return result

        resolved = self._resolve_file_path(base_path)
        if resolved:
            result["resolved_path"] = os.path.relpath(resolved, self.project_root)
        else:
            result["resolved_path"] = os.path.relpath(base_path, self.project_root)
            result["is_external"] = False

        return result

    def _resolve_file_path(self, base_path: str) -> Optional[str]:
        if os.path.isfile(base_path):
            return base_path

        for ext in self.JS_TS_EXTENSIONS:
            candidate = base_path + ext
            if os.path.isfile(candidate):
                return candidate

        for index_file in self.INDEX_FILES:
            candidate = os.path.join(base_path, index_file)
            if os.path.isfile(candidate):
                return candidate

        return None

    def get_all_js_ts_files(self) -> list:
        files = []
        exclude_dirs = {
            'node_modules', '.git', 'dist', 'build', '.next',
            '.nuxt', 'coverage', '.cache', '__pycache__'
        }
        for root, dirs, filenames in os.walk(self.project_root):
            dirs[:] = [d for d in dirs if d not in exclude_dirs and not d.startswith('.')]
            for filename in filenames:
                if any(filename.endswith(ext) for ext in self.JS_TS_EXTENSIONS):
                    rel_path = os.path.relpath(
                        os.path.join(root, filename), self.project_root
                    )
                    files.append(rel_path)
        return sorted(files)
