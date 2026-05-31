#include "HeatSimulation2D/HeatSolver.h"
#include <Eigen/SparseLU>

namespace HeatSimulation2D {

HeatSolver::HeatSolver(const Mesh& mesh, const Config& config)
    : config_(config)
{
    meshPtr_ = std::make_shared<Mesh>(mesh);
    initializeFromMesh();
}

void HeatSolver::initializeFromMesh() {
    const Mesh& mesh = *meshPtr_;
    Index numNodes = static_cast<Index>(mesh.nodes.size());

    K_.resize(numNodes, numNodes);
    M_.resize(numNodes, numNodes);
    u_.resize(numNodes);
    f_.resize(numNodes);
    rhs_.resize(numNodes);

    u_.setZero();
    f_.setZero();

    isBoundaryNode_.resize(numNodes, false);
    boundaryValueMap_.resize(numNodes);
    boundaryValueMap_.setZero();

    assembleStiffnessMatrix();
    assembleMassMatrix();
}

void HeatSolver::setInitialCondition(const Vector& u0) {
    u_ = u0;
}

void HeatSolver::setSourceTerm(const Vector& f) {
    f_ = f;
}

void HeatSolver::setSourceTerm(std::function<Scalar(Scalar, Scalar)> sourceFunc) {
    const Mesh& mesh = *meshPtr_;
    for (Index i = 0; i < static_cast<Index>(mesh.nodes.size()); ++i) {
        const auto& node = mesh.nodes[i];
        f_[i] = sourceFunc(node.x, node.y);
    }
}

void HeatSolver::setDirichletBC(const std::vector<Index>& boundaryNodes, const Vector& values) {
    boundaryNodes_ = boundaryNodes;
    boundaryValues_ = values;
    hasDirichletBC_ = true;

    const Mesh& mesh = *meshPtr_;
    Index numNodes = static_cast<Index>(mesh.nodes.size());
    isBoundaryNode_.assign(numNodes, false);
    boundaryValueMap_.resize(numNodes);
    boundaryValueMap_.setZero();

    for (size_t k = 0; k < boundaryNodes_.size(); ++k) {
        Index nodeId = boundaryNodes_[k];
        Index idx = mesh.nodeIdToIndex.at(nodeId);
        isBoundaryNode_[idx] = true;
        boundaryValueMap_[idx] = boundaryValues_[k];
    }
}

void HeatSolver::assembleStiffnessMatrix() {
    const Mesh& mesh = *meshPtr_;
    std::vector<Triplet> triplets;
    triplets.reserve(mesh.triangles.size() * 9);

    for (const auto& tri : mesh.triangles) {
        Index idx[3];
        for (int i = 0; i < 3; ++i) {
            idx[i] = mesh.nodeIdToIndex.at(tri.nodeIds[i]);
        }

        Scalar x[3], y[3];
        for (int i = 0; i < 3; ++i) {
            x[i] = mesh.nodes[idx[i]].x;
            y[i] = mesh.nodes[idx[i]].y;
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

        for (int i = 0; i < 3; ++i) {
            for (int j = 0; j < 3; ++j) {
                Scalar value = (b[i] * b[j] + c[i] * c[j]) / (4.0 * area);
                triplets.emplace_back(idx[i], idx[j], value);
            }
        }
    }

    K_.setFromTriplets(triplets.begin(), triplets.end());
}

void HeatSolver::assembleMassMatrix() {
    const Mesh& mesh = *meshPtr_;
    std::vector<Triplet> triplets;
    triplets.reserve(mesh.triangles.size() * 9);

    for (const auto& tri : mesh.triangles) {
        Index idx[3];
        for (int i = 0; i < 3; ++i) {
            idx[i] = mesh.nodeIdToIndex.at(tri.nodeIds[i]);
        }

        Scalar x[3], y[3];
        for (int i = 0; i < 3; ++i) {
            x[i] = mesh.nodes[idx[i]].x;
            y[i] = mesh.nodes[idx[i]].y;
        }

        Scalar area = 0.5 * std::abs(
            (x[1] - x[0]) * (y[2] - y[0]) -
            (x[2] - x[0]) * (y[1] - y[0])
        );

        Scalar massMatrix[3][3] = {
            {area / 6.0, area / 12.0, area / 12.0},
            {area / 12.0, area / 6.0, area / 12.0},
            {area / 12.0, area / 12.0, area / 6.0}
        };

        for (int i = 0; i < 3; ++i) {
            for (int j = 0; j < 3; ++j) {
                triplets.emplace_back(idx[i], idx[j], massMatrix[i][j]);
            }
        }
    }

    M_.setFromTriplets(triplets.begin(), triplets.end());
}

void HeatSolver::applyDirichletBC() {
    if (!hasDirichletBC_) return;

    Index numNodes = static_cast<Index>(meshPtr_->nodes.size());
    std::vector<Triplet> newTriplets;
    newTriplets.reserve(systemMatrix_.nonZeros());

    for (Index i = 0; i < numNodes; ++i) {
        if (isBoundaryNode_[i]) {
            newTriplets.emplace_back(i, i, 1.0);
            rhs_[i] = boundaryValueMap_[i];
        } else {
            Scalar rhsCorrection = 0.0;
            for (SparseMatrix::InnerIterator it(systemMatrix_, i); it; ++it) {
                Index j = it.col();
                Scalar value = it.value();
                if (isBoundaryNode_[j]) {
                    rhsCorrection += value * boundaryValueMap_[j];
                } else {
                    newTriplets.emplace_back(i, j, value);
                }
            }
            rhs_[i] -= rhsCorrection;
        }
    }

    systemMatrix_.setFromTriplets(newTriplets.begin(), newTriplets.end());
}

void HeatSolver::solve() {
    Scalar alpha = config_.alpha;
    Scalar dt = config_.dt;

    SparseMatrix baseSystem = M_ + alpha * dt * K_;

    Eigen::SparseLU<SparseMatrix> solver;

    while (currentTime_ < config_.tEnd) {
        rhs_ = M_ * u_ + dt * f_;
        systemMatrix_ = baseSystem;
        applyDirichletBC();

        solver.compute(systemMatrix_);
        if (solver.info() != Eigen::Success) {
            throw std::runtime_error("Matrix decomposition failed");
        }

        u_ = solver.solve(rhs_);
        if (solver.info() != Eigen::Success) {
            throw std::runtime_error("Linear system solve failed");
        }

        currentTime_ += dt;
    }
}

const Vector& HeatSolver::getSolution() const {
    return u_;
}

Scalar HeatSolver::getCurrentTime() const {
    return currentTime_;
}

const Mesh& HeatSolver::getMesh() const {
    return *meshPtr_;
}

void HeatSolver::updateMesh(const Mesh& newMesh, const Vector& newSolution) {
    meshPtr_ = std::make_shared<Mesh>(newMesh);
    initializeFromMesh();
    u_ = newSolution;
    currentTime_ = 0.0;
}

void HeatSolver::resetTime() {
    currentTime_ = 0.0;
}

}
