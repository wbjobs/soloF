#include "HeatSimulation2D/SolutionProjector.h"
#include <iostream>
#include <limits>

namespace HeatSimulation2D {

bool SolutionProjector::pointInTriangle(
    Scalar px, Scalar py,
    Scalar x0, Scalar y0,
    Scalar x1, Scalar y1,
    Scalar x2, Scalar y2,
    Scalar& lambda0, Scalar& lambda1, Scalar& lambda2
) {
    Scalar area = 0.5 * std::abs(
        (x1 - x0) * (y2 - y0) -
        (x2 - x0) * (y1 - y0)
    );

    if (area < 1e-12) return false;

    Scalar inv2Area = 1.0 / (2.0 * area);

    lambda0 = (x1 - px) * (y2 - py) - (x2 - px) * (y1 - py);
    lambda1 = (x2 - px) * (y0 - py) - (x0 - px) * (y2 - py);
    lambda2 = (x0 - px) * (y1 - py) - (x1 - px) * (y0 - py);

    lambda0 *= inv2Area;
    lambda1 *= inv2Area;
    lambda2 *= inv2Area;

    const Scalar eps = -1e-6;
    return (lambda0 >= eps && lambda1 >= eps && lambda2 >= eps);
}

Scalar SolutionProjector::distanceSquared(
    Scalar px, Scalar py,
    Scalar x0, Scalar y0
) {
    Scalar dx = px - x0;
    Scalar dy = py - y0;
    return dx * dx + dy * dy;
}

Vector SolutionProjector::project(
    const Mesh& oldMesh,
    const Vector& oldSolution,
    const Mesh& newMesh
) {
    Vector newSolution = Vector::Zero(newMesh.nodes.size());

    for (Index newNodeIdx = 0; newNodeIdx < static_cast<Index>(newMesh.nodes.size(); ++newNodeIdx) {
        const auto& newNode = newMesh.nodes[newNodeIdx];
        Scalar px = newNode.x;
        Scalar py = newNode.y;

        bool found = false;
        Scalar bestLambda0 = 0, bestLambda1 = 0, bestLambda2 = 0;
        Index bestTriIdx = -1;
        Scalar minDist = std::numeric_limits<Scalar>::max();

        for (Index triIdx = 0; triIdx < static_cast<Index>(oldMesh.triangles.size()); ++triIdx) {
            const auto& tri = oldMesh.triangles[triIdx];

            Index idx0 = oldMesh.nodeIdToIndex.at(tri.nodeIds[0]);
            Index idx1 = oldMesh.nodeIdToIndex.at(tri.nodeIds[1]);
            Index idx2 = oldMesh.nodeIdToIndex.at(tri.nodeIds[2]);

            Scalar x0 = oldMesh.nodes[idx0].x;
            Scalar y0 = oldMesh.nodes[idx0].y;
            Scalar x1 = oldMesh.nodes[idx1].x;
            Scalar y1 = oldMesh.nodes[idx1].y;
            Scalar x2 = oldMesh.nodes[idx2].x;
            Scalar y2 = oldMesh.nodes[idx2].y;

            Scalar lambda0, lambda1, lambda2;
            if (pointInTriangle(px, py, x0, y0, x1, y1, x2, y2, lambda0, lambda1, lambda2)) {
                Scalar u0 = oldSolution[idx0];
                Scalar u1 = oldSolution[idx1];
                Scalar u2 = oldSolution[idx2];
                newSolution[newNodeIdx] = lambda0 * u0 + lambda1 * u1 + lambda2 * u2;
                found = true;
                break;
            }

            Scalar centroidX = (x0 + x1 + x2) / 3.0;
            Scalar centroidY = (y0 + y1 + y2) / 3.0;
            Scalar dist = distanceSquared(px, py, centroidX, centroidY);
            if (dist < minDist) {
                minDist = dist;
                bestTriIdx = triIdx;
            }
        }

        if (!found && bestTriIdx >= 0) {
            const auto& tri = oldMesh.triangles[bestTriIdx];
            Index idx0 = oldMesh.nodeIdToIndex.at(tri.nodeIds[0]);
            Index idx1 = oldMesh.nodeIdToIndex.at(tri.nodeIds[1]);
            Index idx2 = oldMesh.nodeIdToIndex.at(tri.nodeIds[2]);

            Scalar x0 = oldMesh.nodes[idx0].x;
            Scalar y0 = oldMesh.nodes[idx0].y;
            Scalar x1 = oldMesh.nodes[idx1].x;
            Scalar y1 = oldMesh.nodes[idx1].y;
            Scalar x2 = oldMesh.nodes[idx2].x;
            Scalar y2 = oldMesh.nodes[idx2].y;

            Scalar lambda0, lambda1, lambda2;
            pointInTriangle(px, py, x0, y0, x1, y1, x2, y2, lambda0, lambda1, lambda2);

            lambda0 = std::max(0.0, std::min(1.0, lambda0));
            lambda1 = std::max(0.0, std::min(1.0, lambda1));
            lambda2 = std::max(0.0, std::min(1.0, lambda2));
            Scalar sum = lambda0 + lambda1 + lambda2;
            if (sum > 0) {
                lambda0 /= sum;
                lambda1 /= sum;
                lambda2 /= sum;
            } else {
                lambda0 = lambda1 = lambda2 = 1.0 / 3.0;
            }

            Scalar u0 = oldSolution[idx0];
            Scalar u1 = oldSolution[idx1];
            Scalar u2 = oldSolution[idx2];
            newSolution[newNodeIdx] = lambda0 * u0 + lambda1 * u1 + lambda2 * u2;
        }
    }

    return newSolution;
}

}
