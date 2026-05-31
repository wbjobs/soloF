#pragma once

#include <cstdint>
#include <map>
#include <vector>
#include <string>
#include <mutex>
#include <atomic>
#include <memory>
#include <unordered_set>
#include <unordered_map>
#include <queue>

namespace pagerank {

struct Edge {
    int64_t from;
    int64_t to;
};

class PageRank {
public:
    PageRank();
    ~PageRank() = default;

    void initPartition(const std::vector<int64_t>& local_nodes,
                       const std::vector<Edge>& edges,
                       const std::vector<int64_t>& ghost_nodes);

    void setDampingFactor(double factor);
    void setConvergenceThreshold(double threshold);
    void setMaxPropagationLevel(int32_t level);

    void computeIteration(int32_t iteration,
                          const std::map<int64_t, double>& global_ranks);

    void computeIncrementalIteration(int32_t iteration,
                                     const std::vector<int64_t>& affected_nodes,
                                     const std::vector<Edge>& changed_edges,
                                     const std::map<int64_t, double>& initial_ranks);

    const std::map<int64_t, double>& getLocalRanks() const;
    double getMaxDelta() const;
    bool isConverged() const;

    const std::vector<int64_t>& getUpdatedNodes() const { return updated_nodes_; }
    int32_t getAffectedCount() const { return static_cast<int32_t>(affected_nodes_set_.size()); }
    bool isIncrementalMode() const { return incremental_mode_; }

    void reset();
    void resetIncremental();

    const std::vector<int64_t>& getLocalNodes() const { return local_nodes_; }
    const std::vector<int64_t>& getGhostNodes() const { return ghost_nodes_; }
    size_t getLocalNodeCount() const { return local_nodes_.size(); }

    void addEdge(int64_t from, int64_t to);
    void removeEdge(int64_t from, int64_t to);

private:
    void propagateAffectedNodes(int64_t start_node, int32_t max_level);
    bool isLocalAffectedNode(int64_t node) const;
    void applyEdgeChanges(const std::vector<Edge>& changed_edges);

    std::vector<int64_t> local_nodes_;
    std::vector<int64_t> ghost_nodes_;
    std::vector<Edge> edges_;

    std::map<int64_t, std::vector<int64_t>> out_neighbors_;
    std::map<int64_t, std::vector<int64_t>> in_neighbors_;
    std::map<int64_t, int> out_degree_;

    std::map<int64_t, double> local_ranks_;
    std::map<int64_t, double> prev_ranks_;

    double damping_factor_ = 0.85;
    double convergence_threshold_ = 0.0001;
    double max_delta_ = 0.0;
    bool converged_ = false;

    bool incremental_mode_ = false;
    int32_t max_propagation_level_ = 3;
    std::unordered_set<int64_t> affected_nodes_set_;
    std::vector<int64_t> updated_nodes_;
    std::unordered_map<int64_t, int> propagation_levels_;

    mutable std::mutex mutex_;
};

} // namespace pagerank
