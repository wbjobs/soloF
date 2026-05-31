import yaml
import os
from dataclasses import dataclass
from typing import List


@dataclass
class NodeConfig:
    id: str
    host: str
    port: int
    data_file: str

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}"


def load_nodes(config_path: str = "nodes.yaml") -> List[NodeConfig]:
    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    nodes = []
    for node_data in config.get("nodes", []):
        data_file = node_data["data_file"]
        if not os.path.isabs(data_file):
            data_file = os.path.join(os.path.dirname(config_path), data_file)
        nodes.append(NodeConfig(
            id=node_data["id"],
            host=node_data["host"],
            port=node_data["port"],
            data_file=data_file
        ))
    return nodes
