#include "HeatSimulation2D/HeatSimulation2D.h"
#include <iostream>

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: " << argv[0] << " <mesh_file.msh>" << std::endl;
        return 1;
    }

    std::string meshFile = argv[1];

    try {
        std::cout << "Reading mesh: " << meshFile << std::endl;
        auto mesh = HeatSimulation2D::GmshReader::read(meshFile);

        std::cout << "Mesh loaded: " << mesh.nodes.size() << " nodes, "
                  << mesh.triangles.size() << " triangles" << std::endl;

        HeatSimulation2D::HeatSolver::Config config;
        config.alpha = 1.0;
        config.dt = 0.01;
        config.tEnd = 0.1;

        HeatSimulation2D::HeatSolver solver(mesh, config);

        HeatSimulation2D::Vector initialCondition = HeatSimulation2D::Vector::Zero(mesh.nodes.size());
        solver.setInitialCondition(initialCondition);

        solver.setSourceTerm([](HeatSimulation2D::Scalar x, HeatSimulation2D::Scalar y) {
            HeatSimulation2D::Scalar r = std::sqrt(x * x + y * y);
            return (r < 0.2) ? 10.0 : 0.0;
        });

        std::vector<HeatSimulation2D::Index> boundaryNodes;
        HeatSimulation2D::Vector boundaryValues;

        for (const auto& node : mesh.nodes) {
            if (std::abs(node.x) < 1e-6 || std::abs(node.x - 1.0) < 1e-6 ||
                std::abs(node.y) < 1e-6 || std::abs(node.y - 1.0) < 1e-6) {
                boundaryNodes.push_back(node.id);
            }
        }

        boundaryValues = HeatSimulation2D::Vector::Zero(boundaryNodes.size());
        solver.setDirichletBC(boundaryNodes, boundaryValues);

        std::cout << "Solving heat equation..." << std::endl;
        solver.solve();

        std::cout << "Simulation completed. Final time: " << solver.getCurrentTime() << std::endl;

        std::string outputFile = "heat_result.vtk";
        HeatSimulation2D::VTKWriter::write(outputFile, mesh, solver.getSolution(), "temperature");

        std::cout << "Result written to: " << outputFile << std::endl;

    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}
