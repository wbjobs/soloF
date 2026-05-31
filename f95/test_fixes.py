import onnx
from onnx import helper, TensorProto
import numpy as np
import requests
import time

print("=" * 60)
print("TEST 1: 测试大小写不敏感节点匹配")
print("=" * 60)

X = helper.make_tensor_value_info('input', TensorProto.FLOAT, [1, 3, 64, 64])

nodes = []
prev_out = 'input'

for i in range(5):
    W = helper.make_tensor(
        name=f'conv{i}_weight',
        data_type=TensorProto.FLOAT,
        dims=[8, 3 if i == 0 else 8, 3, 3],
        vals=np.random.randn(8 * (3 if i == 0 else 8) * 3 * 3).astype(np.float32).tolist()
    )
    B = helper.make_tensor(
        name=f'conv{i}_bias',
        data_type=TensorProto.FLOAT,
        dims=[8],
        vals=np.random.randn(8).astype(np.float32).tolist()
    )
    
    conv_name = f"ConvLayer_{i}_Relu"
    conv_node = helper.make_node('Conv', 
        inputs=[prev_out, f'conv{i}_weight', f'conv{i}_bias'], 
        outputs=[f'conv_out_{i}'],
        kernel_shape=[3,3],
        pads=[1,1,1,1],
        name=conv_name
    )
    
    relu_node = helper.make_node('Relu',
        inputs=[f'conv_out_{i}'],
        outputs=[f'relu_out_{i}']
    )
    
    nodes.extend([conv_node, relu_node])
    prev_out = f'relu_out_{i}'

final_out = helper.make_tensor_value_info('final_out', TensorProto.FLOAT, [1, 8, 64, 64])
final_node = helper.make_node('Identity', inputs=[prev_out], outputs=['final_out'])
nodes.append(final_node)

graph = helper.make_graph(
    nodes=nodes,
    name='case_test_model',
    inputs=[X],
    outputs=[final_out],
    initializer=[helper.make_tensor(
        name=f'conv{i}_weight',
        data_type=TensorProto.FLOAT,
        dims=[8, 3 if i == 0 else 8, 3, 3],
        vals=np.random.randn(8 * (3 if i == 0 else 8) * 3 * 3).astype(np.float32).tolist()
    ) for i in range(5)] + [helper.make_tensor(
        name=f'conv{i}_bias',
        data_type=TensorProto.FLOAT,
        dims=[8],
        vals=np.random.randn(8).astype(np.float32).tolist()
    ) for i in range(5)]
)

model = helper.make_model(graph, producer_name='test', opset_imports=[helper.make_opsetid('', 11)])
onnx.save(model, 'e:/soloF/f95/case_test.onnx')
print("Created test model with named ConvLayer_0_Relu, ConvLayer_1_Relu, etc.")

with open('e:/soloF/f95/case_test.onnx', 'rb') as f:
    r = requests.post('http://localhost:8000/api/model/upload', files={'file': f})
print(f"Upload status: {r.status_code}")
data = r.json()
graph_data = data['graph']

print(f"\nModel has {len(graph_data['nodes'])} nodes")
print("Node names (first 8):")
for n in graph_data['nodes'][:8]:
    print(f"  - {n['id']}")

test_cases = [
    "ConvLayer_0_Relu",
    "convlayer_0_relu",
    "CONVLAYER_0_RELU",
    "ConvLayer_1_Relu",
    "conv_out_2",
    "CONV_OUT_3",
]

print("\n" + "=" * 60)
print("Testing debug with various case variations:")
print("=" * 60)

for test_name in test_cases:
    debug_data = {
        'target_node_name': test_name,
        'input_source': 'random',
        'input_shape': {'input': [1, 3, 64, 64]},
        'random_range': {'input': [-1.0, 1.0]}
    }
    
    r2 = requests.post('http://localhost:8000/api/model/debug', json=debug_data)
    status = "PASS" if r2.status_code == 200 else "FAIL"
    detail = ""
    if r2.status_code != 200:
        try:
            err = r2.json()
            detail = f" - {err.get('detail', 'unknown error')[:100]}"
        except:
            detail = f" - HTTP {r2.status_code}"
    
    print(f"  {status}: target='{test_name}' {detail}")

print("\n" + "=" * 60)
print("TEST 2: 测试大图渲染性能 (250 nodes)")
print("=" * 60)

