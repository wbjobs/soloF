#pragma once

#include "Types.h"

namespace HeatSimulation2D {

class GmshReader {
public:
    static Mesh read(const std::string& filename);

private:
    static void readNodes(std::ifstream& file, Mesh& mesh);
    static void readElements(std::ifstream& file, Mesh& mesh);
    static void skipLines(std::ifstream& file, int count);
};

}
