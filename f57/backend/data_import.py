import random
import ipaddress
import pandas as pd
from neo4j import GraphDatabase
from datetime import datetime, timedelta
from config import NEO4J_CONFIG, NETFLOW_CONFIG


class NetFlowGenerator:
    def __init__(self, num_nodes=50, num_edges=200, anomaly_ratio=0.1):
        self.num_nodes = num_nodes
        self.num_edges = num_edges
        self.anomaly_ratio = anomaly_ratio
        self.ip_addresses = self._generate_ips()

    def _generate_ips(self):
        ips = []
        for i in range(self.num_nodes):
            ip = f"192.168.{random.randint(0, 10)}.{random.randint(1, 254)}"
            ips.append(ip)
        return list(set(ips))[:self.num_nodes]

    def generate_netflow_data(self, time_window_hours=2):
        records = []
        end_time = datetime.now().replace(microsecond=0)
        start_time = end_time - timedelta(hours=time_window_hours)
        total_seconds = int(time_window_hours * 3600)

        normal_edges = int(self.num_edges * (1 - self.anomaly_ratio))
        anomaly_edges = self.num_edges - normal_edges

        normal_ip_pairs = {}
        for _ in range(normal_edges):
            src = random.choice(self.ip_addresses)
            dst = random.choice([ip for ip in self.ip_addresses if ip != src])
            pair_key = (src, dst)

            if pair_key not in normal_ip_pairs:
                base_offset = random.randint(0, total_seconds // 4)
                normal_ip_pairs[pair_key] = {
                    "base_offset": base_offset,
                    "burst_count": 0
                }

            pair_data = normal_ip_pairs[pair_key]
            offset = pair_data["base_offset"] + random.randint(-300, 300) + pair_data["burst_count"] * random.randint(10, 60)
            pair_data["burst_count"] += 1
            offset = max(0, min(total_seconds, offset))

            flow_time = start_time + timedelta(seconds=offset)

            records.append({
                "src_ip": src,
                "dst_ip": dst,
                "src_port": random.randint(1024, 65535),
                "dst_port": random.choice([80, 443, 22, 53, 8080]),
                "protocol": random.choice(["TCP", "UDP"]),
                "packets": random.randint(1, 100),
                "bytes": random.randint(64, 10000),
                "timestamp": flow_time,
                "is_anomaly": False
            })

        anomaly_sources = random.sample(self.ip_addresses, max(3, int(self.num_nodes * 0.1)))
        for _ in range(anomaly_edges):
            src = random.choice(anomaly_sources)
            dst = random.choice([ip for ip in self.ip_addresses if ip != src])

            burst_start = random.randint(total_seconds // 2, total_seconds - 600)
            offset = burst_start + random.randint(-120, 300)
            offset = max(0, min(total_seconds, offset))

            flow_time = start_time + timedelta(seconds=offset)

            records.append({
                "src_ip": src,
                "dst_ip": dst,
                "src_port": random.randint(1, 65535),
                "dst_port": random.randint(1, 1024),
                "protocol": random.choice(["TCP", "UDP", "ICMP"]),
                "packets": random.randint(1000, 10000),
                "bytes": random.randint(100000, 10000000),
                "timestamp": flow_time,
                "is_anomaly": True
            })

        df = pd.DataFrame(records)
        df = df.sort_values('timestamp').reset_index(drop=True)
        return df


class Neo4jImporter:
    def __init__(self, uri, user, password, database="neo4j"):
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        self.database = database

    def close(self):
        self.driver.close()

    def clear_database(self):
        with self.driver.session(database=self.database) as session:
            session.execute_write(self._clear_all)

    @staticmethod
    def _clear_all(tx):
        tx.run("MATCH (n) DETACH DELETE n")

    def import_netflow_data(self, df):
        with self.driver.session(database=self.database) as session:
            for _, row in df.iterrows():
                session.execute_write(
                    self._create_communication_edge,
                    dict(row)
                )

    @staticmethod
    def _create_communication_edge(tx, record):
        query = """
        MERGE (src:IP {address: $src_ip})
        MERGE (dst:IP {address: $dst_ip})
        CREATE (src)-[c:COMMUNICATES {
            src_port: $src_port,
            dst_port: $dst_port,
            protocol: $protocol,
            packets: $packets,
            bytes: $bytes,
            timestamp: datetime($timestamp),
            is_anomaly: $is_anomaly
        }]->(dst)
        """
        tx.run(query, **record)

    def create_indexes(self):
        with self.driver.session(database=self.database) as session:
            session.execute_write(self._create_ip_index)
            session.execute_write(self._create_timestamp_index)

    @staticmethod
    def _create_ip_index(tx):
        tx.run("CREATE INDEX ip_address IF NOT EXISTS FOR (n:IP) ON (n.address)")

    @staticmethod
    def _create_timestamp_index(tx):
        tx.run("CREATE INDEX edge_timestamp IF NOT EXISTS FOR ()-[c:COMMUNICATES]-() ON (c.timestamp)")


def generate_and_import_data():
    generator = NetFlowGenerator(
        num_nodes=NETFLOW_CONFIG["num_nodes"],
        num_edges=NETFLOW_CONFIG["num_edges"],
        anomaly_ratio=NETFLOW_CONFIG["anomaly_ratio"]
    )

    print("Generating NetFlow data...")
    df = generator.generate_netflow_data()
    print(f"Generated {len(df)} flow records")
    print(f"Anomaly records: {df['is_anomaly'].sum()}")

    print("\nConnecting to Neo4j...")
    importer = Neo4jImporter(
        uri=NEO4J_CONFIG["uri"],
        user=NEO4J_CONFIG["user"],
        password=NEO4J_CONFIG["password"],
        database=NEO4J_CONFIG["database"]
    )

    try:
        print("Creating indexes...")
        importer.create_indexes()

        print("Clearing existing data...")
        importer.clear_database()

        print("Importing data into Neo4j...")
        importer.import_netflow_data(df)
        print("Data import completed successfully!")

    finally:
        importer.close()

    return df


if __name__ == "__main__":
    generate_and_import_data()
