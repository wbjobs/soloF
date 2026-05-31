#include "rpc_server.h"

#include <iostream>
#include <chrono>
#include <thread>

namespace pagerank {

RpcServer::RpcServer(const std::string& worker_id,
                     const std::string& master_addr,
                     const std::string& listen_addr)
    : worker_id_(worker_id)
    , master_addr_(master_addr)
    , listen_addr_(listen_addr)
    , service_(this) {
}

RpcServer::~RpcServer() {
    stop();
}

void RpcServer::setOnPartitionReceived(std::function<void()> callback) {
    on_partition_received_ = std::move(callback);
}

void RpcServer::setOnStartIteration(std::function<void()> callback) {
    on_start_iteration_ = std::move(callback);
}

void RpcServer::setOnIncrementalComplete(std::function<void()> callback) {
    on_incremental_complete_ = std::move(callback);
}

grpc::Status RpcServer::ComputeServiceImpl::Compute(
    grpc::ServerContext* context,
    grpc::ServerReaderWriter<pagerank::ComputeResponse,
                              pagerank::ComputeRequest>* stream) {

    pagerank::ComputeRequest request;
    while (stream->Read(&request)) {
        if (request.has_partition()) {
            parent_->handlePartition(request.partition());
        } else if (request.has_global_ranks()) {
            parent_->handleGlobalRanks(request.global_ranks());
        } else if (request.has_control()) {
            parent_->handleControl(request.control());
        } else if (request.has_incremental_update()) {
            parent_->handleIncrementalUpdate(request.incremental_update());
        }
    }

    return grpc::Status::OK;
}

void RpcServer::handlePartition(const pagerank::GraphPartition& partition) {
    std::cout << "[Worker " << worker_id_
              << "] Received partition " << partition.partition_id()
              << " with " << partition.local_nodes_size() << " local nodes, "
              << partition.edges_size() << " edges" << std::endl;

    partition_id_ = partition.partition_id();

    std::vector<Edge> edges;
    for (const auto& e : partition.edges()) {
        edges.push_back({e.from(), e.to()});
    }

    std::vector<int64_t> local_nodes(partition.local_nodes().begin(),
                                      partition.local_nodes().end());
    std::vector<int64_t> ghost_nodes(partition.ghost_nodes().begin(),
                                      partition.ghost_nodes().end());

    pagerank_.initPartition(local_nodes, edges, ghost_nodes);

    if (on_partition_received_) {
        on_partition_received_();
    }
}

void RpcServer::handleGlobalRanks(const pagerank::GlobalRanks& ranks) {
    current_iteration_ = ranks.iteration();

    std::map<int64_t, double> global_ranks;
    for (const auto& [node, rank] : ranks.ranks()) {
        global_ranks[node] = rank;
    }

    pagerank_.computeIteration(current_iteration_, global_ranks);

    if (on_start_iteration_) {
        on_start_iteration_();
    }

    sendResponse();
}

void RpcServer::handleControl(const pagerank::ControlCommand& command) {
    std::cout << "[Worker " << worker_id_ << "] Received control command: "
              << command.type() << std::endl;

    switch (command.type()) {
        case pagerank::ControlCommand::INIT:
            if (command.damping_factor() > 0) {
                pagerank_.setDampingFactor(command.damping_factor());
            }
            if (command.convergence_threshold() > 0) {
                pagerank_.setConvergenceThreshold(command.convergence_threshold());
            }
            if (command.max_propagation_level() > 0) {
                pagerank_.setMaxPropagationLevel(command.max_propagation_level());
            }
            break;
        case pagerank::ControlCommand::START_ITERATION:
            break;
        case pagerank::ControlCommand::START_INCREMENTAL:
            incremental_mode_ = true;
            break;
        case pagerank::ControlCommand::COMMIT_INCREMENTAL:
            incremental_mode_ = false;
            pagerank_.resetIncremental();
            break;
        case pagerank::ControlCommand::ROLLBACK_INCREMENTAL:
            incremental_mode_ = false;
            pagerank_.resetIncremental();
            break;
        case pagerank::ControlCommand::STOP:
            running_ = false;
            break;
        case pagerank::ControlCommand::RESET:
            pagerank_.reset();
            incremental_mode_ = false;
            break;
    }
}

void RpcServer::handleIncrementalUpdate(const pagerank::IncrementalUpdate& update) {
    std::cout << "[Worker " << worker_id_
              << "] Received incremental update (iteration: " << update.iteration()
              << ", affected nodes: " << update.affected_nodes_size()
              << ", changed edges: " << update.changed_edges_size() << ")" << std::endl;

    incremental_iteration_ = update.iteration();
    incremental_mode_ = true;

    std::vector<int64_t> affected_nodes(update.affected_nodes().begin(),
                                         update.affected_nodes().end());

    std::vector<Edge> changed_edges;
    for (const auto& e : update.changed_edges()) {
        changed_edges.push_back({e.from(), e.to()});
    }

    std::map<int64_t, double> initial_ranks;
    for (const auto& [node, rank] : update.initial_ranks()) {
        initial_ranks[node] = rank;
    }

    if (update.max_propagation_level() > 0) {
        pagerank_.setMaxPropagationLevel(update.max_propagation_level());
    }

    pagerank_.computeIncrementalIteration(
        incremental_iteration_,
        affected_nodes,
        changed_edges,
        initial_ranks
    );

    if (on_incremental_complete_) {
        on_incremental_complete_();
    }

    sendIncrementalResponse();
}

void RpcServer::sendIncrementalResponse() {
    std::lock_guard<std::mutex> lock(mutex_);

    if (!stream_) {
        std::cout << "[Worker " << worker_id_
                  << "] Error: No active stream for incremental response" << std::endl;
        return;
    }

    pagerank::ComputeResponse response;
    response.set_worker_id(worker_id_);
    response.set_partition_id(partition_id_);
    response.set_iteration(incremental_iteration_);
    response.set_is_incremental(true);
    response.set_affected_count(pagerank_.getAffectedCount());

    const auto& local_ranks = pagerank_.getLocalRanks();
    const auto& updated_nodes = pagerank_.getUpdatedNodes();

    for (int64_t node : updated_nodes) {
        auto it = local_ranks.find(node);
        if (it != local_ranks.end()) {
            (*response.mutable_local_ranks())[node] = it->second;
        }
        response.add_updated_nodes(node);
    }

    response.set_local_max_delta(pagerank_.getMaxDelta());
    response.set_converged(pagerank_.isConverged());

    std::cout << "[Worker " << worker_id_
              << "] Sending incremental response (iteration: " << incremental_iteration_
              << ", updated nodes: " << updated_nodes.size()
              << ", delta: " << pagerank_.getMaxDelta()
              << ", converged: " << pagerank_.isConverged() << ")" << std::endl;

    if (!stream_->Write(response)) {
        std::cout << "[Worker " << worker_id_
                  << "] Failed to send incremental response" << std::endl;
    }
}

void RpcServer::connectToMaster() {
    std::cout << "[Worker " << worker_id_
              << "] Connecting to master at " << master_addr_ << std::endl;

    auto channel = grpc::CreateChannel(master_addr_,
                                        grpc::InsecureChannelCredentials());
    stub_ = pagerank::PageRankService::NewStub(channel);

    grpc::ClientContext context;
    stream_ = stub_->Compute(&context);

    connected_ = true;
    std::cout << "[Worker " << worker_id_ << "] Connected to master" << std::endl;

    pagerank::ComputeRequest request;
    request.mutable_control()->set_type(pagerank::ControlCommand::INIT);
    stream_->Write(request);

    pagerank::ComputeResponse response;
    while (stream_->Read(&response)) {
        if (response.has_partition()) {
            handlePartition(response.partition());
        } else if (response.has_global_ranks()) {
            handleGlobalRanks(response.global_ranks());
        }
    }

    connected_ = false;
}

void RpcServer::sendResponse() {
    if (!stream_) {
        return;
    }

    pagerank::ComputeResponse response;
    response.set_worker_id(worker_id_);
    response.set_partition_id(partition_id_);
    response.set_iteration(current_iteration_);
    response.set_local_max_delta(pagerank_.getMaxDelta());
    response.set_converged(pagerank_.isConverged());

    const auto& ranks = pagerank_.getLocalRanks();
    for (const auto& [node, rank] : ranks) {
        response.mutable_local_ranks()[node] = rank;
    }

    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (stream_) {
            stream_->Write(response);
        }
    }

    std::cout << "[Worker " << worker_id_
              << "] Iteration " << current_iteration_
              << " max_delta=" << pagerank_.getMaxDelta()
              << " converged=" << pagerank_.isConverged() << std::endl;
}

void RpcServer::start() {
    running_ = true;

    grpc::ServerBuilder builder;
    builder.AddListeningPort(listen_addr_, grpc::InsecureServerCredentials());
    builder.RegisterService(&service_);

    server_ = builder.BuildAndStart();
    std::cout << "[Worker " << worker_id_
              << "] Server listening on " << listen_addr_ << std::endl;

    connect_thread_ = std::thread(&RpcServer::connectToMaster, this);
}

void RpcServer::stop() {
    running_ = false;

    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (stream_) {
            stream_->WritesDone();
            stream_->Finish();
            stream_.reset();
        }
    }

    if (connect_thread_.joinable()) {
        connect_thread_.join();
    }

    if (server_) {
        server_->Shutdown();
        server_->Wait();
    }
}

} // namespace pagerank
