#include <iostream>
#include <string>
#include <vector>
#include <csignal>
#include <atomic>
#include <thread>
#include <chrono>

#include "rpc_server.h"
#include "discovery.h"

std::atomic<bool> g_running{true};

void signal_handler(int signal) {
    std::cout << "\n[Worker] Received signal " << signal << ", shutting down..." << std::endl;
    g_running = false;
}

std::string generate_worker_id() {
    static int counter = 0;
    counter++;
    return "worker-" + std::to_string(
        std::chrono::steady_clock::now().time_since_epoch().count()) + "-" +
        std::to_string(counter);
}

int main(int argc, char* argv[]) {
    std::string master_addr = "localhost:50051";
    std::string listen_addr = "0.0.0.0:0";
    std::string etcd_addr = "localhost:2379";
    int worker_port = 0;

    for (int i = 1; i < argc; i++) {
        std::string arg = argv[i];
        if (arg == "--master" && i + 1 < argc) {
            master_addr = argv[++i];
        } else if (arg == "--port" && i + 1 < argc) {
            worker_port = std::stoi(argv[++i]);
        } else if (arg == "--etcd" && i + 1 < argc) {
            etcd_addr = argv[++i];
        }
    }

    if (worker_port > 0) {
        listen_addr = "0.0.0.0:" + std::to_string(worker_port);
    }

    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);

    std::string worker_id = generate_worker_id();

    std::cout << "========================================" << std::endl;
    std::cout << "[Worker] Starting with ID: " << worker_id << std::endl;
    std::cout << "[Worker] Master address: " << master_addr << std::endl;
    std::cout << "[Worker] Listen address: " << listen_addr << std::endl;
    std::cout << "[Worker] etcd address: " << etcd_addr << std::endl;
    std::cout << "========================================" << std::endl;

    pagerank::RpcServer rpc_server(worker_id, master_addr, listen_addr);

    rpc_server.setOnPartitionReceived([]() {
        std::cout << "[Worker] Partition received, ready for computation" << std::endl;
    });

    rpc_server.setOnStartIteration([]() {
        std::cout << "[Worker] Starting new iteration" << std::endl;
    });

    std::vector<std::string> etcd_endpoints = {etcd_addr};
    EtcdDiscovery discovery(etcd_endpoints, 10);

    int actual_port = worker_port;
    if (actual_port == 0) {
        actual_port = 50052 + (std::stoi(worker_id.substr(worker_id.find_last_of('-') + 1)) % 100);
    }

    ServiceInfo info;
    info.id = worker_id;
    info.addr = "localhost:" + std::to_string(actual_port);
    info.type = "worker";
    discovery.registerService(info);

    rpc_server.start();

    std::cout << "[Worker] Press Ctrl+C to stop..." << std::endl;

    while (g_running && rpc_server.isConnected()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    std::cout << "[Worker] Shutting down..." << std::endl;

    discovery.deregisterService(info);
    discovery.close();

    rpc_server.stop();

    std::cout << "[Worker] Stopped." << std::endl;

    return 0;
}
