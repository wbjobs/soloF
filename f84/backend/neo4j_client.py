from neo4j import GraphDatabase, Driver
from typing import Optional
from config import settings


class Neo4jClient:
    _instance: Optional["Neo4jClient"] = None
    _driver: Optional[Driver] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @classmethod
    def connect(cls):
        if cls._driver is None:
            cls._driver = GraphDatabase.driver(
                settings.NEO4J_URI,
                auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD)
            )
            cls._driver.verify_connectivity()
        return cls._driver

    @classmethod
    def close(cls):
        if cls._driver is not None:
            cls._driver.close()
            cls._driver = None

    @classmethod
    def get_driver(cls) -> Driver:
        return cls.connect()

    @classmethod
    def run_query(cls, query: str, params: dict = None) -> list:
        driver = cls.get_driver()
        with driver.session() as session:
            result = session.run(query, params or {})
            return [record.data() for record in result]

    @classmethod
    def run_query_single(cls, query: str, params: dict = None) -> Optional[dict]:
        results = cls.run_query(query, params)
        return results[0] if results else None

    @classmethod
    def create_file_node(cls, file_path: str, exports: list = None, is_external: bool = False,
                         package_name: str = None):
        exports = exports or []
        query = """
        MERGE (f:File {path: $path})
        SET f.is_external = $is_external,
            f.package_name = $package_name,
            f.exports = $exports
        RETURN f
        """
        return cls.run_query_single(query, {
            "path": file_path,
            "is_external": is_external,
            "package_name": package_name,
            "exports": exports
        })

    @classmethod
    def create_dependency(cls, source: str, target: str, dep_type: str = "import",
                          specifiers: list = None):
        specifiers = specifiers or []
        query = """
        MATCH (a:File {path: $source})
        MATCH (b:File {path: $target})
        MERGE (a)-[r:DEPENDS_ON {type: $dep_type}]->(b)
        SET r.specifiers = $specifiers
        RETURN a, b, r
        """
        return cls.run_query(query, {
            "source": source,
            "target": target,
            "dep_type": dep_type,
            "specifiers": specifiers
        })

    @classmethod
    def get_references(cls, file_path: str) -> list:
        query = """
        MATCH (ref:File)-[r:DEPENDS_ON]->(target:File {path: $path})
        RETURN ref.path AS file, collect({type: r.type, specifiers: r.specifiers}) AS references
        """
        return cls.run_query(query, {"path": file_path})

    @classmethod
    def get_references_recursive(cls, file_path: str, max_depth: int = 5) -> list:
        query = """
        MATCH (target:File {path: $path})
        MATCH path = (ref:File)-[:DEPENDS_ON*1..%d]->(target)
        WHERE ALL(n IN nodes(path) WHERE n <> target OR n = target)
        WITH DISTINCT ref, length(path) AS depth
        ORDER BY depth
        RETURN DISTINCT ref.path AS file, depth
        """ % max_depth
        return cls.run_query(query, {"path": file_path})

    @classmethod
    def check_cycle(cls, file_a: str, file_b: str) -> dict:
        query = """
        MATCH (a:File {path: $file_a})
        MATCH (b:File {path: $file_b})
        MATCH path1 = (a)-[:DEPENDS_ON*1..10]->(b)
        MATCH path2 = (b)-[:DEPENDS_ON*1..10]->(a)
        RETURN [n IN nodes(path1) | n.path] AS path_a_to_b,
               [n IN nodes(path2) | n.path] AS path_b_to_a
        LIMIT 1
        """
        result = cls.run_query(query, {"file_a": file_a, "file_b": file_b})
        if result:
            return {
                "has_cycle": True,
                "path_a_to_b": result[0].get("path_a_to_b", []),
                "path_b_to_a": result[0].get("path_b_to_a", [])
            }
        return {"has_cycle": False, "path_a_to_b": [], "path_b_to_a": []}

    @classmethod
    def get_impact_analysis(cls, file_path: str, max_depth: int = 10) -> dict:
        direct_query = """
        MATCH (target:File {path: $path})<-[:DEPENDS_ON]-(ref:File)
        RETURN ref.path AS file
        """
        direct = cls.run_query(direct_query, {"path": file_path})
        direct_files = [r["file"] for r in direct]

        transitive_query = """
        MATCH (target:File {path: $path})
        MATCH path = (ref:File)-[:DEPENDS_ON*2..%d]->(target)
        WHERE ref.path <> $path
        WITH DISTINCT ref, length(path) AS depth
        WHERE NOT ref.path IN $direct_files
        RETURN DISTINCT ref.path AS file, depth
        ORDER BY depth
        """ % max_depth
        transitive = cls.run_query(transitive_query, {
            "path": file_path,
            "direct_files": direct_files
        })

        return {
            "directly_impacted": [{"file": f} for f in direct_files],
            "transitively_impacted": transitive,
            "total_impacted": len(direct_files) + len(transitive)
        }

    @classmethod
    def get_all_files(cls) -> list:
        query = """
        MATCH (f:File)
        RETURN f.path AS path, f.is_external AS is_external, f.package_name AS package_name
        ORDER BY f.is_external, f.path
        """
        return cls.run_query(query)

    @classmethod
    def get_graph_data(cls) -> dict:
        nodes_query = """
        MATCH (f:File)
        RETURN f.path AS id, f.is_external AS is_external, f.package_name AS package_name
        """
        edges_query = """
        MATCH (a:File)-[r:DEPENDS_ON]->(b:File)
        RETURN a.path AS source, b.path AS target, r.type AS type
        """
        nodes = cls.run_query(nodes_query)
        edges = cls.run_query(edges_query)
        return {"nodes": nodes, "edges": edges}

    @classmethod
    def get_stats(cls) -> dict:
        query = """
        MATCH (f:File)
        WITH count(f) AS total_files,
             sum(CASE WHEN f.is_external THEN 1 ELSE 0 END) AS external_count
        MATCH ()-[r:DEPENDS_ON]->()
        RETURN total_files, count(r) AS total_dependencies, external_count AS external_packages
        """
        result = cls.run_query_single(query) or {}
        return {
            "total_files": result.get("total_files", 0),
            "total_dependencies": result.get("total_dependencies", 0),
            "external_packages": result.get("external_packages", 0)
        }

    @classmethod
    def clear_graph(cls):
        query = "MATCH (n) DETACH DELETE n"
        cls.run_query(query)
