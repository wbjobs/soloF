import io
import json
import base64
import copy
from typing import List, Dict, Optional, Any
from collections import deque

import numpy as np
import onnx
from onnx import helper, numpy_helper
from onnx import TensorProto
import onnxruntime as ort
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.responses import JSONResponse

app = FastAPI(title="ONNX Model Debugger API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

current_model: Optional[onnx.ModelProto] = None
current_model_path: Optional[str] = None
current_graph_info: Optional[Dict] = None
current_input_shapes: Dict[str, List[int]] = {}


class DebugRequest(BaseModel):
    target_node_name: str
    input_source: str
    input_shape: Optional[Dict[str, List[int]]] = None
    random_range: Optional[Dict[str, List[float]]] = None


def extract_graph_info(model: onnx.ModelProto) -> Dict:
    graph = model.graph
    nodes = []
    edges = []
    inputs = []
    outputs = []
    initializers = {}

    for init in graph.initializer:
        arr = numpy_helper.to_array(init)
        initializers[init.name] = {
            "shape": list(arr.shape),
            "dtype": str(arr.dtype)
        }

    for inp in graph.input:
        shape = []
        for dim in inp.type.tensor_type.shape.dim:
            if dim.HasField("dim_value"):
                shape.append(dim.dim_value)
            elif dim.HasField("dim_param"):
                shape.append(dim.dim_param)
            else:
                shape.append("?")
        inputs.append({
            "name": inp.name,
            "shape": shape,
            "type": "input"
        })

    for out in graph.output:
        shape = []
        for dim in out.type.tensor_type.shape.dim:
            if dim.HasField("dim_value"):
                shape.append(dim.dim_value)
            elif dim.HasField("dim_param"):
                shape.append(dim.dim_param)
            else:
                shape.append("?")
        outputs.append({
            "name": out.name,
            "shape": shape,
            "type": "output"
        })

    for i, node in enumerate(graph.node):
        attrs = {}
        for attr in node.attribute:
            try:
                if attr.HasField("f"):
                    attrs[attr.name] = attr.f
                elif attr.HasField("i"):
                    attrs[attr.name] = attr.i
                elif attr.HasField("s"):
                    attrs[attr.name] = attr.s.decode("utf-8", errors="ignore")
                elif attr.type == 1:
                    attrs[attr.name] = list(attr.floats)
                elif attr.type == 2:
                    attrs[attr.name] = list(attr.ints)
                elif attr.type == 3:
                    attrs[attr.name] = [s.decode("utf-8", errors="ignore") for s in attr.strings]
                elif attr.type == 4:
                    if attr.t.data_type != 0:
                        tensor = numpy_helper.to_array(attr.t)
                        attrs[attr.name] = tensor.tolist()
                    else:
                        attrs[attr.name] = f"<tensor: {attr.t.name}>"
                elif attr.type == 6:
                    attrs[attr.name] = list(attr.floats)
                elif attr.type == 7:
                    attrs[attr.name] = list(attr.ints)
                elif attr.type == 8:
                    attrs[attr.name] = [s.decode("utf-8", errors="ignore") for s in attr.strings]
                elif attr.type == 9:
                    attrs[attr.name] = f"<tensors: {len(attr.tensors)} items>"
                else:
                    attrs[attr.name] = f"<unsupported type: {attr.type}>"
            except Exception:
                attrs[attr.name] = f"<parse error>"

        first_output = node.output[0] if len(node.output) > 0 and node.output[0] else None
        stable_id = first_output if first_output else (node.name if node.name else f"{node.op_type}_node_{i}")

        nodes.append({
            "id": stable_id,
            "op_type": node.op_type,
            "inputs": list(node.input),
            "outputs": list(node.output),
            "attributes": attrs,
            "domain": node.domain,
            "index": i
        })
        for inp_name in node.input:
            if inp_name:
                edges.append({
                    "from": inp_name,
                    "to": stable_id,
                    "label": inp_name
                })

    return {
        "nodes": nodes,
        "edges": edges,
        "inputs": inputs,
        "outputs": outputs,
        "initializers": initializers
    }


def resolve_shapes(raw_shape: List, input_overrides: Optional[Dict[str, List[int]]]) -> List[int]:
    resolved = []
    for dim in raw_shape:
        if isinstance(dim, int):
            resolved.append(dim)
        elif isinstance(dim, str) and dim.startswith("?"):
            resolved.append(1)
        elif isinstance(dim, str):
            if input_overrides and dim in input_overrides:
                resolved.append(input_overrides[dim])
            else:
                resolved.append(1)
        else:
            resolved.append(1)
    return resolved


def generate_random_input(shape: List[int], dtype: np.dtype, low: float = -1.0, high: float = 1.0) -> np.ndarray:
    if np.issubdtype(dtype, np.floating):
        return np.random.uniform(low, high, shape).astype(dtype)
    elif np.issubdtype(dtype, np.integer):
        return np.random.randint(int(max(low, np.iinfo(dtype).min)),
                                 int(min(high, np.iinfo(dtype).max) + 1),
                                 shape).astype(dtype)
    elif np.issubdtype(dtype, np.bool_):
        return np.random.randint(0, 2, shape).astype(dtype)
    else:
        return np.random.uniform(low, high, shape).astype(np.float32)


def compute_tensor_stats(tensor: np.ndarray) -> Dict:
    flat = tensor.flatten()
    if flat.size == 0:
        return {"shape": list(tensor.shape), "dtype": str(tensor.dtype),
                "min": None, "max": None, "mean": None, "std": None,
                "histogram": None, "num_elements": 0}
    if np.issubdtype(tensor.dtype, np.floating) or np.issubdtype(tensor.dtype, np.integer):
        stats = {
            "shape": list(tensor.shape),
            "dtype": str(tensor.dtype),
            "min": float(np.min(flat)),
            "max": float(np.max(flat)),
            "mean": float(np.mean(flat)),
            "std": float(np.std(flat)),
            "num_elements": int(flat.size),
        }
        hist_counts, hist_edges = np.histogram(flat, bins=50)
        stats["histogram"] = {
            "counts": hist_counts.tolist(),
            "bin_edges": hist_edges.tolist()
        }
    else:
        stats = {
            "shape": list(tensor.shape),
            "dtype": str(tensor.dtype),
            "min": None, "max": None, "mean": None, "std": None,
            "histogram": None,
            "num_elements": int(flat.size),
        }
    return stats


def build_subgraph_model(model: onnx.ModelProto, target_node_name: str,
                         dynamic_shapes: Optional[Dict[str, List[int]]] = None) -> onnx.ModelProto:
    graph = model.graph

    target_node = None
    target_index = None
    target_lower = target_node_name.lower()

    for i, node in enumerate(graph.node):
        first_output = node.output[0] if len(node.output) > 0 and node.output[0] else None
        stable_id = first_output if first_output else (node.name if node.name else f"{node.op_type}_node_{i}")

        if (stable_id == target_node_name or
            stable_id.lower() == target_lower or
            node.name == target_node_name or
            (node.name and node.name.lower() == target_lower) or
            any(out.lower() == target_lower for out in node.output)):
            target_node = node
            target_index = i
            break

    if target_node is None:
        raise ValueError(f"Node '{target_node_name}' not found in graph")

    target_output_names = list(target_node.output)

    needed_tensor_names = set(target_output_names)
    for name in target_node.input:
        if name:
            needed_tensor_names.add(name)

    subgraph_nodes = []
    visited_nodes = set()
    node_map = {}
    for node in graph.node:
        for out in node.output:
            if out:
                node_map[out] = node

    queue = deque()
    for name in target_node.input:
        if name and name in node_map:
            queue.append(node_map[name])
            visited_nodes.add(id(node_map[name]))

    while queue:
        node = queue.popleft()
        subgraph_nodes.append(copy.deepcopy(node))
        for inp in node.input:
            if inp and inp in node_map and id(node_map[inp]) not in visited_nodes:
                visited_nodes.add(id(node_map[inp]))
                queue.append(node_map[inp])

    subgraph_nodes.reverse()
    subgraph_nodes.append(copy.deepcopy(target_node))

    subgraph_inputs = []
    subgraph_outputs = []
    subgraph_initializers = []
    subgraph_value_info = []

    model_input_names = {inp.name for inp in graph.input}
    for inp in graph.input:
        subgraph_inputs.append(copy.deepcopy(inp))

    for init in graph.initializer:
        subgraph_initializers.append(copy.deepcopy(init))

    for out_name in target_output_names:
        vi = None
        for out in graph.output:
            if out.name == out_name:
                vi = out
                break
        if vi is None:
            for vi_cand in graph.value_info:
                if vi_cand.name == out_name:
                    vi = vi_cand
                    break
        if vi is None:
            from onnx import ValueInfoProto, TensorShapeProto
            vi = ValueInfoProto()
            vi.name = out_name
            vi.type.tensor_type.elem_type = TensorProto.FLOAT
            shape = vi.type.tensor_type.shape
            for _ in range(4):
                dim = shape.dim.add()
                dim.dim_value = 1
        subgraph_outputs.append(vi)

    for vi in graph.value_info:
        subgraph_value_info.append(copy.deepcopy(vi))

    subgraph = helper.make_graph(
        nodes=subgraph_nodes,
        name=f"subgraph_{target_node_name}",
        inputs=subgraph_inputs,
        outputs=subgraph_outputs,
        initializer=subgraph_initializers,
        value_info=subgraph_value_info
    )

    opset_imports = list(model.opset_import)
    subgraph_model = helper.make_model(subgraph, opset_imports=opset_imports,
                                        producer_name="onnx-debugger",
                                        producer_version="1.0")
    subgraph_model.ir_version = model.ir_version

    return subgraph_model


def get_stable_node_id(node: onnx.NodeProto, index: int) -> str:
    first_output = node.output[0] if len(node.output) > 0 and node.output[0] else None
    return first_output if first_output else (node.name if node.name else f"{node.op_type}_node_{index}")


def find_node_by_stable_id(model: onnx.ModelProto, target_name: str):
    graph = model.graph
    target_lower = target_name.lower()
    for i, node in enumerate(graph.node):
        stable_id = get_stable_node_id(node, i)
        if (stable_id == target_name or
            stable_id.lower() == target_lower or
            node.name == target_name or
            (node.name and node.name.lower() == target_lower) or
            any(out.lower() == target_lower for out in node.output)):
            return node, i
    return None, -1


def build_pruned_model(model: onnx.ModelProto, prune_node_name: str,
                       prune_type: str = "zeros", constant_value: float = 0.0,
                       input_shapes: Optional[Dict[str, List[int]]] = None) -> onnx.ModelProto:
    graph = model.graph

    target_node, target_index = find_node_by_stable_id(model, prune_node_name)
    if target_node is None:
        raise ValueError(f"Node '{prune_node_name}' not found in graph")

    target_outputs = list(target_node.output)
    if not target_outputs:
        raise ValueError(f"Node '{prune_node_name}' has no outputs to prune")

    original_nodes = [copy.deepcopy(node) for node in graph.node]

    new_nodes = []
    new_initializers = [copy.deepcopy(init) for init in graph.initializer]
    node_counter = 0

    for i, node in enumerate(original_nodes):
        if i == target_index:
            original_node = node
            new_nodes.append(original_node)

            for output_name in target_outputs:
                pruned_output_name = f"_pruned_{output_name}"

                if prune_type == "zeros":
                    zero_tensor = helper.make_tensor(
                        name=f"_prune_zero_{node_counter}",
                        data_type=TensorProto.FLOAT,
                        dims=[1],
                        vals=[0.0]
                    )
                    new_initializers.append(zero_tensor)
                    mul_node = helper.make_node(
                        "Mul",
                        inputs=[output_name, f"_prune_zero_{node_counter}"],
                        outputs=[pruned_output_name]
                    )
                    new_nodes.append(mul_node)

                elif prune_type == "constant":
                    zero_tensor = helper.make_tensor(
                        name=f"_prune_zero_{node_counter}",
                        data_type=TensorProto.FLOAT,
                        dims=[1],
                        vals=[0.0]
                    )
                    const_tensor = helper.make_tensor(
                        name=f"_prune_const_{node_counter}",
                        data_type=TensorProto.FLOAT,
                        dims=[1],
                        vals=[float(constant_value)]
                    )
                    new_initializers.append(zero_tensor)
                    new_initializers.append(const_tensor)
                    mul_node = helper.make_node(
                        "Mul",
                        inputs=[output_name, f"_prune_zero_{node_counter}"],
                        outputs=[f"_prune_zeroed_{node_counter}"]
                    )
                    add_node = helper.make_node(
                        "Add",
                        inputs=[f"_prune_zeroed_{node_counter}", f"_prune_const_{node_counter}"],
                        outputs=[pruned_output_name]
                    )
                    new_nodes.append(mul_node)
                    new_nodes.append(add_node)

                elif prune_type == "ones":
                    zero_tensor = helper.make_tensor(
                        name=f"_prune_zero_{node_counter}",
                        data_type=TensorProto.FLOAT,
                        dims=[1],
                        vals=[0.0]
                    )
                    one_tensor = helper.make_tensor(
                        name=f"_prune_one_{node_counter}",
                        data_type=TensorProto.FLOAT,
                        dims=[1],
                        vals=[1.0]
                    )
                    new_initializers.append(zero_tensor)
                    new_initializers.append(one_tensor)
                    mul_node = helper.make_node(
                        "Mul",
                        inputs=[output_name, f"_prune_zero_{node_counter}"],
                        outputs=[f"_prune_zeroed_{node_counter}"]
                    )
                    add_node = helper.make_node(
                        "Add",
                        inputs=[f"_prune_zeroed_{node_counter}", f"_prune_one_{node_counter}"],
                        outputs=[pruned_output_name]
                    )
                    new_nodes.append(mul_node)
                    new_nodes.append(add_node)

                elif prune_type == "random_normal":
                    seed = np.random.randint(0, 1000000)
                    random_node = helper.make_node(
                        "RandomNormalLike",
                        inputs=[output_name],
                        outputs=[f"_prune_noise_{node_counter}"],
                        dtype=TensorProto.FLOAT,
                        mean=0.0,
                        scale=1.0,
                        seed=float(seed)
                    )
                    new_nodes.append(random_node)
                    identity_node = helper.make_node(
                        "Identity",
                        inputs=[f"_prune_noise_{node_counter}"],
                        outputs=[pruned_output_name]
                    )
                    new_nodes.append(identity_node)

                elif prune_type == "random_uniform":
                    seed = np.random.randint(0, 1000000)
                    random_node = helper.make_node(
                        "RandomUniformLike",
                        inputs=[output_name],
                        outputs=[f"_prune_noise_{node_counter}"],
                        dtype=TensorProto.FLOAT,
                        low=-1.0,
                        high=1.0,
                        seed=float(seed)
                    )
                    new_nodes.append(random_node)
                    identity_node = helper.make_node(
                        "Identity",
                        inputs=[f"_prune_noise_{node_counter}"],
                        outputs=[pruned_output_name]
                    )
                    new_nodes.append(identity_node)

                for j, downstream_node in enumerate(original_nodes):
                    for k, inp_name in enumerate(downstream_node.input):
                        if inp_name == output_name:
                            downstream_node.input[k] = pruned_output_name

                node_counter += 1
        else:
            new_nodes.append(node)

    pruned_graph = helper.make_graph(
        nodes=new_nodes,
        name=f"pruned_{graph.name}",
        inputs=list(graph.input),
        outputs=list(graph.output),
        initializer=new_initializers,
        value_info=list(graph.value_info)
    )

    opset_imports = list(model.opset_import)
    pruned_model = helper.make_model(pruned_graph, opset_imports=opset_imports,
                                      producer_name="onnx-debugger",
                                      producer_version="1.0")
    pruned_model.ir_version = model.ir_version

    try:
        onnx.checker.check_model(pruned_model)
    except Exception as e:
        print(f"Warning: pruned model check failed: {e}")

    return pruned_model


@app.post("/api/model/upload")
async def upload_model(file: UploadFile = File(...)):
    global current_model, current_model_path, current_graph_info, current_input_shapes

    if not file.filename.endswith(".onnx"):
        raise HTTPException(status_code=400, detail="File must be a .onnx file")

    contents = await file.read()
    try:
        model = onnx.load_from_string(contents)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse ONNX model: {str(e)}")

    try:
        onnx.checker.check_model(model)
    except Exception:
        pass

    current_model = model
    current_model_path = file.filename
    current_graph_info = extract_graph_info(model)

    current_input_shapes = {}
    for inp in current_graph_info["inputs"]:
        resolved = resolve_shapes(inp["shape"], {})
        current_input_shapes[inp["name"]] = resolved

    return JSONResponse(content={
        "status": "success",
        "filename": file.filename,
        "graph": current_graph_info,
        "resolved_input_shapes": current_input_shapes
    })


@app.get("/api/model/graph")
async def get_graph():
    if current_graph_info is None:
        raise HTTPException(status_code=404, detail="No model loaded")
    return JSONResponse(content={
        "graph": current_graph_info,
        "resolved_input_shapes": current_input_shapes
    })


@app.post("/api/model/set_input_shape")
async def set_input_shape(input_shapes: Dict[str, List[int]]):
    global current_input_shapes
    current_input_shapes.update(input_shapes)
    return JSONResponse(content={"status": "success", "resolved_input_shapes": current_input_shapes})


@app.post("/api/model/debug")
async def debug_model(request: DebugRequest):
    global current_model, current_input_shapes

    if current_model is None:
        raise HTTPException(status_code=404, detail="No model loaded")

    try:
        if request.input_shape:
            current_input_shapes.update(request.input_shape)

        try:
            subgraph_model = build_subgraph_model(current_model, request.target_node_name,
                                                   current_input_shapes)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        model_bytes = subgraph_model.SerializeToString()
        session = ort.InferenceSession(model_bytes, providers=["CPUExecutionProvider"])

        input_feeds = {}
        for inp in session.get_inputs():
            if inp.name in current_input_shapes:
                shape = current_input_shapes[inp.name]
            else:
                shape = [1]
            dtype_map = {
                "tensor(float)": np.float32,
                "tensor(float16)": np.float16,
                "tensor(double)": np.float64,
                "tensor(int32)": np.int32,
                "tensor(int64)": np.int64,
                "tensor(int8)": np.int8,
                "tensor(uint8)": np.uint8,
                "tensor(bool)": np.bool_,
            }
            dtype = dtype_map.get(inp.type, np.float32)

            if request.input_source == "random":
                low = -1.0
                high = 1.0
                if request.random_range and inp.name in request.random_range:
                    low, high = request.random_range[inp.name]
                input_feeds[inp.name] = generate_random_input(shape, dtype, low, high)
            else:
                input_feeds[inp.name] = generate_random_input(shape, dtype, -1.0, 1.0)

        output_names = [out.name for out in session.get_outputs()]
        outputs = session.run(output_names, input_feeds)

        result = {}
        for name, tensor in zip(output_names, outputs):
            result[name] = compute_tensor_stats(tensor)

        return JSONResponse(content={
            "status": "success",
            "target_node": request.target_node_name,
            "outputs": result,
            "input_info": {
                name: {
                    "shape": list(tensor.shape),
                    "dtype": str(tensor.dtype),
                    "min": float(np.min(tensor)) if tensor.size > 0 else None,
                    "max": float(np.max(tensor)) if tensor.size > 0 else None,
                }
                for name, tensor in input_feeds.items()
            }
        })

    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"Debug failed: {str(e)}\n{traceback.format_exc()}")


