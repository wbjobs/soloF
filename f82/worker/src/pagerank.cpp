#include "pagerank.h"

#include <cmath>
#include <set>
#include <algorithm>
#include <numeric>

namespace pagerank {

PageRank::PageRank() = default;

void PageRank::initPartition(const std::vector<int64_t>& local_nodes,
                              const std::vector<Edge>& edges,
                              const std::vector<int64_t>& ghost_nodes) {
    std::lock_guard<std::mutex> lock(mutex_);

    local_nodes_ = local_nodes;
    ghost_nodes_ = ghost_nodes;
    edges_ = edges;

    out_neighbors_.clear();
    in_neighbors_.clear();
    out_degree_.clear();

    std::set<int64_t> local_set(local_nodes.begin(), local_nodes.end());
    std::set<int64_t> ghost_set(ghost_nodes.begin(), ghost_nodes.end());

    for (const auto& node : local_nodes_) {
        out_neighbors_[node] = std::vector<int64_t>();
        in_neighbors_[node] = std::vector<int64_t>();
        out_degree_[node] = 0;
    }
    for (const auto& node : ghost_nodes_) {
        out_neighbors_[node] = std::vector<int64_t>();
        in_neighbors_[node] = std::vector<int64_t>();
        out_degree_[node] = 0;
    }

    for (const auto& edge : edges_) {
        if (local_set.count(edge.from) || ghost_set.count(edge.from)) {
            out_neighbors_[edge.from].push_back(edge.to);
            out_degree_[edge.from]++;
        }
        if (local_set.count(edge.to) || ghost_set.count(edge.to)) {
            in_neighbors_[edge.to].push_back(edge.from);
        }
    }

    double initial_rank = 1.0 / static_cast<double>(local_nodes_.size());
    local_ranks_.clear();
    prev_ranks_.clear();
    for (const auto& node : local_nodes_) {
        local_ranks_[node] = initial_rank;
        prev_ranks_[node] = initial_rank;
    }

    max_delta_ = 0.0;
    converged_ = false;
}

void PageRank::setDampingFactor(double factor) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (factor > 0.0 && factor < 1.0) {
        damping_factor_ = factor;
    }
}

void PageRank::setConvergenceThreshold(double threshold) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (threshold > 0.0) {
        convergence_threshold_ = threshold;
    }
}

void PageRank::setMaxPropagationLevel(int32_t level) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (level > 0) {
        max_propagation_level_ = level;
    }
}

void PageRank::computeIteration(int32_t iteration,
                                 const std::map<int64_t, double>& global_ranks) {
    std::lock_guard<std::mutex> lock(mutex_);

    for (const auto& [node, rank] : local_ranks_) {
        prev_ranks_[node] = rank;
    }

    double teleportation = (1.0 - damping_factor_) / static_cast<double>(local_nodes_.size());

    max_delta_ = 0.0;
    bool all_converged = true;

    for (const auto& node : local_nodes_) {
        double rank_sum = 0.0;

        const auto& in_nbrs = in_neighbors_[node];
        for (const auto& src : in_nbrs) {
            double src_rank = 0.0;
            auto it = global_ranks.find(src);
            if (it != global_ranks.end()) {
                src_rank = it->second;
            }

            int src_out_degree = out_degree_[src];
            if (src_out_degree > 0) {
                rank_sum += src_rank / static_cast<double>(src_out_degree);
            }
        }

        double new_rank = teleportation + damping_factor_ * rank_sum;
        local_ranks_[node] = new_rank;

        double delta = std::abs(new_rank - prev_ranks_[node]);
        if (delta > max_delta_) {
            max_delta_ = delta;
        }
        if (delta > convergence_threshold_) {
            all_converged = false;
        }
    }

    converged_ = all_converged && iteration > 0;
}

const std::map<int64_t, double>& PageRank::getLocalRanks() const {
    return local_ranks_;
}

double PageRank::getMaxDelta() const {
    return max_delta_;
}

bool PageRank::isConverged() const {
    return converged_;
}

void PageRank::reset() {
    std::lock_guard<std::mutex> lock(mutex_);

    double initial_rank = 1.0 / static_cast<double>(local_nodes_.size());
    for (const auto& node : local_nodes_) {
        local_ranks_[node] = initial_rank;
        prev_ranks_[node] = initial_rank;
    }
    max_delta_ = 0.0;
    converged_ = false;
    incremental_mode_ = false;
    affected_nodes_set_.clear();
    updated_nodes_.clear();
    propagation_levels_.clear();
}

void PageRank::resetIncremental() {
    std::lock_guard<std::mutex> lock(mutex_);
    incremental_mode_ = false;
    affected_nodes_set_.clear();
    updated_nodes_.clear();
    propagation_levels_.clear();
    max_delta_ = 0.0;
    converged_ = false;
}

void PageRank::addEdge(int64_t from, int64_t to) {
    std::lock_guard<std::mutex> lock(mutex_);

    bool from_exists = out_neighbors_.find(from) != out_neighbors_.end();
    bool to_exists = out_neighbors_.find(to) != out_neighbors_.end();

    if (!from_exists) {
        out_neighbors_[from] = std::vector<int64_t>();
        in_neighbors_[from] = std::vector<int64_t>();
        out_degree_[from] = 0;
    }
    if (!to_exists) {
        out_neighbors_[to] = std::vector<int64_t>();
        in_neighbors_[to] = std::vector<int64_t>();
        out_degree_[to] = 0;
    }

    out_neighbors_[from].push_back(to);
    out_degree_[from]++;
    in_neighbors_[to].push_back(from);

    edges_.push_back({from, to});
}

