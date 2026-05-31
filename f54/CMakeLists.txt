cmake_minimum_required(VERSION 3.15)
project(HeatSimulation2D VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(MSVC)
    add_compile_options(/W4)
else()
    add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(Eigen3 3.3 REQUIRED NO_MODULE)

set(HEADER_FILES
    include/HeatSimulation2D/GmshReader.h
    include/HeatSimulation2D/HeatSolver.h
    include/HeatSimulation2D/VTKWriter.h
    include/HeatSimulation2D/Types.h
    include/HeatSimulation2D/MeshRefiner.h
    include/HeatSimulation2D/SolutionProjector.h
    include/HeatSimulation2D/HeatSimulation2D.h
)

set(SOURCE_FILES
    src/GmshReader.cpp
    src/HeatSolver.cpp
    src/VTKWriter.cpp
    src/MeshRefiner.cpp
    src/SolutionProjector.cpp
)

add_library(HeatSimulation2D STATIC ${SOURCE_FILES} ${HEADER_FILES})

target_include_directories(HeatSimulation2D
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>
)

target_link_libraries(HeatSimulation2D PUBLIC Eigen3::Eigen)

add_executable(HeatSimulation2D_example examples/main.cpp)
target_link_libraries(HeatSimulation2D_example PRIVATE HeatSimulation2D)

add_executable(HeatSimulation2D_adaptive examples/adaptive_main.cpp)
target_link_libraries(HeatSimulation2D_adaptive PRIVATE HeatSimulation2D)
