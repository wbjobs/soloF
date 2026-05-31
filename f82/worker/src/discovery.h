#pragma once

#include <string>
#include <vector>
#include <memory>
#include <functional>
#include <mutex>
#include <atomic>
#include <thread>
#include <condition_variable>

struct ServiceInfo {
    std::string id;
    std::string addr;
    std::string type;
};

class EtcdDiscovery {
public:
    EtcdDiscovery(const std::vector<std::string>& endpoints, int ttl_seconds);
    ~EtcdDiscovery();

    bool registerService(const ServiceInfo& info);
    void deregisterService(const ServiceInfo& info);

    std::vector<std::string> discoverServices(const std::string& service_type);

    void startWatch(const std::string& service_type,
                    std::function<void(const std::vector<std::string>&)> callback);
    void stopWatch();

    void close();

private:
    void keepAlive();
    void watchLoop();

    std::vector<std::string> endpoints_;
    int ttl_seconds_;

    std::string lease_id_;
    std::atomic<bool> running_{false};
    std::atomic<bool> watching_{false};

    std::thread keep_alive_thread_;
    std::thread watch_thread_;

    std::mutex mutex_;
    std::condition_variable cv_;

    std::string watch_prefix_;
    std::function<void(const std::vector<std::string>&)> watch_callback_;
};
