#include "HeatSimulation2D/VTKWriter.h"

namespace HeatSimulation2D {

void VTKWriter::write(
    const std::string& filename,
    const Mesh& mesh,
    const Vector& solution,
    const std::string& scalarName
) {
    std::ofstream file(filename);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open file for writing: " + filename);
    }

    file << "# vtk DataFile Version 3.0\n";
    file << "Heat simulation result\n";
    file << "ASCII\n";
    file << "DATASET UNSTRUCTURED_GRID\n";

    file << "POINTS " << mesh.nodes.size() << " double\n";
    for (const auto& node : mesh.nodes) {
        file << node.x << " " << node.y << " 0.0\n";
    }

    file << "CELLS " << mesh.triangles.size() << " " << mesh.triangles.size() * 4 << "\n";
    for (const auto& tri : mesh.triangles) {
        file << "3";
        for (int i = 0; i < 3; ++i) {
            Index idx = mesh.nodeIdToIndex.at(tri.nodeIds[i]);
            file << " " << idx;
        }
        file << "\n";
    }

    file << "CELL_TYPES " << mesh.triangles.size() << "\n";
    for (size_t i = 0; i < mesh.triangles.size(); ++i) {
        file << "5\n";
    }

    file << "POINT_DATA " << mesh.nodes.size() << "\n";
    file << "SCALARS " << scalarName << " double 1\n";
    file << "LOOKUP_TABLE default\n";
    for (Index i = 0; i < solution.size(); ++i) {
        file << solution[i] << "\n";
    }

    file.close();
}

}
