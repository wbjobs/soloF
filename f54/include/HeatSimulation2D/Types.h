#pragma once

#include <Eigen/Dense>
#include <Eigen/Sparse>
#include <vector>
#include <string>
#include <fstream>
#include <sstream>
#include <iostream>
#include <cmath>
#include <stdexcept>
#include <unordered_map>

namespace HeatSimulation2D {

using Scalar = double;
using Index = Eigen::Index;
using SparseMatrix = Eigen::SparseMatrix<Scalar, Eigen::RowMajor>;
using Vector = Eigen::VectorXd;
using Triplet = Eigen::Triplet<Scalar>;

struct Node {
    Index id;
    Scalar x, y;
};

struct Triangle {
    Index id;
    Index nodeIds[3];
};

struct Mesh {
    std::vector<Node> nodes;
    std::vector<Triangle> triangles;
    std::unordered_map<Index, Index> nodeIdToIndex;
};

}
