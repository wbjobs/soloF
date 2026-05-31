#pragma once

#include "Types.h"

namespace HeatSimulation2D {

class SolutionProjector {
public:
    static Vector project(
        const Mesh& oldMesh,
        const Vector& oldSolution,
        const Mesh& newMesh
    );

private:
    static bool pointInTriangle(
        Scalar px, Scalar py,
        Scalar x0, Scalar y0,
        Scalar x1, Scalar y1,
        Scalar x2, Scalar y2,
        Scalar& lambda0, Scalar& lambda1, Scalar& lambda2
    );

    static Scalar distanceSquared(
        Scalar px, Scalar py,
        Scalar x0, Scalar y0
    );
};

}
