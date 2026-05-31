#include "discovery.h"

#include <iostream>
#include <chrono>
#include <thread>

EtcdDiscovery::EtcdDiscovery(const std::vector<std::string>& endpoints,
                             int ttl_seconds)
    : endpoints_(endpoints)
    , ttl_seconds_(ttl_seconds) {
}

EtcdDiscovery::~EtcdDiscovery() {
    close();
}

bool EtcdDiscovery::registerService(const ServiceInfo& info) {
    std::cout << "[Discovery] Registering service: " << info.id
              << " (" << info.type << ") at " << info.addr << std::endl;

    lease_id_ = info.id;
    running_ = true;

    keep_alive_thread_ = std::thread(&EtcdDiscovery::keepAlive, this);

    return true;
}

void EtcdDiscovery::deregisterService(const ServiceInfo& info) {
    std::cout << "[Discovery] Deregistering service: " << info.id << std::endl;
    running_ = false;
}

std::vector<std::string> EtcdDiscovery::discoverServices(const std::string& service_type) {
    std::cout << "[Discovery] Discovering services of type: " << service_type << std::endl;
    return {};
}

void EtcdDiscovery::startWatch(const std::string& service_type,
                                std::function<void(const std::vector<std::string>&)> callback) {
    watch_prefix_ = "/pagerank/services/" + service_type + "/";
    watch_callback_ = std::move(callback);
    watching_ = true;

    watch_thread_ = std::thread(&EtcdDiscovery::watchLoop, this);
}

void EtcdDiscovery::stopWatch() {
    watching_ = false;
    cv_.notify_all();
}

void EtcdDiscovery::keepAlive() {
    while (running_) {
        std::this_thread::sleep_for(std::chrono::seconds(ttl_seconds_ / 3));
    }
}

void EtcdDiscovery::watchLoop() {
    while (watching_) {
        std::vector<std::string> services;
        if (watch_callback_) {
            watch_callback_(services);
        }

        std::unique_lock<std::mutex> lock(mutex_);
        cv_.wait_for(lock, std::chrono::seconds(5), [this] { return !watching_; });
    }
}

void EtcdDiscovery::close() {
    running_ = false;
    watching_ = false;
    cv_.notify_all();

    if (keep_alive_thread_.joinable()) {
        keep_alive_thread_.join();
    }
    if (watch_thread_.joinable()) {
        watch_thread_.join();
    }
}
