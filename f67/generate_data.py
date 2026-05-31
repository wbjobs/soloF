import json
import random
import sys

def generate_network(layer_sizes, filename):
    random.seed(42)
    
    layers = []
    for i, size in enumerate(layer_sizes):
        if i == 0:
            name = "输入层"
        elif i == len(layer_sizes) - 1:
            name = "输出层"
        else:
            name = f"隐藏层{i}"
        layers.append({"name": name, "neurons": size})
    
    weights = []
    for i in range(len(layer_sizes) - 1):
        layer_weights = []
        for _ in range(layer_sizes[i]):
            neuron_weights = [round(random.uniform(-1, 1), 4) for _ in range(layer_sizes[i + 1])]
            layer_weights.append(neuron_weights)
        weights.append(layer_weights)
    
    network = {"layers": layers, "weights": weights}
    
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(network, f, ensure_ascii=False)
    
    total_neurons = sum(layer_sizes)
    total_connections = sum(layer_sizes[i] * layer_sizes[i+1] for i in range(len(layer_sizes)-1))
    print(f"生成 {filename}:")
    print(f"  网络结构: {' → '.join(map(str, layer_sizes))}")
    print(f"  神经元总数: {total_neurons:,}")
    print(f"  连接总数: {total_connections:,}")
    print()

if __name__ == "__main__":
    generate_network([4, 5, 3, 2], "network.json")
    generate_network([50, 50, 50, 50, 10], "network-large.json")
    generate_network([100, 100, 100, 100, 50], "network-huge.json")
