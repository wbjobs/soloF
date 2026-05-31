#include <iostream>
#include <memory>
#include <string>
#include <grpcpp/grpcpp.h>
#include "terrain_service.h"

using namespace terrain;

int main(int argc, char** argv) {
    std::string server_address("0.0.0.0:50051");
    int seed = 1337;
    std::string dbPath("./terrain_db");
    
    if (argc > 1) {
        seed = std::stoi(argv[1]);
    }
    if (argc > 2) {
        server_address = argv[2];
    }
    if (argc > 3) {
        dbPath = argv[3];
    }
    
    TerrainServiceImpl service(seed, dbPath);
    
    grpc::EnableDefaultHealthCheckService(true);
    grpc::ServerBuilder builder;
    
    builder.AddListeningPort(server_address, grpc::InsecureServerCredentials());
    builder.RegisterService(&service);
    builder.SetMaxSendMessageSize(100 * 1024 * 1024);
    builder.SetMaxReceiveMessageSize(100 * 1024 * 1024);
    
    std::unique_ptr<grpc::Server> server(builder.BuildAndStart());
    std::cout << "Terrain Server listening on " << server_address << std::endl;
    std::cout << "Seed: " << seed << std::endl;
    std::cout << "Database: " << dbPath << std::endl;
    
    server->Wait();
    
    return 0;
}
