export function extractPathFromRecursive(data, fromId, toId) {
  if (!data || !data.shortestPath || data.shortestPath.length === 0) {
    return null;
  }

  const startNode = data.shortestPath[0];

  const adjacencyList = new Map();
  const edgeMap = new Map();

  function buildGraph(node, visited = new Set()) {
    if (!node || visited.has(node.id)) return;
    visited.add(node.id);

    if (!adjacencyList.has(node.id)) {
      adjacencyList.set(node.id, []);
    }

    if (node.outEdges) {
      for (const edge of node.outEdges) {
        if (edge.to && edge.to.id) {
          adjacencyList.get(node.id).push(edge.to.id);
          edgeMap.set(`${node.id}-${edge.to.id}`, edge.id);
          buildGraph(edge.to, visited);
        }
      }
    }
  }

  buildGraph(startNode);

  const path = bfs(adjacencyList, fromId, toId);
  if (!path) return null;

  const pathEdges = [];
  for (let i = 0; i < path.length - 1; i++) {
    const edgeId = edgeMap.get(`${path[i]}-${path[i + 1]}`);
    if (edgeId) {
      pathEdges.push(edgeId);
    }
  }

  return {
    nodes: path,
    edges: pathEdges,
  };
}

function bfs(adjacencyList, start, end) {
  const queue = [[start]];
  const visited = new Set([start]);

  while (queue.length > 0) {
    const path = queue.shift();
    const node = path[path.length - 1];

    if (node === end) {
      return path;
    }

    const neighbors = adjacencyList.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }

  return null;
}

export function findPathLocally(nodes, edges, fromName, toName) {
  const fromNode = nodes.find(n => n.name === fromName);
  const toNode = nodes.find(n => n.name === toName);

  if (!fromNode || !toNode) {
    return null;
  }

  const adjacencyList = new Map();
  const edgeMap = new Map();

  for (const node of nodes) {
    adjacencyList.set(node.id, []);
  }

  for (const edge of edges) {
    const fromId = typeof edge.from === 'object' ? edge.from.id : edge.from;
    const toId = typeof edge.to === 'object' ? edge.to.id : edge.to;
    adjacencyList.get(fromId).push(toId);
    edgeMap.set(`${fromId}-${toId}`, edge.id);
  }

  const path = bfs(adjacencyList, fromNode.id, toNode.id);
  if (!path) return null;

  const pathEdges = [];
  for (let i = 0; i < path.length - 1; i++) {
    const edgeId = edgeMap.get(`${path[i]}-${path[i + 1]}`);
    if (edgeId) {
      pathEdges.push(edgeId);
    }
  }

  return {
    nodes: path,
    edges: pathEdges,
    fromNode,
    toNode,
  };
}
