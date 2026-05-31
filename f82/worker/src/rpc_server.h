#pragma once

#include <string>
#include <memory>
#include <atomic>
#include <functional>
#include <thread>
#include <mutex>

#include <grpcpp/grpcpp.h>
#include "pagerank.grpc.pb.h"
#include "pagerank.h"

namespace pagerank {

class RpcServer {
public:
    RpcServer(const std::string& worker_id,
              const std::string& master_addr,
              const std::string& listen_addr);
    ~RpcServer();

    void start();
    void stop();

    bool isConnected() const { return connected_.load(); }
    const std::string& getWorkerId() const { return worker_id_; }

    void setOnPartitionReceived(std::function<void()> callback);
    void setOnStartIteration(std::function<void()> callback);
    void setOnIncrementalComplete(std::function<void()> callback);

    PageRank& getPageRank() { return pagerank_; }

private:
    class ComputeServiceImpl final : public pagerank::PageRankService::Service {
    public:
        ComputeServiceImpl(RpcServer* parent) : parent_(parent) {}

        grpc::Status Compute(grpc::ServerContext* context,
                             grpc::ServerReaderWriter<
                                 pagerank::ComputeResponse,
                                 pagerank::ComputeRequest>* stream) override;

    private:
        RpcServer* parent_;
    };

    void handlePartition(const pagerank::GraphPartition& partition);
    void handleGlobalRanks(const pagerank::GlobalRanks& ranks);
    void handleControl(const pagerank::ControlCommand& command);
    void handleIncrementalUpdate(const pagerank::IncrementalUpdate& update);

    void connectToMaster();
    void sendResponse();
    void sendIncrementalResponse();

    std::string worker_id_;
    std::string master_addr_;
    std::string listen_addr_;

    std::unique_ptr<pagerank::PageRankService::Stub> stub_;
    std::unique_ptr<grpc::Server> server_;
    ComputeServiceImpl service_;

    PageRank pagerank_;

    std::atomic<bool> connected_{false};
    std::atomic<bool> running_{false};
    std::atomic<bool> incremental_mode_{false};
    std::atomic<int32_t> partition_id_{-1};
    std::atomic<int32_t> current_iteration_{0};
    std::atomic<int32_t> incremental_iteration_{0};

    std::function<void()> on_partition_received_;
    std::function<void()> on_start_iteration_;
    std::function<void()> on_incremental_complete_;

    std::thread connect_thread_;
    std::mutex mutex_;

    std::unique_ptr<grpc::ClientReaderWriter<
        pagerank::ComputeRequest,
        pagerank::ComputeResponse>> stream_;
};

} // namespace pagerank
