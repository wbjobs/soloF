import { gql } from '@apollo/client';

export const GET_ALL_NODES_AND_EDGES = gql`
  query GetAllNodesAndEdges($owner: String!) {
    queryNode(filter: { owner: { eq: $owner } }) {
      id
      name
      owner
    }
    queryEdge(filter: { owner: { eq: $owner } }) {
      id
      from {
        id
        name
      }
      to {
        id
        name
      }
      weight
    }
  }
`;

export const GET_NODE_BY_NAME = gql`
  query GetNodeByName($name: String!, $owner: String!) {
    queryNode(filter: { name: { eq: $name }, owner: { eq: $owner } }) {
      id
      name
      owner
    }
  }
`;

export const GET_NEIGHBORS = gql`
  query GetNeighbors($nodeId: ID!, $owner: String!) {
    queryNode(filter: { id: [$nodeId], owner: { eq: $owner } }) {
      id
      name
      outEdges(filter: { owner: { eq: $owner } }) {
        id
        to(filter: { owner: { eq: $owner } }) {
          id
          name
          owner
        }
        weight
      }
      inEdges(filter: { owner: { eq: $owner } }) {
        id
        from(filter: { owner: { eq: $owner } }) {
          id
          name
          owner
        }
        weight
      }
    }
  }
`;

export const GET_NEIGHBOR_SUBGRAPH = gql`
  query GetNeighborSubgraph($nodeId: ID!, $owner: String!) {
    queryNode(filter: { id: [$nodeId], owner: { eq: $owner } }) {
      id
      name
      outEdges(filter: { owner: { eq: $owner } }) {
        id
        to(filter: { owner: { eq: $owner } }) {
          id
          name
          owner
        }
        weight
      }
      inEdges(filter: { owner: { eq: $owner } }) {
        id
        from(filter: { owner: { eq: $owner } }) {
          id
          name
          owner
        }
        weight
      }
    }
  }
`;

export const FIND_SHORTEST_PATH = gql`
  query FindShortestPath($fromId: ID!, $toId: ID!, $owner: String!) {
    shortestPath: queryNode(
      filter: { id: [$fromId], owner: { eq: $owner } }
    ) @recurse(depth: 10, loop: false) {
      id
      name
      outEdges(filter: { owner: { eq: $owner } }) {
        id
        to(filter: { owner: { eq: $owner } }) {
          id
          name
        }
      }
    }
  }
`;

export const FIND_PATH_BFS = gql`
  query FindPathBFS($fromName: String!, $toName: String!, $owner: String!) {
    fromNode: queryNode(filter: { name: { eq: $fromName }, owner: { eq: $owner } }) {
      id
      name
    }
    toNode: queryNode(filter: { name: { eq: $toName }, owner: { eq: $owner } }) {
      id
      name
    }
  }
`;
