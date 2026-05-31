class_name Delaunay
extends RefCounted

class Triangle extends RefCounted:
	var a: Vector2
	var b: Vector2
	var c: Vector2
	var circum_center: Vector2
	var circum_radius_squared: float

	func _init(p_a: Vector2, p_b: Vector2, p_c: Vector2):
		a = p_a
		b = p_b
		c = p_c
		_calculate_circumcircle()

	func _calculate_circumcircle() -> void:
		var ax: float = a.x
		var ay: float = a.y
		var bx: float = b.x
		var by: float = b.y
		var cx: float = c.x
		var cy: float = c.y

		var d: float = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
		if abs(d) < 0.0001:
			circum_center = (a + b + c) / 3.0
			circum_radius_squared = 999999999.0
			return

		var ux: float = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
		var uy: float = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d

		circum_center = Vector2(ux, uy)
		circum_radius_squared = a.distance_squared_to(circum_center)

	func contains_point(p: Vector2) -> bool:
		return p.distance_squared_to(circum_center) <= circum_radius_squared + 0.0001

	func has_edge(e_start: Vector2, e_end: Vector2) -> bool:
		return (_points_equal(a, e_start) and _points_equal(b, e_end)) or \
			   (_points_equal(b, e_start) and _points_equal(a, e_end)) or \
			   (_points_equal(b, e_start) and _points_equal(c, e_end)) or \
			   (_points_equal(c, e_start) and _points_equal(b, e_end)) or \
			   (_points_equal(c, e_start) and _points_equal(a, e_end)) or \
			   (_points_equal(a, e_start) and _points_equal(c, e_end))

	func _points_equal(p1: Vector2, p2: Vector2) -> bool:
		return p1.distance_squared_to(p2) < 0.01

	func shares_vertex_with(other: Triangle) -> bool:
		var points: Array = [a, b, c]
		for p in points:
			if other._points_equal(other.a, p) or other._points_equal(other.b, p) or other._points_equal(other.c, p):
				return true
		return false

func triangulate(points: Array) -> Array:
	if points.size() < 3:
		return []

	var min_x: float = 1e9
	var min_y: float = 1e9
	var max_x: float = -1e9
	var max_y: float = -1e9

	for p in points:
		if p.x < min_x:
			min_x = p.x
		if p.y < min_y:
			min_y = p.y
		if p.x > max_x:
			max_x = p.x
		if p.y > max_y:
			max_y = p.y

	var dx: float = max_x - min_x
	var dy: float = max_y - min_y
	var delta_max: float = max(dx, dy)
	var mid_x: float = (min_x + max_x) / 2.0
	var mid_y: float = (min_y + max_y) / 2.0

	var p1: Vector2 = Vector2(mid_x - 20.0 * delta_max, mid_y - delta_max)
	var p2: Vector2 = Vector2(mid_x, mid_y + 20.0 * delta_max)
	var p3: Vector2 = Vector2(mid_x + 20.0 * delta_max, mid_y - delta_max)

	var triangles: Array = []
	var super_triangle: Triangle = Triangle.new(p1, p2, p3)
	triangles.append(super_triangle)

	for point in points:
		var bad_triangles: Array = []
		for tri in triangles:
			if tri.contains_point(point):
				bad_triangles.append(tri)

		var polygon: Array = []
		for tri in bad_triangles:
			if not _edge_is_shared(tri.a, tri.b, bad_triangles, tri):
				polygon.append([tri.a, tri.b])
			if not _edge_is_shared(tri.b, tri.c, bad_triangles, tri):
				polygon.append([tri.b, tri.c])
			if not _edge_is_shared(tri.c, tri.a, bad_triangles, tri):
				polygon.append([tri.c, tri.a])

		for tri in bad_triangles:
			triangles.erase(tri)

		for edge in polygon:
			var new_tri: Triangle = Triangle.new(edge[0], edge[1], point)
			triangles.append(new_tri)

	var final_triangles: Array = []
	for tri in triangles:
		if not (tri._points_equal(tri.a, p1) or tri._points_equal(tri.a, p2) or tri._points_equal(tri.a, p3) or \
				tri._points_equal(tri.b, p1) or tri._points_equal(tri.b, p2) or tri._points_equal(tri.b, p3) or \
				tri._points_equal(tri.c, p1) or tri._points_equal(tri.c, p2) or tri._points_equal(tri.c, p3)):
			final_triangles.append(tri)

	return final_triangles

func _edge_is_shared(e_a: Vector2, e_b: Vector2, triangles: Array, exclude_tri: Triangle) -> bool:
	for tri in triangles:
		if tri == exclude_tri:
			continue
		if tri.has_edge(e_a, e_b):
			return true
	return false

func get_edges(triangles: Array) -> Array:
	var edges: Array = []
	var edge_keys: Dictionary = Dictionary()

	for tri in triangles:
		_add_edge(edges, edge_keys, tri.a, tri.b)
		_add_edge(edges, edge_keys, tri.b, tri.c)
		_add_edge(edges, edge_keys, tri.c, tri.a)

	return edges

func _add_edge(edges: Array, edge_keys: Dictionary, p1: Vector2, p2: Vector2) -> void:
	var key1: String = str(p1.x) + "," + str(p1.y) + "-" + str(p2.x) + "," + str(p2.y)
	var key2: String = str(p2.x) + "," + str(p2.y) + "-" + str(p1.x) + "," + str(p1.y)

	if edge_keys.has(key1) or edge_keys.has(key2):
		return

	edge_keys[key1] = true
	edge_keys[key2] = true
	edges.append([p1, p2])