X2 = helper.make_tensor_value_info('input', TensorProto.FLOAT, [1, 16, 32, 32])
nodes2 = []
prev = 'input'

initializers2 = []
for i in range(80):
    w = helper.make_tensor(
        name=f'w{i}',
        data_type=TensorProto.FLOAT,
        dims=[16, 16, 3, 3],
        vals=np.random.randn(16*16*3*3).astype(np.float32).tolist()
    )
    b = helper.make_tensor(
        name=f'b{i}',
        data_type=TensorProto.FLOAT,
        dims=[16],
        vals=np.random.randn(16).astype(np.float32).tolist()
    )
    initializers2.extend([w, b])
    
    conv = helper.make_node('Conv',
        inputs=[prev, f'w{i}', f'b{i}'],
        outputs=[f'c{i}'],
        kernel_shape=[3,3],
        pads=[1,1,1,1]
    )
    relu = helper.make_node('Relu',
        inputs=[f'c{i}'],
        outputs=[f'r{i}']
    )
    nodes2.extend([conv, relu])
    prev = f'r{i}'
    
    if i % 3 == 0:
        bn_gamma = helper.make_tensor(name=f'g{i}', data_type=TensorProto.FLOAT, dims=[16],
            vals=np.random.randn(16).astype(np.float32).tolist())
        bn_beta = helper.make_tensor(name=f'beta{i}', data_type=TensorProto.FLOAT, dims=[16],
            vals=np.random.randn(16).astype(np.float32).tolist())
        bn_mean = helper.make_tensor(name=f'mean{i}', data_type=TensorProto.FLOAT, dims=[16],
            vals=np.zeros(16, dtype=np.float32).tolist())
        bn_var = helper.make_tensor(name=f'var{i}', data_type=TensorProto.FLOAT, dims=[16],
            vals=np.ones(16, dtype=np.float32).tolist())
        initializers2.extend([bn_gamma, bn_beta, bn_mean, bn_var])
        
        bn = helper.make_node('BatchNormalization',
            inputs=[f'r{i}', f'g{i}', f'beta{i}', f'mean{i}', f'var{i}'],
            outputs=[f'bn{i}'],
            epsilon=1e-5
        )
        nodes2.append(bn)
        prev = f'bn{i}'

final_out2 = helper.make_tensor_value_info('output', TensorProto.FLOAT, [1, 16, 32, 32])
final_node2 = helper.make_node('Identity', inputs=[prev], outputs=['output'])
nodes2.append(final_node2)

graph2 = helper.make_graph(
    nodes=nodes2,
    name='large_test_model',
    inputs=[X2],
    outputs=[final_out2],
    initializer=initializers2
)

model2 = helper.make_model(graph2, producer_name='test', opset_imports=[helper.make_opsetid('', 11)])
onnx.save(model2, 'e:/soloF/f95/large_test.onnx')
print(f"Created large model with {len(nodes2)} nodes")

t0 = time.time()
with open('e:/soloF/f95/large_test.onnx', 'rb') as f:
    r3 = requests.post('http://localhost:8000/api/model/upload', files={'file': f})
t1 = time.time()
print(f"Upload & parse: {r3.status_code}, {t1-t0:.3f}s")

if r3.status_code == 200:
    data3 = r3.json()
    num_nodes = len(data3['graph']['nodes'])
    print(f"Parsed nodes: {num_nodes}")
    
    t2 = time.time()
    debug_data2 = {
        'target_node_name': 'r50',
        'input_source': 'random',
        'input_shape': {'input': [1, 16, 32, 32]},
        'random_range': {'input': [-1.0, 1.0]}
    }
    r4 = requests.post('http://localhost:8000/api/model/debug', json=debug_data2)
    t3 = time.time()
    print(f"Debug middle node: {r4.status_code}, {t3-t2:.3f}s")
    if r4.status_code == 200:
        data4 = r4.json()
        out_name = list(data4['outputs'].keys())[0]
        stats = data4['outputs'][out_name]
        print(f"  Output shape: {stats['shape']}")
        print(f"  Stats: min={stats['min']:.4f}, max={stats['max']:.4f}, mean={stats['mean']:.4f}")

print("\n" + "=" * 60)
print("All tests completed!")
print("=" * 60)

import os
os.remove('e:/soloF/f95/case_test.onnx')
os.remove('e:/soloF/f95/large_test.onnx')
print("Cleaned up test files")