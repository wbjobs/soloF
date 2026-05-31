class_name StreetNetwork
extends RefCounted

class StreetEdge extends RefCounted:
	var start: Vector2
	var end: Vector2
	var length: float

	func _init(p_start: Vector2, p_end: Vector2):
		start = p_start
		end = p_end
		length = start.distance_to(end)

var edges: Array = []
var adjacency: Dictionary = Dictionary()

func _init() -> void:
	pass

func build_from_delaunay_edges(delaunay_edges: Array, max_edge_length: float = 300.0) -> void:
	edges.clear()
	adjacency.clear()

	for edge in delaunay_edges:
		var p1: Vector2 = edge[0]
		var p2: Vector2 = edge[1]
		var len: float = p1.distance_to(p2)

		if len <= max_edge_length:
			var street_edge: StreetEdge = StreetEdge.new(p1, p2)
			edges.append(street_edge)
			_add_to_adjacency(p1, p2)
			_add_to_adjacency(p2, p1)

func _add_to_adjacency(from_point: Vector2, to_point: Vector2) -> void:
	var key: String = _point_key(from_point)
	if not adjacency.has(key):
		adjacency[key] = []
	adjacency[key].append(to_point)

func _point_key(p: Vector2) -> String:
	return str(round(p.x * 100) / 100.0) + "," + str(round(p.y * 100) / 100.0)

func get_neighbors(point: Vector2) -> Array:
	var key: String = _point_key(point)
	if adjacency.has(key):
		return adjacency[key]
	return []

func get_all_intersections() -> Array:
	var points: Array = []
	var point_keys: Dictionary = Dictionary()

	for edge in edges:
		var key1: String = _point_key(edge.start)
		var key2: String = _point_key(edge.end)
		if not point_keys.has(key1):
			point_keys[key1] = true
			points.append(edge.start)
		if not point_keys.has(key2):
			point_keys[key2] = true
			points.append(edge.end)

	return points

func relax_points(iterations: int = 1, relaxation_strength: float = 0.1) -> void:
	for i in range(iterations):
		var new_positions: Dictionary = Dictionary()
		var intersections: Array = get_all_intersections()

		for point in intersections:
			var neighbors: Array = get_neighbors(point)
			if neighbors.size() == 0:
				continue

			var center: Vector2 = Vector2.ZERO
			for n in neighbors:
				center += n
			center /= neighbors.size()

			var new_pos: Vector2 = point.lerp(center, relaxation_strength)
			new_positions[_point_key(point)] = new_pos

		for edge in edges:
			var key_start: String = _point_key(edge.start)
			var key_end: String = _point_key(edge.end)

			if new_positions.has(key_start):
				edge.start = new_positions[key_start]
			if new_positions.has(key_end):
				edge.end = new_positions[key_end]

		_rebuild_adjacency()

func _rebuild_adjacency() -> void:
	adjacency.clear()
	for edge in edges:
		_add_to_adjacency(edge.start, edge.end)
		_add_to_adjacency(edge.end, edge.start)

func segments_intersect(a1: Vector2, a2: Vector2, b1: Vector2, b2: Vector2, ignore_endpoints: bool = true) -> bool:
	var denom: float = (b2.y - b1.y) * (a2.x - a1.x) - (b2.x - b1.x) * (a2.y - a1.y)
	if abs(denom) < 0.0001:
		return false

	var ua: float = ((b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x)) / denom
	var ub: float = ((a2.x - a1.x) * (a1.y - b1.y) - (a2.y - a1.y) * (a1.x - b1.x)) / denom

	if ignore_endpoints:
		if ua > 0.001 and ua < 0.999 and ub > 0.001 and ub < 0.999:
			return true
	else:
		if ua >= 0.0 and ua <= 1.0 and ub >= 0.0 and ub <= 1.0:
			return true

	return false

func remove_intersecting_edges() -> void:
	var edges_to_remove: Dictionary = Dictionary()
	var num_edges: int = edges.size()

	for i in range(num_edges):
		if edges_to_remove.has(i):
			continue
		var edge_a: StreetEdge = edges[i]
		for j in range(i + 1, num_edges):
			if edges_to_remove.has(j):
				continue
			var edge_b: StreetEdge = edges[j]

			if _shares_endpoint(edge_a, edge_b):
				continue

			if segments_intersect(edge_a.start, edge_a.end, edge_b.start, edge_b.end):
				if edge_a.length >= edge_b.length:
					edges_to_remove[i] = true
					break
				else:
					edges_to_remove[j] = true

	var new_edges: Array = []
	for i in range(num_edges):
		if not edges_to_remove.has(i):
			new_edges.append(edges[i])

	edges = new_edges
	_rebuild_adjacency()

func _shares_endpoint(edge_a: StreetEdge, edge_b: StreetEdge) -> bool:
	var tolerance: float = 0.01
	return edge_a.start.distance_squared_to(edge_b.start) < tolerance or \
		   edge_a.start.distance_squared_to(edge_b.end) < tolerance or \
		   edge_a.end.distance_squared_to(edge_b.start) < tolerance or \
		   edge_a.end.distance_squared_to(edge_b.end) < tolerance

func split_edges_at_intersections() -> void:
	var new_edges: Array = []
	var split_points: Dictionary = Dictionary()
	var num_edges: int = edges.size()

	for i in range(num_edges):
		var edge: StreetEdge = edges[i]
		var edge_splits: Array = [0.0, 1.0]

		for j in range(num_edges):
			if i == j:
				continue
			var other: StreetEdge = edges[j]
			if _shares_endpoint(edge, other):
				continue

			var t: float = _get_intersection_t(edge.start, edge.end, other.start, other.end)
			if t > 0.001 and t < 0.999:
				edge_splits.append(t)

		edge_splits.sort()

		for k in range(edge_splits.size() - 1):
			var t1: float = edge_splits[k]
			var t2: float = edge_splits[k + 1]
			if t2 - t1 < 0.001:
				continue
			var p1: Vector2 = edge.start + (edge.end - edge.start) * t1
			var p2: Vector2 = edge.start + (edge.end - edge.start) * t2
			new_edges.append(StreetEdge.new(p1, p2))

	edges = new_edges
	_rebuild_adjacency()

func _get_intersection_t(a1: Vector2, a2: Vector2, b1: Vector2, b2: Vector2) -> float:
	var denom: float = (b2.y - b1.y) * (a2.x - a1.x) - (b2.x - b1.x) * (a2.y - a1.y)
	if abs(denom) < 0.0001:
		return -1.0
	var ua: float = ((b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x)) / denom
	var ub: float = ((a2.x - a1.x) * (a1.y - b1.y) - (a2.y - a1.y) * (a1.x - b1.x)) / denom
	if ua >= 0.0 and ua <= 1.0 and ub >= 0.0 and ub <= 1.0:
		return ua
	return -1.0
