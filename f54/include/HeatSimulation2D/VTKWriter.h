#pragma once

#include "Types.h"

namespace HeatSimulation2D {

class VTKWriter {
public:
    static void write(
        const std::string& filename,
        const Mesh& mesh,
        const Vector& solution,
        const std::string& scalarName = "temperature"
    );
};

}