@app.post("/api/model/debug_with_file")
async def debug_with_file(
    target_node_name: str = Form(...),
    input_shape: Optional[str] = Form(None),
    random_range: Optional[str] = Form(None),
    npy_file: Optional[UploadFile] = File(None)
):
    global current_model, current_input_shapes

    if current_model is None:
        raise HTTPException(status_code=404, detail="No model loaded")

    try:
        shape_override = {}
        if input_shape:
            shape_override = json.loads(input_shape)
            current_input_shapes.update(shape_override)

        random_override = {}
        if random_range:
            random_override = json.loads(random_range)

        try:
            subgraph_model = build_subgraph_model(current_model, target_node_name,
                                                   current_input_shapes)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        model_bytes = subgraph_model.SerializeToString()
        session = ort.InferenceSession(model_bytes, providers=["CPUExecutionProvider"])

        input_feeds = {}
        npy_data = None
        if npy_file:
            contents = await npy_file.read()
            try:
                npy_data = np.load(io.BytesIO(contents))
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to load .npy file: {str(e)}")

        for idx, inp in enumerate(session.get_inputs()):
            if inp.name in current_input_shapes:
                shape = current_input_shapes[inp.name]
            else:
                shape = [1]

            dtype_map = {
                "tensor(float)": np.float32,
                "tensor(float16)": np.float16,
                "tensor(double)": np.float64,
                "tensor(int32)": np.int32,
                "tensor(int64)": np.int64,
                "tensor(int8)": np.int8,
                "tensor(uint8)": np.uint8,
                "tensor(bool)": np.bool_,
            }
            dtype = dtype_map.get(inp.type, np.float32)

            if npy_data is not None and idx == 0:
                input_feeds[inp.name] = npy_data.astype(dtype)
            else:
                low = -1.0
                high = 1.0
                if inp.name in random_override:
                    low, high = random_override[inp.name]
                input_feeds[inp.name] = generate_random_input(shape, dtype, low, high)

        output_names = [out.name for out in session.get_outputs()]
        outputs = session.run(output_names, input_feeds)

        result = {}
        for name, tensor in zip(output_names, outputs):
            result[name] = compute_tensor_stats(tensor)

        return JSONResponse(content={
            "status": "success",
            "target_node": target_node_name,
            "outputs": result,
            "input_info": {
                name: {
                    "shape": list(tensor.shape),
                    "dtype": str(tensor.dtype),
                    "min": float(np.min(tensor)) if tensor.size > 0 else None,
                    "max": float(np.max(tensor)) if tensor.size > 0 else None,
                }
                for name, tensor in input_feeds.items()
            }
        })

    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"Debug failed: {str(e)}\n{traceback.format_exc()}")