void PageRank::removeEdge(int64_t from, int64_t to) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto it_out = out_neighbors_.find(from);
    if (it_out != out_neighbors_.end()) {
        auto& neighbors = it_out->second;
        neighbors.erase(std::remove(neighbors.begin(), neighbors.end(), to), neighbors.end());
        out_degree_[from] = static_cast<int>(neighbors.size());
    }

    auto it_in = in_neighbors_.find(to);
    if (it_in != in_neighbors_.end()) {
        auto& neighbors = it_in->second;
        neighbors.erase(std::remove(neighbors.begin(), neighbors.end(), from), neighbors.end());
    }

    edges_.erase(std::remove_if(edges_.begin(), edges_.end(),
        [from, to](const Edge& e) { return e.from == from && e.to == to; }),
        edges_.end());
}

void PageRank::computeIncrementalIteration(
    int32_t iteration,
    const std::vector<int64_t>& affected_nodes,
    const std::vector<Edge>& changed_edges,
    const std::map<int64_t, double>& initial_ranks) {

    std::lock_guard<std::mutex> lock(mutex_);

    incremental_mode_ = true;
    max_delta_ = 0.0;
    converged_ = false;
    updated_nodes_.clear();

    if (affected_nodes.empty()) {
        converged_ = true;
        return;
    }

    affected_nodes_set_.clear();
    propagation_levels_.clear();

    for (const auto& node : affected_nodes) {
        affected_nodes_set_.insert(node);
        propagation_levels_[node] = 0;

        auto it = initial_ranks.find(node);
        if (it != initial_ranks.end()) {
            local_ranks_[node] = it->second;
            prev_ranks_[node] = it->second;
        } else {
            double initial_rank = 1.0 / static_cast<double>(local_nodes_.size() + 1);
            local_ranks_[node] = initial_rank;
            prev_ranks_[node] = initial_rank;
        }

        propagateAffectedNodes(node, max_propagation_level_);
    }

    applyEdgeChanges(changed_edges);

    std::vector<int64_t> local_affected_nodes;
    for (const auto& node : affected_nodes_set_) {
        if (isLocalAffectedNode(node)) {
            local_affected_nodes.push_back(node);
        }
    }

    if (local_affected_nodes.empty()) {
        converged_ = true;
        return;
    }

    for (const auto& node : local_affected_nodes) {
        prev_ranks_[node] = local_ranks_[node];
    }

    double total_nodes = static_cast<double>(local_nodes_.size() + ghost_nodes_.size());
    double teleportation = (1.0 - damping_factor_) / total_nodes;

    max_delta_ = 0.0;
    bool all_converged = true;

    for (const auto& node : local_affected_nodes) {
        double rank_sum = 0.0;

        const auto& in_nbrs = in_neighbors_[node];
        for (const auto& src : in_nbrs) {
            double src_rank = 0.0;
            auto it = initial_ranks.find(src);
            if (it != initial_ranks.end()) {
                src_rank = it->second;
            } else if (local_ranks_.find(src) != local_ranks_.end()) {
                src_rank = local_ranks_[src];
            } else {
                src_rank = 1.0 / total_nodes;
            }

            int src_out_degree = out_degree_[src];
            if (src_out_degree > 0) {
                rank_sum += src_rank / static_cast<double>(src_out_degree);
            }
        }

        double new_rank = teleportation + damping_factor_ * rank_sum;
        local_ranks_[node] = new_rank;

        double delta = std::abs(new_rank - prev_ranks_[node]);
        if (delta > max_delta_) {
            max_delta_ = delta;
        }
        if (delta > convergence_threshold_) {
            all_converged = false;
        }

        updated_nodes_.push_back(node);
    }

    converged_ = all_converged && iteration > 0;
}

void PageRank::propagateAffectedNodes(int64_t start_node, int32_t max_level) {
    std::queue<std::pair<int64_t, int32_t>> q;
    q.push({start_node, 0});

    std::unordered_set<int64_t> visited;
    visited.insert(start_node);

    while (!q.empty()) {
        auto [node, level] = q.front();
        q.pop();

        if (level >= max_level) {
            continue;
        }

        auto it_out = out_neighbors_.find(node);
        if (it_out != out_neighbors_.end()) {
            for (int64_t neighbor : it_out->second) {
                if (visited.find(neighbor) == visited.end()) {
                    visited.insert(neighbor);
                    affected_nodes_set_.insert(neighbor);
                    propagation_levels_[neighbor] = level + 1;
                    q.push({neighbor, level + 1});
                }
            }
        }

        auto it_in = in_neighbors_.find(node);
        if (it_in != in_neighbors_.end()) {
            for (int64_t neighbor : it_in->second) {
                if (visited.find(neighbor) == visited.end()) {
                    visited.insert(neighbor);
                    affected_nodes_set_.insert(neighbor);
                    propagation_levels_[neighbor] = level + 1;
                    q.push({neighbor, level + 1});
                }
            }
        }
    }
}

bool PageRank::isLocalAffectedNode(int64_t node) const {
    for (int64_t local_node : local_nodes_) {
        if (local_node == node) {
            return true;
        }
    }
    return false;
}

void PageRank::applyEdgeChanges(const std::vector<Edge>& changed_edges) {
    for (const auto& edge : changed_edges) {
        bool edge_exists = false;
        auto it = out_neighbors_.find(edge.from);
        if (it != out_neighbors_.end()) {
            for (int64_t to : it->second) {
                if (to == edge.to) {
                    edge_exists = true;
                    break;
                }
            }
        }

        if (!edge_exists) {
            addEdge(edge.from, edge.to);
        }
    }
}

} // namespace pagerank
