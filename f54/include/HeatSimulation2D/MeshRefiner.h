#pragma once

#include "Types.h"
#include <set>
#include <map>
#include <vector>

namespace HeatSimulation2D {

class MeshRefiner {
public:
    struct Config {
        Scalar refinementThreshold = 0.5;
        Index maxRefinementLevel = 3;
        Index maxNodes = 50000;
    };

    MeshRefiner(const Config& config = Config());

    Mesh refine(
        const Mesh& mesh,
        const Vector& temperature,
        const Vector& gradientMagnitude
    ) const;

    Mesh uniformRefine(const Mesh& mesh) const;

    static Vector computeGradientMagnitude(const Mesh& mesh, const Vector& temperature);

private:
    struct Edge {
        Index a, b;
        Edge(Index x, Index y) : a(std::min(x, y)), b(std::max(x, y)) {}
        bool operator<(const Edge& other) const {
            return a < other.a || (a == other.a && b < other.b);
        }
    };

    std::vector<bool> markElementsForRefinement(
        const Mesh& mesh,
        const Vector& gradientMagnitude
    ) const;

    Mesh refineMarkedElements(
        const Mesh& mesh,
        const std::vector<bool>& marked
    ) const;

    Config config_;
};

}