class PruneRequest(BaseModel):
    prune_node_name: str
    prune_type: str = "zeros"
    constant_value: Optional[float] = 0.0
    target_node_name: Optional[str] = None
    input_shape: Optional[Dict[str, List[int]]] = None
    random_range: Optional[Dict[str, List[float]]] = None


@app.post("/api/model/prune_compare")
async def prune_compare(request: PruneRequest):
    global current_model, current_input_shapes

    if current_model is None:
        raise HTTPException(status_code=404, detail="No model loaded")

    try:
        if request.input_shape:
            current_input_shapes.update(request.input_shape)

        target_node = request.target_node_name if request.target_node_name else request.prune_node_name

        subgraph_model = build_subgraph_model(current_model, target_node, current_input_shapes)
        pruned_subgraph_model = build_pruned_model(
            subgraph_model,
            request.prune_node_name,
            request.prune_type,
            request.constant_value,
            current_input_shapes
        )

        input_feeds = {}
        original_session = ort.InferenceSession(subgraph_model.SerializeToString(), providers=["CPUExecutionProvider"])
        pruned_session = ort.InferenceSession(pruned_subgraph_model.SerializeToString(), providers=["CPUExecutionProvider"])

        for inp in original_session.get_inputs():
            if inp.name in current_input_shapes:
                shape = current_input_shapes[inp.name]
            else:
                shape = [1]
            dtype_map = {
                "tensor(float)": np.float32,
                "tensor(float16)": np.float16,
                "tensor(double)": np.float64,
                "tensor(int32)": np.int32,
                "tensor(int64)": np.int64,
                "tensor(int8)": np.int8,
                "tensor(uint8)": np.uint8,
                "tensor(bool)": np.bool_,
            }
            dtype = dtype_map.get(inp.type, np.float32)
            low = -1.0
            high = 1.0
            if request.random_range and inp.name in request.random_range:
                low, high = request.random_range[inp.name]
            input_feeds[inp.name] = generate_random_input(shape, dtype, low, high)

        original_output_names = [out.name for out in original_session.get_outputs()]
        pruned_output_names = [out.name for out in pruned_session.get_outputs()]

        original_outputs = original_session.run(original_output_names, input_feeds)
        pruned_outputs = pruned_session.run(pruned_output_names, input_feeds)

        comparison = {}
        for i, name in enumerate(original_output_names):
            orig = original_outputs[i]
            pruned_name = pruned_output_names[i]
            pruned = pruned_outputs[i]

            diff = orig - pruned
            comparison[name] = {
                "original": compute_tensor_stats(orig),
                "pruned": compute_tensor_stats(pruned),
                "difference": {
                    "mean_absolute_error": float(np.mean(np.abs(diff))) if diff.size > 0 else None,
                    "max_absolute_error": float(np.max(np.abs(diff))) if diff.size > 0 else None,
                    "mean_relative_error": float(np.mean(np.abs(diff) / (np.abs(orig) + 1e-8))) if diff.size > 0 else None,
                    "cosine_similarity": float(np.sum(orig * pruned) / (np.linalg.norm(orig) * np.linalg.norm(pruned) + 1e-8)) if diff.size > 0 else None,
                    "l2_distance": float(np.linalg.norm(diff)) if diff.size > 0 else None,
                }
            }

        return JSONResponse(content={
            "status": "success",
            "prune_node": request.prune_node_name,
            "prune_type": request.prune_type,
            "constant_value": request.constant_value,
            "target_node": target_node,
            "comparison": comparison,
            "input_info": {
                name: {
                    "shape": list(tensor.shape),
                    "dtype": str(tensor.dtype),
                    "min": float(np.min(tensor)) if tensor.size > 0 else None,
                    "max": float(np.max(tensor)) if tensor.size > 0 else None,
                }
                for name, tensor in input_feeds.items()
            }
        })

    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"Prune comparison failed: {str(e)}\n{traceback.format_exc()}")


class ExportPrunedRequest(BaseModel):
    prune_node_name: str
    prune_type: str = "zeros"
    constant_value: Optional[float] = 0.0


@app.post("/api/model/export_pruned")
async def export_pruned(request: ExportPrunedRequest):
    global current_model, current_input_shapes

    if current_model is None:
        raise HTTPException(status_code=404, detail="No model loaded")

    try:
        pruned_model = build_pruned_model(
            current_model,
            request.prune_node_name,
            request.prune_type,
            request.constant_value,
            current_input_shapes
        )

        model_bytes = pruned_model.SerializeToString()

        from fastapi.responses import Response
        filename = f"pruned_{request.prune_node_name.replace('/', '_')[:50]}.onnx"

        return Response(
            content=model_bytes,
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}\n{traceback.format_exc()}")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)