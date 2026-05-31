#include "HeatSimulation2D/MeshRefiner.h"
#include <algorithm>
#include <cmath>

namespace HeatSimulation2D {

MeshRefiner::MeshRefiner(const Config& config) : config_(config) {}

Vector MeshRefiner::computeGradientMagnitude(const Mesh& mesh, const Vector& temperature) {
    Index numNodes = static_cast<Index>(mesh.nodes.size());
    Vector gradientMagnitude = Vector::Zero(numNodes);
    Vector nodeAreaWeights = Vector::Zero(numNodes);

    for (const auto& tri : mesh.triangles) {
        Index idx[3];
        for (int i = 0; i < 3; ++i) {
            idx[i] = mesh.nodeIdToIndex.at(tri.nodeIds[i]);
        }

        Scalar x[3], y[3], u[3];
        for (int i = 0; i < 3; ++i) {
            x[i] = mesh.nodes[idx[i]].x;
            y[i] = mesh.nodes[idx[i]].y;
            u[i] = temperature[idx[i]];
        }

        Scalar area = 0.5 * std::abs(
            (x[1] - x[0]) * (y[2] - y[0]) -
            (x[2] - x[0]) * (y[1] - y[0])
        );

        Scalar b[3], c[3];
        b[0] = y[1] - y[2];
        b[1] = y[2] - y[0];
        b[2] = y[0] - y[1];
        c[0] = x[2] - x[1];
        c[1] = x[0] - x[2];
        c[2] = x[1] - x[0];

        Scalar dudx = 0, dudy = 0;
        for (int i = 0; i < 3; ++i) {
            dudx += b[i] * u[i];
            dudy += c[i] * u[i];
        }
        dudx /= (2.0 * area);
        dudy /= (2.0 * area);

        Scalar gradMag = std::sqrt(dudx * dudx + dudy * dudy);

        for (int i = 0; i < 3; ++i) {
            gradientMagnitude[idx[i]] += gradMag * area;
            nodeAreaWeights[idx[i]] += area;
        }
    }

    for (Index i = 0; i < numNodes; ++i) {
        if (nodeAreaWeights[i] > 0) {
            gradientMagnitude[i] /= nodeAreaWeights[i];
        }
    }

    Scalar maxGrad = gradientMagnitude.maxCoeff();
    if (maxGrad > 0) {
        gradientMagnitude /= maxGrad;
    }

    return gradientMagnitude;
}

std::vector<bool> MeshRefiner::markElementsForRefinement(
    const Mesh& mesh,
    const Vector& gradientMagnitude
) const {
    std::vector<bool> marked(mesh.triangles.size(), false);

    for (size_t i = 0; i < mesh.triangles.size(); ++i) {
        const auto& tri = mesh.triangles[i];
        Scalar maxGrad = 0;
        for (int j = 0; j < 3; ++j) {
            Index idx = mesh.nodeIdToIndex.at(tri.nodeIds[j]);
            maxGrad = std::max(maxGrad, gradientMagnitude[idx]);
        }
        if (maxGrad > config_.refinementThreshold) {
            marked[i] = true;
        }
    }

    return marked;
}

Mesh MeshRefiner::refineMarkedElements(
    const Mesh& mesh,
    const std::vector<bool>& marked
) const {
    std::set<Edge> edgesToSplit;
    std::map<Edge, Index> edgeMidpointMap;

    for (size_t i = 0; i < mesh.triangles.size(); ++i) {
        if (marked[i]) {
            const auto& tri = mesh.triangles[i];
            edgesToSplit.insert(Edge(tri.nodeIds[0], tri.nodeIds[1]));
            edgesToSplit.insert(Edge(tri.nodeIds[1], tri.nodeIds[2]));
            edgesToSplit.insert(Edge(tri.nodeIds[2], tri.nodeIds[0]));
        }
    }

    bool changed;
    do {
        changed = false;
        for (size_t i = 0; i < mesh.triangles.size(); ++i) {
            if (marked[i]) continue;

            const auto& tri = mesh.triangles[i];
            int count = 0;
            if (edgesToSplit.count(Edge(tri.nodeIds[0], tri.nodeIds[1]))) count++;
            if (edgesToSplit.count(Edge(tri.nodeIds[1], tri.nodeIds[2]))) count++;
            if (edgesToSplit.count(Edge(tri.nodeIds[2], tri.nodeIds[0]))) count++;

            if (count >= 2) {
                edgesToSplit.insert(Edge(tri.nodeIds[0], tri.nodeIds[1]));
                edgesToSplit.insert(Edge(tri.nodeIds[1], tri.nodeIds[2]));
                edgesToSplit.insert(Edge(tri.nodeIds[2], tri.nodeIds[0]));
                changed = true;
            }
        }
    } while (changed);

    Mesh newMesh;
    newMesh.nodes = mesh.nodes;
    Index nextNodeId = 0;
    for (const auto& node : mesh.nodes) {
        nextNodeId = std::max(nextNodeId, node.id + 1);
        newMesh.nodeIdToIndex[node.id] = static_cast<Index>(newMesh.nodes.size() - 1);
    }

    for (const auto& edge : edgesToSplit) {
        const auto& nodeA = mesh.nodes[mesh.nodeIdToIndex.at(edge.a)];
        const auto& nodeB = mesh.nodes[mesh.nodeIdToIndex.at(edge.b)];

        Node newNode;
        newNode.id = nextNodeId++;
        newNode.x = 0.5 * (nodeA.x + nodeB.x);
        newNode.y = 0.5 * (nodeA.y + nodeB.y);

        newMesh.nodes.push_back(newNode);
        newMesh.nodeIdToIndex[newNode.id] = static_cast<Index>(newMesh.nodes.size() - 1);
        edgeMidpointMap[edge] = newNode.id;
    }

    Index nextTriId = 0;
    for (const auto& tri : mesh.triangles) {
        if (!nextTriId || tri.id >= nextTriId) {
            nextTriId = tri.id + 1;
        }
    }

    for (const auto& tri : mesh.triangles) {
        Index id0 = tri.nodeIds[0];
        Index id1 = tri.nodeIds[1];
        Index id2 = tri.nodeIds[2];

        bool hasMid01 = edgesToSplit.count(Edge(id0, id1));
        bool hasMid12 = edgesToSplit.count(Edge(id1, id2));
        bool hasMid20 = edgesToSplit.count(Edge(id2, id0));

        if (!hasMid01 && !hasMid12 && !hasMid20) {
            newMesh.triangles.push_back(tri);
        } else if (hasMid01 && hasMid12 && hasMid20) {
            Index mid01 = edgeMidpointMap[Edge(id0, id1)];
            Index mid12 = edgeMidpointMap[Edge(id1, id2)];
            Index mid20 = edgeMidpointMap[Edge(id2, id0)];

            newMesh.triangles.push_back({nextTriId++, {id0, mid01, mid20}});
            newMesh.triangles.push_back({nextTriId++, {mid01, id1, mid12}});
            newMesh.triangles.push_back({nextTriId++, {mid20, mid12, id2}});
            newMesh.triangles.push_back({nextTriId++, {mid01, mid12, mid20}});
        } else if (hasMid01 && !hasMid12 && !hasMid20) {
            Index mid01 = edgeMidpointMap[Edge(id0, id1)];
            newMesh.triangles.push_back({nextTriId++, {id0, mid01, id2}});
            newMesh.triangles.push_back({nextTriId++, {mid01, id1, id2}});
        } else if (hasMid12 && !hasMid01 && !hasMid20) {
            Index mid12 = edgeMidpointMap[Edge(id1, id2)];
            newMesh.triangles.push_back({nextTriId++, {id0, id1, mid12}});
            newMesh.triangles.push_back({nextTriId++, {id0, mid12, id2}});
        } else if (hasMid20 && !hasMid01 && !hasMid12) {
            Index mid20 = edgeMidpointMap[Edge(id2, id0)];
            newMesh.triangles.push_back({nextTriId++, {id0, id1, mid20}});
            newMesh.triangles.push_back({nextTriId++, {mid20, id1, id2}});
        } else {
            Index mid01 = edgeMidpointMap[Edge(id0, id1)];
            Index mid12 = edgeMidpointMap[Edge(id1, id2)];
            newMesh.triangles.push_back({nextTriId++, {id0, mid01, id2}});
            newMesh.triangles.push_back({nextTriId++, {mid01, mid12, id2}});
            newMesh.triangles.push_back({nextTriId++, {mid01, id1, mid12}});
        }
    }

    return newMesh;
}

Mesh MeshRefiner::refine(
    const Mesh& mesh,
    const Vector& temperature,
    const Vector& gradientMagnitude
) const {
    if (mesh.nodes.size() >= config_.maxNodes) {
        return mesh;
    }

    auto marked = markElementsForRefinement(mesh, gradientMagnitude);

    bool anyMarked = false;
    for (bool m : marked) {
        if (m) {
            anyMarked = true;
            break;
        }
    }

    if (!anyMarked) {
        return mesh;
    }

    return refineMarkedElements(mesh, marked);
}

Mesh MeshRefiner::uniformRefine(const Mesh& mesh) const {
    std::vector<bool> marked(mesh.triangles.size(), true);
    return refineMarkedElements(mesh, marked);
}

}
