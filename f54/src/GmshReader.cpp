#include "HeatSimulation2D/GmshReader.h"

namespace HeatSimulation2D {

Mesh GmshReader::read(const std::string& filename) {
    std::ifstream file(filename);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open file: " + filename);
    }

    Mesh mesh;
    std::string line;

    while (std::getline(file, line)) {
        if (line == "$Nodes") {
            readNodes(file, mesh);
        } else if (line == "$Elements") {
            readElements(file, mesh);
        }
    }

    file.close();
    return mesh;
}

void GmshReader::readNodes(std::ifstream& file, Mesh& mesh) {
    std::string line;
    std::getline(file, line);
    int numNodes = std::stoi(line);

    mesh.nodes.reserve(numNodes);

    for (int i = 0; i < numNodes; ++i) {
        std::getline(file, line);
        std::istringstream iss(line);

        Index id;
        Scalar x, y, z;
        iss >> id >> x >> y >> z;

        mesh.nodes.push_back({id, x, y});
        mesh.nodeIdToIndex[id] = i;
    }

    std::getline(file, line);
}

void GmshReader::readElements(std::ifstream& file, Mesh& mesh) {
    std::string line;
    std::getline(file, line);
    int numElements = std::stoi(line);

    mesh.triangles.reserve(numElements);

    for (int i = 0; i < numElements; ++i) {
        std::getline(file, line);
        std::istringstream iss(line);

        Index id, type;
        iss >> id >> type;

        if (type == 2) {
            int numTags;
            iss >> numTags;
            for (int t = 0; t < numTags; ++t) {
                Index tag;
                iss >> tag;
            }

            Index nodeIds[3];
            iss >> nodeIds[0] >> nodeIds[1] >> nodeIds[2];
            mesh.triangles.push_back({id, {nodeIds[0], nodeIds[1], nodeIds[2]}});
        }
    }

    std::getline(file, line);
}

void GmshReader::skipLines(std::ifstream& file, int count) {
    std::string line;
    for (int i = 0; i < count; ++i) {
        std::getline(file, line);
    }
}

}
