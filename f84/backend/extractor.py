import os
import asyncio
from typing import Optional, Callable
from babel_client import BabelClient
from resolver import PathResolver
from neo4j_client import Neo4jClient
from schemas import ParseResult, DependencyEdge, TaskProgress


class DependencyExtractor:
    def __init__(self, project_root: str, task_id: str = None,
                 progress_callback: Callable[[TaskProgress], None] = None,
                 cancel_check: Callable[[], bool] = None):
        self.project_root = os.path.abspath(project_root)
        self.babel_client = BabelClient()
        self.resolver = PathResolver(self.project_root)
        self.neo4j = Neo4jClient()
        self.task_id = task_id
        self.progress_callback = progress_callback
        self.cancel_check = cancel_check

    def _is_cancelled(self) -> bool:
        if self.cancel_check:
            try:
                return self.cancel_check()
            except Exception:
                return False
        return False

    def _update_progress(self, progress: TaskProgress):
        if self.progress_callback:
            try:
                self.progress_callback(progress)
            except Exception:
                pass

    def extract_all(self) -> dict:
        if self._is_cancelled():
            raise Exception("任务已取消")

        files = self.resolver.get_all_js_ts_files()
        total_files = len(files)

        results = {
            "files_scanned": total_files,
            "nodes_created": 0,
            "edges_created": 0,
            "errors": []
        }

        progress = TaskProgress(
            current_file=0,
            total_files=total_files,
            phase="scanning",
            message=f"发现 {total_files} 个文件，开始解析..."
        )
        self._update_progress(progress)

        all_dependencies = []
        file_exports = {}

        for idx, rel_path in enumerate(files, 1):
            if self._is_cancelled():
                raise Exception("任务已取消")

            progress = TaskProgress(
                current_file=idx,
                total_files=total_files,
                current_filename=rel_path,
                nodes_created=results["nodes_created"],
                edges_created=results["edges_created"],
                errors_count=len(results["errors"]),
                phase="parsing",
                message=f"[{idx}/{total_files}] 解析 {rel_path}"
            )
            self._update_progress(progress)

            full_path = os.path.join(self.project_root, rel_path)
            parse_result = self.babel_client.parse_file(full_path)

            if parse_result.error:
                results["errors"].append({
                    "file": rel_path,
                    "error": parse_result.error
                })
                continue

            export_data = []
            for exp in parse_result.exports:
                if exp.default:
                    export_data.append({"default": True})
                for spec in exp.specifiers:
                    export_data.append({
                        "name": spec.name,
                        "type": spec.type
                    })
            file_exports[rel_path] = export_data

            self.neo4j.create_file_node(
                file_path=rel_path,
                exports=export_data,
                is_external=False,
                package_name=None
            )
            results["nodes_created"] += 1

            deps = self._extract_dependencies(parse_result, rel_path)
            all_dependencies.extend(deps)

            if idx % 50 == 0 or idx == total_files:
                progress = TaskProgress(
                    current_file=idx,
                    total_files=total_files,
                    current_filename=rel_path,
                    nodes_created=results["nodes_created"],
                    edges_created=results["edges_created"],
                    errors_count=len(results["errors"]),
                    phase="parsing",
                    message=f"[{idx}/{total_files}] 已处理 {idx} 个文件"
                )
                self._update_progress(progress)

        if self._is_cancelled():
            raise Exception("任务已取消")

        progress = TaskProgress(
            current_file=total_files,
            total_files=total_files,
            nodes_created=results["nodes_created"],
            edges_created=results["edges_created"],
            errors_count=len(results["errors"]),
            phase="building_graph",
            message="构建依赖关系图..."
        )
        self._update_progress(progress)

        total_deps = len(all_dependencies)
        for dep_idx, dep in enumerate(all_dependencies, 1):
            if self._is_cancelled():
                raise Exception("任务已取消")

            if dep.is_external:
                self.neo4j.create_file_node(
                    file_path=dep.resolved_path,
                    exports=[],
                    is_external=True,
                    package_name=dep.package_name
                )
                results["nodes_created"] += 1

            self.neo4j.create_dependency(
                source=dep.source_file,
                target=dep.resolved_path,
                dep_type=dep.dependency_type,
                specifiers=dep.specifiers
            )
            results["edges_created"] += 1

            if dep_idx % 100 == 0 or dep_idx == total_deps:
                progress = TaskProgress(
                    current_file=total_files,
                    total_files=total_files,
                    nodes_created=results["nodes_created"],
                    edges_created=results["edges_created"],
                    errors_count=len(results["errors"]),
                    phase="building_graph",
                    message=f"[{dep_idx}/{total_deps}] 写入依赖关系 {dep_idx}/{total_deps}"
                )
                self._update_progress(progress)

        if self._is_cancelled():
            raise Exception("任务已取消")

        progress = TaskProgress(
            current_file=total_files,
            total_files=total_files,
            nodes_created=results["nodes_created"],
            edges_created=results["edges_created"],
            errors_count=len(results["errors"]),
            phase="completed",
            message=f"完成: {results['nodes_created']} 个节点, {results['edges_created']} 条边"
        )
        self._update_progress(progress)

        return results

    def _extract_dependencies(self, parse_result: ParseResult,
                               current_file: str) -> list[DependencyEdge]:
        edges = []

        for imp in parse_result.imports:
            resolved = self.resolver.resolve_import(imp.source, current_file)
            if resolved["resolved_path"]:
                edge = DependencyEdge(
                    source_file=current_file,
                    target_file=resolved["resolved_path"],
                    dependency_type="require" if imp.isRequire else "import",
                    specifiers=[{"type": s.type, "imported": s.imported, "local": s.local}
                                for s in imp.specifiers]
                )
                edge.is_external = resolved["is_external"]
                edge.package_name = resolved["package_name"]
                edge.resolved_path = resolved["resolved_path"]
                edges.append(edge)

        for reexp in parse_result.reexports:
            resolved = self.resolver.resolve_import(reexp.source, current_file)
            if resolved["resolved_path"]:
                edge = DependencyEdge(
                    source_file=current_file,
                    target_file=resolved["resolved_path"],
                    dependency_type="reexport",
                    specifiers=[{"exported": s.get("exported"), "local": s.get("local")}
                                for s in reexp.specifiers]
                )
                edge.is_external = resolved["is_external"]
                edge.package_name = resolved["package_name"]
                edge.resolved_path = resolved["resolved_path"]
                edges.append(edge)

        for dyn_imp in parse_result.dynamicImports:
            resolved = self.resolver.resolve_import(dyn_imp["source"], current_file)
            if resolved["resolved_path"]:
                edge = DependencyEdge(
                    source_file=current_file,
                    target_file=resolved["resolved_path"],
                    dependency_type="dynamic_import",
                    specifiers=[]
                )
                edge.is_external = resolved["is_external"]
                edge.package_name = resolved["package_name"]
                edge.resolved_path = resolved["resolved_path"]
                edges.append(edge)

        return edges


async def run_extraction_async(task_id: str, repo_path: str, task_manager):
    def cancel_check() -> bool:
        task = task_manager.get_task(task_id)
        return task is not None and task.status == "cancelled"

    def progress_callback(progress):
        task_manager.update_progress(task_id, progress, status="running")

    task_manager.update_status(task_id, "running", "开始分析...")

    try:
        loop = asyncio.get_event_loop()
        extractor = DependencyExtractor(
            project_root=repo_path,
            task_id=task_id,
            progress_callback=progress_callback,
            cancel_check=cancel_check
        )

        result = await loop.run_in_executor(None, extractor.extract_all)

        if cancel_check():
            return

        task_manager.set_result(task_id, result)
        return result

    except Exception as e:
        if cancel_check():
            task_manager.update_status(task_id, "cancelled", str(e))
        else:
            task_manager.set_error(task_id, str(e))
        raise
