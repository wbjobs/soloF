#!/bin/bash
set -e

echo "========================================"
echo "PageRank Master-Worker 构建脚本"
echo "========================================"

echo ""
echo "[1/4] 生成 Protobuf 代码..."

cd proto
if command -v protoc &> /dev/null; then
    protoc --go_out=../master/proto \
           --go-grpc_out=../master/proto \
           --go_opt=paths=source_relative \
           --go-grpc_opt=paths=source_relative \
           pagerank.proto
    echo "  Go Protobuf 代码生成完成"
else
    echo "  警告: protoc 未安装，跳过Go代码生成"
fi

if command -v protoc &> /dev/null; then
    protoc --cpp_out=../worker/src \
           --grpc_out=../worker/src \
           --plugin=protoc-gen-grpc=`which grpc_cpp_plugin` \
           pagerank.proto
    echo "  C++ Protobuf 代码生成完成"
else
    echo "  警告: protoc 未安装，跳过C++代码生成"
fi

cd ..

echo ""
echo "[2/4] 构建 Master (Go)..."
cd master
if command -v go &> /dev/null; then
    go build -o pagerank-master .
    echo "  Master 构建完成: pagerank-master"
else
    echo "  警告: Go 未安装，跳过Master构建"
fi
cd ..

echo ""
echo "[3/4] 构建 Worker (C++)..."
cd worker
if command -v cmake &> /dev/null; then
    mkdir -p build
    cd build
    cmake ..
    make -j$(nproc)
    cd ..
    echo "  Worker 构建完成: build/worker"
else
    echo "  警告: cmake 未安装，跳过Worker构建"
fi
cd ..

echo ""
echo "[4/4] 安装前端依赖..."
cd web
if command -v npm &> /dev/null; then
    npm install
    echo "  前端依赖安装完成"
else
    echo "  警告: npm 未安装，跳过前端依赖安装"
fi
cd ..

echo ""
echo "========================================"
echo "构建完成！"
echo ""
echo "启动服务："
echo "  1. 启动 etcd"
echo "  2. 启动 Master: ./master/pagerank-master"
echo "  3. 启动 Worker: ./worker/build/worker --port 50052"
echo "  4. 启动前端: cd web && npm run dev"
echo "========================================"
