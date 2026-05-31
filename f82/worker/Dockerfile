FROM ubuntu:22.04 AS builder

RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    pkg-config \
    libssl-dev \
    libprotobuf-dev \
    protobuf-compiler \
    libgrpc++-dev \
    protobuf-compiler-grpc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN git clone https://github.com/etcd-cpp-apiv3/etcd-cpp-apiv3.git /tmp/etcd-cpp \
    && cd /tmp/etcd-cpp \
    && mkdir build && cd build \
    && cmake .. \
    && make -j$(nproc) \
    && make install

COPY CMakeLists.txt ./
COPY src/ ./src/
COPY ../proto/ ./proto/

RUN mkdir build && cd build \
    && cmake .. \
    && make -j$(nproc)

FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    libssl-dev \
    libprotobuf-dev \
    libgrpc++-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/build/worker /usr/local/bin/worker
COPY --from=builder /usr/local/lib /usr/local/lib

RUN ldconfig

EXPOSE 50052 50053 50054

ENTRYPOINT ["worker"]
CMD ["--master", "master:50051", "--port", "50052", "--etcd", "etcd:2379"]
