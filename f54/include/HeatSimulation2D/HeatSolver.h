#pragma once

#include "Types.h"
#include <functional>
#include <memory>

namespace HeatSimulation2D {

class HeatSolver {
public:
    struct Config {
        Scalar alpha = 1.0;
        Scalar dt = 0.01;
        Scalar tEnd = 1.0;
    };

    HeatSolver(const Mesh& mesh, const Config& config);

    void setInitialCondition(const Vector& u0);
    void setSourceTerm(const Vector& f);
    void setSourceTerm(std::function<Scalar(Scalar, Scalar)> sourceFunc);
    void setDirichletBC(const std::vector<Index>& boundaryNodes, const Vector& values);

    void solve();
    const Vector& getSolution() const;
    Scalar getCurrentTime() const;

    const Mesh& getMesh() const;
    void updateMesh(const Mesh& newMesh, const Vector& newSolution);
    void resetTime();

private:
    void assembleStiffnessMatrix();
    void assembleMassMatrix();
    void applyDirichletBC();
    void initializeFromMesh();

    std::shared_ptr<Mesh> meshPtr_;
    Config config_;

    SparseMatrix K_;
    SparseMatrix M_;
    SparseMatrix systemMatrix_;

    Vector u_;
    Vector f_;
    Vector rhs_;

    Scalar currentTime_ = 0.0;

    std::vector<Index> boundaryNodes_;
    Vector boundaryValues_;
    bool hasDirichletBC_ = false;

    std::vector<bool> isBoundaryNode_;
    Vector boundaryValueMap_;
};

}
