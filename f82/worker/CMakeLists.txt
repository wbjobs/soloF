cmake_minimum_required(VERSION 3.14)
project(pagerank_worker CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Protobuf CONFIG REQUIRED)
find_package(gRPC CONFIG REQUIRED)
find_package(etcd-cpp-api CONFIG REQUIRED)

find_package(Threads REQUIRED)

set(PROTO_DIR "${CMAKE_SOURCE_DIR}/../proto")
set(GENERATED_DIR "${CMAKE_BINARY_DIR}/generated")

file(MAKE_DIRECTORY ${GENERATED_DIR})

add_custom_command(
    OUTPUT
        "${GENERATED_DIR}/pagerank.pb.cc"
        "${GENERATED_DIR}/pagerank.pb.h"
        "${GENERATED_DIR}/pagerank.grpc.pb.cc"
        "${GENERATED_DIR}/pagerank.grpc.pb.h"
    COMMAND ${Protobuf_PROTOC_EXECUTABLE}
    ARGS
        --proto_path=${PROTO_DIR}
        --cpp_out=${GENERATED_DIR}
        --grpc_out=${GENERATED_DIR}
        --plugin=protoc-gen-grpc=$<TARGET_FILE:gRPC::grpc_cpp_plugin>
        "${PROTO_DIR}/pagerank.proto"
    DEPENDS "${PROTO_DIR}/pagerank.proto"
)

set(SOURCES
    src/main.cpp
    src/pagerank.cpp
    src/rpc_server.cpp
    src/discovery.cpp
    ${GENERATED_DIR}/pagerank.pb.cc
    ${GENERATED_DIR}/pagerank.grpc.pb.cc
)

add_executable(worker ${SOURCES})

target_include_directories(worker PRIVATE
    ${GENERATED_DIR}
    ${CMAKE_SOURCE_DIR}/src
)

target_link_libraries(worker PRIVATE
    protobuf::libprotobuf
    gRPC::grpc++
    gRPC::grpc
    etcd-cpp-api
    Threads::Threads
)

if(MSVC)
    target_compile_options(worker PRIVATE /W4)
else()
    target_compile_options(worker PRIVATE -Wall -Wextra -Wpedantic)
endif()
