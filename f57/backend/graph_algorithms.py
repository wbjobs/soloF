import networkx as nx
import community as community_louvain
from neo4j import GraphDatabase
from config import NEO4J_CONFIG


class GraphAnalyzer:
    def __init__(self, uri, user, password, database="neo4j"):
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        self.database = database

    def close(self):
        self.driver.close()

    def get_graph_data(self, start_time=None, end_time=None):
        with self.driver.session(database=self.database) as session:
            if start_time and end_time:
                result = session.execute_read(
                    self._fetch_edges_in_time_range,
                    start_time, end_time
                )
            else:
                result = session.execute_read(self._fetch_all_edges)
            return result

    @staticmethod
    def _fetch_all_edges(tx):
        query = """
        MATCH (src:IP)-[c:COMMUNICATES]->(dst:IP)
        RETURN src.address AS src, dst.address AS dst,
               c.packets AS packets, c.bytes AS bytes,
               c.is_anomaly AS is_anomaly
        """
        result = tx.run(query)
        edges = []
        nodes = set()
        for record in result:
            edges.append({
                "source": record["src"],
                "target": record["dst"],
                "packets": record["packets"],
                "bytes": record["bytes"],
                "is_anomaly": record["is_anomaly"]
            })
            nodes.add(record["src"])
            nodes.add(record["dst"])
        return {"nodes": list(nodes), "edges": edges}

    @staticmethod
    def _fetch_edges_in_time_range(tx, start_time, end_time):
        query = """
        MATCH (src:IP)-[c:COMMUNICATES]->(dst:IP)
        WHERE c.timestamp >= datetime($start_time)
          AND c.timestamp <= datetime($end_time)
        RETURN src.address AS src, dst.address AS dst,
               c.packets AS packets, c.bytes AS bytes,
               c.is_anomaly AS is_anomaly
        """
        result = tx.run(query, start_time=start_time, end_time=end_time)
        edges = []
        nodes = set()
        for record in result:
            edges.append({
                "source": record["src"],
                "target": record["dst"],
                "packets": record["packets"],
                "bytes": record["bytes"],
                "is_anomaly": record["is_anomaly"]
            })
            nodes.add(record["src"])
            nodes.add(record["dst"])
        return {"nodes": list(nodes), "edges": edges}

    def get_time_range(self):
        with self.driver.session(database=self.database) as session:
            return session.execute_read(self._fetch_time_range)

    @staticmethod
    def _fetch_time_range(tx):
        query = """
        MATCH ()-[c:COMMUNICATES]->()
        RETURN min(c.timestamp) AS min_time,
               max(c.timestamp) AS max_time,
               count(c) AS total_edges
        """
        result = tx.run(query).single()
        if result["min_time"]:
            return {
                "min_time": result["min_time"].to_native().isoformat(),
                "max_time": result["max_time"].to_native().isoformat(),
                "total_edges": result["total_edges"]
            }
        return {
            "min_time": None,
            "max_time": None,
            "total_edges": 0
        }

    def get_time_slices(self, num_slices=10):
        time_range = self.get_time_range()
        if not time_range["min_time"]:
            return []

        from datetime import datetime, timedelta
        min_time = datetime.fromisoformat(time_range["min_time"])
        max_time = datetime.fromisoformat(time_range["max_time"])
        total_duration = max_time - min_time
        slice_duration = total_duration / num_slices

        slices = []
        for i in range(num_slices + 1):
            current_time = min_time + slice_duration * i
            slices.append({
                "index": i,
                "time": current_time.isoformat(),
                "label": current_time.strftime("%H:%M:%S")
            })

        return slices

    def build_networkx_graph(self, graph_data):
        G = nx.DiGraph()
        G.add_nodes_from(graph_data["nodes"])

        edge_dict = {}
        for edge in graph_data["edges"]:
            key = (edge["source"], edge["target"])
            if key in edge_dict:
                edge_dict[key]["weight"] += edge["bytes"]
                edge_dict[key]["is_anomaly"] = edge_dict[key]["is_anomaly"] or edge["is_anomaly"]
            else:
                edge_dict[key] = {
                    "weight": edge["bytes"],
                    "is_anomaly": edge["is_anomaly"]
                }

        edges_to_add = [
            (src, dst, data)
            for (src, dst), data in edge_dict.items()
        ]
        G.add_edges_from(edges_to_add)

        return G

    def calculate_pagerank(self, G, alpha=0.85, max_iter=100):
        node_count = G.number_of_nodes()
        if node_count > 2000:
            max_iter = 50
            alpha = 0.8
        elif node_count > 1000:
            max_iter = 75

        try:
            pagerank_scores = nx.pagerank(
                G,
                alpha=alpha,
                max_iter=max_iter,
                tol=1e-4
            )
        except:
            pagerank_scores = {node: 1.0 / node_count for node in G.nodes()}

        return pagerank_scores

    def detect_communities(self, G):
        node_count = G.number_of_nodes()
        undirected_G = G.to_undirected()

        if node_count > 1000:
            partition = {}
            for i, node in enumerate(undirected_G.nodes()):
                partition[node] = hash(node) % max(5, node_count // 200)
            return partition

        try:
            partition = community_louvain.best_partition(
                undirected_G,
                weight="weight",
                resolution=1.0
            )
        except:
            partition = {node: 0 for node in undirected_G.nodes()}

        return partition

    def aggregate_edges(self, edges, max_edges=2000):
        if len(edges) <= max_edges:
            return edges

        edge_groups = {}
        anomaly_edges = []

        for edge in edges:
            if edge["is_anomaly"]:
                anomaly_edges.append(edge)
                continue

            key = (edge["source"], edge["target"])
            if key in edge_groups:
                edge_groups[key]["packets"] += edge["packets"]
                edge_groups[key]["bytes"] += edge["bytes"]
            else:
                edge_groups[key] = dict(edge)

        aggregated = list(edge_groups.values())
        aggregated.sort(key=lambda x: x["bytes"], reverse=True)

        max_normal = max_edges - len(anomaly_edges)
        result = anomaly_edges + aggregated[:max_normal]

        return result

    def get_anomaly_nodes(self, graph_data):
        anomaly_nodes = set()
        for edge in graph_data["edges"]:
            if edge["is_anomaly"]:
                anomaly_nodes.add(edge["source"])
                anomaly_nodes.add(edge["target"])
        return list(anomaly_nodes)

    def get_node_degrees(self, G):
        degrees = {}
        for node in G.nodes():
            degrees[node] = {
                "in_degree": G.in_degree(node),
                "out_degree": G.out_degree(node),
                "total_degree": G.degree(node)
            }
        return degrees

    def analyze_full_graph(self, start_time=None, end_time=None):
        graph_data = self.get_graph_data(start_time=start_time, end_time=end_time)

        if not graph_data["nodes"]:
            return {
                "nodes": [],
                "edges": [],
                "pagerank": {},
                "communities": {},
                "anomaly_nodes": [],
                "degrees": {},
                "statistics": {
                    "total_nodes": 0,
                    "total_edges": 0,
                    "num_communities": 0
                }
            }

        G = self.build_networkx_graph(graph_data)

        pagerank_scores = self.calculate_pagerank(G)
        communities = self.detect_communities(G)
        anomaly_nodes = self.get_anomaly_nodes(graph_data)
        degrees = self.get_node_degrees(G)

        unique_communities = set(communities.values())

        nodes_with_attrs = []
        for node in graph_data["nodes"]:
            nodes_with_attrs.append({
                "id": node,
                "pagerank": pagerank_scores.get(node, 0),
                "community": communities.get(node, 0),
                "is_anomaly": node in anomaly_nodes,
                "in_degree": degrees[node]["in_degree"],
                "out_degree": degrees[node]["out_degree"],
                "total_degree": degrees[node]["total_degree"]
            })

        aggregated_edges = self.aggregate_edges(graph_data["edges"], max_edges=3000)

        return {
            "nodes": nodes_with_attrs,
            "edges": aggregated_edges,
            "pagerank": pagerank_scores,
            "communities": communities,
            "anomaly_nodes": anomaly_nodes,
            "degrees": degrees,
            "statistics": {
                "total_nodes": len(graph_data["nodes"]),
                "total_edges": len(graph_data["edges"]),
                "display_edges": len(aggregated_edges),
                "num_communities": len(unique_communities),
                "num_anomaly_nodes": len(anomaly_nodes)
            }
        }

    def get_top_pagerank_nodes(self, n=10):
        analysis = self.analyze_full_graph()
        sorted_nodes = sorted(
            analysis["nodes"],
            key=lambda x: x["pagerank"],
            reverse=True
        )[:n]
        return sorted_nodes

    def get_community_summary(self):
        analysis = self.analyze_full_graph()
        communities = analysis["communities"]

        community_stats = {}
        for node, comm_id in communities.items():
            if comm_id not in community_stats:
                community_stats[comm_id] = {"nodes": [], "size": 0}
            community_stats[comm_id]["nodes"].append(node)
            community_stats[comm_id]["size"] += 1

        sorted_communities = sorted(
            community_stats.items(),
            key=lambda x: x[1]["size"],
            reverse=True
        )

        return [
            {
                "community_id": comm_id,
                "size": stats["size"],
                "nodes": stats["nodes"]
            }
            for comm_id, stats in sorted_communities
        ]


def run_analysis():
    print("Connecting to Neo4j...")
    analyzer = GraphAnalyzer(
        uri=NEO4J_CONFIG["uri"],
        user=NEO4J_CONFIG["user"],
        password=NEO4J_CONFIG["password"],
        database=NEO4J_CONFIG["database"]
    )

    try:
        print("Running graph analysis...")
        result = analyzer.analyze_full_graph()

        print(f"\n=== Graph Statistics ===")
        print(f"Total Nodes: {result['statistics']['total_nodes']}")
        print(f"Total Edges: {result['statistics']['total_edges']}")
        print(f"Number of Communities: {result['statistics']['num_communities']}")
        print(f"Anomaly Nodes: {result['statistics']['num_anomaly_nodes']}")

        print(f"\n=== Top 10 PageRank Nodes ===")
        top_nodes = analyzer.get_top_pagerank_nodes(10)
        for i, node in enumerate(top_nodes, 1):
            print(f"{i}. {node['id']}: PageRank={node['pagerank']:.6f}, "
                  f"Community={node['community']}, Anomaly={node['is_anomaly']}")

        print(f"\n=== Community Summary ===")
        communities = analyzer.get_community_summary()
        for comm in communities:
            print(f"Community {comm['community_id']}: {comm['size']} nodes")

        return result

    finally:
        analyzer.close()


if __name__ == "__main__":
    run_analysis()
