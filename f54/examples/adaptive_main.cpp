#include "HeatSimulation2D/HeatSimulation2D.h"
#include <iostream>
#include <iomanip>

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: " << argv[0] << " <mesh_file.msh>" << std::endl;
        return 1;
    }

    std::string meshFile = argv[1];

    try {
        std::cout << "=== Adaptive Mesh Refinement Heat Simulation ===" << std::endl;
        std::cout << "Reading initial mesh: " << meshFile << std::endl;

        auto mesh = HeatSimulation2D::GmshReader::read(meshFile);
        std::cout << "Initial mesh: " << mesh.nodes.size() << " nodes, "
                  << mesh.triangles.size() << " triangles" << std::endl;

        HeatSimulation2D::HeatSolver::Config solverConfig;
        solverConfig.alpha = 1.0;
        solverConfig.dt = 0.01;
        solverConfig.tEnd = 0.05;

        HeatSimulation2D::HeatSolver solver(mesh, solverConfig);

        HeatSimulation2D::Vector initialCondition = HeatSimulation2D::Vector::Zero(mesh.nodes.size());
        solver.setInitialCondition(initialCondition);

        solver.setSourceTerm([](HeatSimulation2D::Scalar x, HeatSimulation2D::Scalar y) {
            HeatSimulation2D::Scalar r = std::sqrt((x - 0.5) * (x - 0.5) + (y - 0.5) * (y - 0.5));
            return (r < 0.15) ? 20.0 : 0.0;
        });

        std::vector<HeatSimulation2D::Index> boundaryNodes;
        for (const auto& node : mesh.nodes) {
            if (std::abs(node.x) < 1e-6 || std::abs(node.x - 1.0) < 1e-6 ||
                std::abs(node.y) < 1e-6 || std::abs(node.y - 1.0) < 1e-6) {
                boundaryNodes.push_back(node.id);
            }
        }
        HeatSimulation2D::Vector boundaryValues = HeatSimulation2D::Vector::Zero(boundaryNodes.size());
        solver.setDirichletBC(boundaryNodes, boundaryValues);

        HeatSimulation2D::MeshRefiner::Config refinerConfig;
        refinerConfig.refinementThreshold = 0.3;
        refinerConfig.maxRefinementLevel = 4;
        refinerConfig.maxNodes = 20000;
        HeatSimulation2D::MeshRefiner refiner(refinerConfig);

        const int maxAdaptiveSteps = 3;

        for (int step = 0; step < maxAdaptiveSteps; ++step) {
            std::cout << "\n--- Adaptive Step " << step + 1 << " ---" << std::endl;
            std::cout << "Solving on mesh with " << solver.getMesh().nodes.size() << " nodes..." << std::endl;

            solver.solve();
            std::cout << "Solution completed, max temp: " << std::fixed << std::setprecision(4)
                      << solver.getSolution().maxCoeff() << std::endl;

            std::string vtkFile = "heat_result_step" + std::to_string(step + 1) + ".vtk";
            HeatSimulation2D::VTKWriter::write(vtkFile, solver.getMesh(), solver.getSolution(), "temperature");
            std::cout << "Result written to: " << vtkFile << std::endl;

            if (step < maxAdaptiveSteps - 1) {
                std::cout << "Computing temperature gradient..." << std::endl;
                auto gradMag = HeatSimulation2D::MeshRefiner::computeGradientMagnitude(
                    solver.getMesh(), solver.getSolution());

                std::cout << "Max gradient magnitude: " << gradMag.maxCoeff() << std::endl;

                std::cout << "Refining mesh based on gradient..." << std::endl;
                auto newMesh = refiner.refine(solver.getMesh(), solver.getSolution(), gradMag);

                if (newMesh.nodes.size() == solver.getMesh().nodes.size()) {
                    std::cout << "No refinement needed. Stopping adaptive iterations." << std::endl;
                    break;
                }

                std::cout << "New mesh: " << newMesh.nodes.size() << " nodes, "
                          << newMesh.triangles.size() << " triangles" << std::endl;

                std::cout << "Projecting solution to new mesh..." << std::endl;
                auto newSolution = HeatSimulation2D::SolutionProjector::project(
                    solver.getMesh(), solver.getSolution(), newMesh);

                solver.updateMesh(newMesh, newSolution);

                std::vector<HeatSimulation2D::Index> newBoundaryNodes;
                for (const auto& node : newMesh.nodes) {
                    if (std::abs(node.x) < 1e-6 || std::abs(node.x - 1.0) < 1e-6 ||
                        std::abs(node.y) < 1e-6 || std::abs(node.y - 1.0) < 1e-6) {
                        newBoundaryNodes.push_back(node.id);
                    }
                }
                HeatSimulation2D::Vector newBoundaryValues = HeatSimulation2D::Vector::Zero(newBoundaryNodes.size());
                solver.setDirichletBC(newBoundaryNodes, newBoundaryValues);
            }
        }

        std::cout << "\n=== Adaptive simulation completed ===" << std::endl;

    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}
