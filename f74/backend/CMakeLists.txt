cmake_minimum_required(VERSION 3.15)
project(TerrainServer CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Protobuf CONFIG REQUIRED)
find_package(gRPC CONFIG REQUIRED)
find_package(leveldb CONFIG REQUIRED)

set(PROTO_DIR ${CMAKE_SOURCE_DIR}/proto)
set(GENERATED_DIR ${CMAKE_BINARY_DIR}/generated)

file(MAKE_DIRECTORY ${GENERATED_DIR})

set(PROTO_FILES
    ${PROTO_DIR}/terrain.proto
)

add_custom_command(
    OUTPUT
        ${GENERATED_DIR}/terrain.pb.cc
        ${GENERATED_DIR}/terrain.pb.h
        ${GENERATED_DIR}/terrain.grpc.pb.cc
        ${GENERATED_DIR}/terrain.grpc.pb.h
    COMMAND $<TARGET_FILE:protobuf::protoc>
    ARGS
        --grpc_out=${GENERATED_DIR}
        --cpp_out=${GENERATED_DIR}
        --plugin=protoc-gen-grpc=$<TARGET_FILE:gRPC::grpc_cpp_plugin>
        --proto_path=${PROTO_DIR}
        ${PROTO_FILES}
    DEPENDS ${PROTO_FILES}
    COMMENT "Generating gRPC and Protobuf files"
)

include_directories(
    ${CMAKE_SOURCE_DIR}/include
    ${GENERATED_DIR}
)

set(SOURCES
    src/main.cpp
    src/noise_generator.cpp
    src/terrain_service.cpp
    src/terrain_storage.cpp
    ${GENERATED_DIR}/terrain.pb.cc
    ${GENERATED_DIR}/terrain.grpc.pb.cc
)

add_executable(terrain_server ${SOURCES})

target_link_libraries(terrain_server
    gRPC::grpc++
    gRPC::grpc
    protobuf::libprotobuf
    leveldb::leveldb
)

if(MSVC)
    target_compile_options(terrain_server PRIVATE /W4)
else()
    target_compile_options(terrain_server PRIVATE -Wall -Wextra -Wpedantic)
endif()
