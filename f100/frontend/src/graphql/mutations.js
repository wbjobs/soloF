import { gql } from '@apollo/client';

export const ADD_NODE = gql`
  mutation AddNode($name: String!, $owner: String!) {
    addNode(input: [{ name: $name, owner: $owner }]) {
      numUids
      node {
        id
        name
        owner
      }
    }
  }
`;

export const ADD_EDGE = gql`
  mutation AddEdge($fromId: ID!, $toId: ID!, $owner: String!, $weight: Float) {
    addEdge(input: [{ from: { id: $fromId }, to: { id: $toId }, owner: $owner, weight: $weight }]) {
      numUids
      edge {
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
  }
`;

export const ADD_EDGE_BY_NAME = gql`
  mutation AddEdgeByName($fromName: String!, $toName: String!, $owner: String!, $weight: Float) {
    addEdge(
      input: [
        {
          from: { name: $fromName, owner: $owner }
          to: { name: $toName, owner: $owner }
          owner: $owner
          weight: $weight
        }
      ]
    ) {
      numUids
      edge {
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
  }
`;

export const UPSERT_NODES = gql`
  mutation UpsertNodes($names: [String!]!, $owner: String!) {
    addNode(
      input: $names.map(name => { name: name, owner: $owner })
      upsert: true
    ) {
      numUids
      node {
        id
        name
        owner
      }
    }
  }
`;

export const BULK_IMPORT_EDGES = gql`
  mutation BulkImportEdges($edges: [AddEdgeInput!]!) {
    addEdge(input: $edges, upsert: true) {
      numUids
      edge {
        id
        from {
          id
          name
        }
        to {
          id
          name
        }
      }
    }
  }
`;

export const DELETE_NODE = gql`
  mutation DeleteNode($id: ID!, $owner: String!) {
    deleteNode(filter: { id: [$id], owner: { eq: $owner } }) {
      numUids
    }
  }
`;

export const DELETE_EDGE = gql`
  mutation DeleteEdge($id: ID!, $owner: String!) {
    deleteEdge(filter: { id: [$id], owner: { eq: $owner } }) {
      numUids
    }
  }
`;

export const ADD_USER = gql`
  mutation AddUser($username: String!, $password: String!, $role: String) {
    addUser(input: [{ username: $username, password: $password, role: $role }]) {
      numUids
      user {
        username
        role
      }
    }
  }
`;

export const LOGIN = gql`
  query Login($username: String!, $password: String!) {
    queryUser(filter: { username: { eq: $username }, password: { eq: $password } }) {
      username
      role
    }
  }
`;
