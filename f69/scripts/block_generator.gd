class_name BlockGenerator
extends RefCounted

enum BlockType {
	RESIDENTIAL,
	COMMERCIAL,
	PARK,
	INDUSTRIAL
}

class Block extends RefCounted:
	var polygon: PackedVector2Array
	var area: float
	var centroid: Vector2
	var block_type: BlockType = BlockType.RESIDENTIAL

	func _init(p_polygon: PackedVector2Array):
		polygon = p_polygon
		area = _calculate_area()
		centroid = _calculate_centroid()

	func _calculate_area() -> float:
		var a: float = 0.0
		var n: int = polygon.size()
		for i in range(n):
			var j: int = (i + 1) % n
			a += polygon[i].x * polygon[j].y
			a -= polygon[j].x * polygon[i].y
		return abs(a) / 2.0

	func _calculate_centroid() -> Vector2:
		var cx: float = 0.0
		var cy: float = 0.0
		var n: int = polygon.size()
		var signed_area: float = 0.0

		for i in range(n):
			var j: int = (i + 1) % n
			var cross: float = polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y
			signed_area += cross
			cx += (polygon[i].x + polygon[j].x) * cross
			cy += (polygon[i].y + polygon[j].y) * cross

		signed_area *= 0.5
		if abs(signed_area) < 0.001:
			var avg: Vector2 = Vector2.ZERO
			for p in polygon:
				avg += p
			return avg / polygon.size()
		var factor: float = 1.0 / (6.0 * signed_area)
		return Vector2(cx * factor, cy * factor)

func generate_blocks(street_network: StreetNetwork, area_size: Vector2, min_block_area: float = 500.0, max_aspect_ratio: float = 5.0, seed: int = 0) -> Array:
	var blocks: Array = []
	var edges: Array = street_network.edges

	if edges.size() == 0:
		return blocks

	var rng: RandomNumberGenerator = RandomNumberGenerator.new()
	if seed == 0:
		rng.randomize()
	else:
		rng.seed = seed

	var edge_usage: Dictionary = Dictionary()
	for i in range(edges.size()):
		edge_usage[i] = [false, false]

	for edge_idx in range(edges.size()):
		for dir in range(2):
			if not edge_usage[edge_idx][dir]:
				var cycle: Array = _trace_cycle(edge_idx, dir, edges, edge_usage, street_network)
				if cycle.size() >= 3:
					var cleaned_cycle: Array = _clean_cycle(cycle)
					if cleaned_cycle.size() < 3:
						continue

					var block_polygon: PackedVector2Array = PackedVector2Array()
					for p in cleaned_cycle:
						block_polygon.append(p)

					if not _is_simple_polygon(block_polygon):
						continue

					if not _is_counter_clockwise(block_polygon):
						continue

					var block: Block = Block.new(block_polygon)
					if block.area >= min_block_area and block.area < area_size.x * area_size.y * 0.5:
						if _is_valid_block(block, area_size):
							if _has_good_shape(block, max_aspect_ratio):
								_assign_block_type(block, rng)
								blocks.append(block)

	return blocks

func _assign_block_type(block: Block, rng: RandomNumberGenerator) -> void:
	var compactness: float = _calculate_compactness(block)
	var aspect_ratio: float = _calculate_aspect_ratio(block)

	var type_scores: Dictionary = {
		BlockType.RESIDENTIAL: 0.0,
		BlockType.COMMERCIAL: 0.0,
		BlockType.PARK: 0.0,
		BlockType.INDUSTRIAL: 0.0
	}

	type_scores[BlockType.RESIDENTIAL] = 1.0
	if block.area < 1500:
		type_scores[BlockType.RESIDENTIAL] += 1.5
	elif block.area < 3000:
		type_scores[BlockType.RESIDENTIAL] += 0.5

	type_scores[BlockType.COMMERCIAL] = 0.3
	if compactness > 0.6:
		type_scores[BlockType.COMMERCIAL] += 0.8
	if aspect_ratio < 2.0:
		type_scores[BlockType.COMMERCIAL] += 0.4
	if block.area > 1000 and block.area < 4000:
		type_scores[BlockType.COMMERCIAL] += 0.5

	type_scores[BlockType.PARK] = 0.2
	if block.area > 3000:
		type_scores[BlockType.PARK] += 1.5
	elif block.area > 2000:
		type_scores[BlockType.PARK] += 0.8
	if compactness < 0.4:
		type_scores[BlockType.PARK] += 0.5

	type_scores[BlockType.INDUSTRIAL] = 0.15
	if block.area > 2500:
		type_scores[BlockType.INDUSTRIAL] += 0.8
	if aspect_ratio > 2.5:
		type_scores[BlockType.INDUSTRIAL] += 0.4

	var total_score: float = 0.0
	for key in type_scores.keys():
		total_score += type_scores[key]

	var random_val: float = rng.randf() * total_score
	var cumulative: float = 0.0

	for key in type_scores.keys():
		cumulative += type_scores[key]
		if random_val <= cumulative:
			block.block_type = key
			return

	block.block_type = BlockType.RESIDENTIAL

func _calculate_compactness(block: Block) -> float:
	var n: int = block.polygon.size()
	var total_edge_length: float = 0.0
	for i in range(n):
		var j: int = (i + 1) % n
		total_edge_length += block.polygon[i].distance_to(block.polygon[j])

	if total_edge_length < 0.001:
		return 0.0

	return (4.0 * PI * block.area) / (total_edge_length * total_edge_length)

func _calculate_aspect_ratio(block: Block) -> float:
	var min_x: float = 1e9
	var max_x: float = -1e9
	var min_y: float = 1e9
	var max_y: float = -1e9

	for p in block.polygon:
		min_x = min(min_x, p.x)
		max_x = max(max_x, p.x)
		min_y = min(min_y, p.y)
		max_y = max(max_y, p.y)

	var width: float = max_x - min_x
	var height: float = max_y - min_y

	if width < 0.1 or height < 0.1:
		return 1.0

	return max(width, height) / min(width, height)

func _trace_cycle(start_edge_idx: int, start_dir: int, edges: Array, edge_usage: Dictionary, street_network: StreetNetwork) -> Array:
	var cycle: Array = []
	var current_edge_idx: int = start_edge_idx
	var current_dir: int = start_dir
	var max_iterations: int = edges.size() * 4
	var iterations: int = 0

	while iterations < max_iterations:
		if edge_usage[current_edge_idx][current_dir]:
			break

		edge_usage[current_edge_idx][current_dir] = true

		var edge: StreetNetwork.StreetEdge = edges[current_edge_idx]
		var current_point: Vector2
		var prev_point: Vector2

		if current_dir == 0:
			current_point = edge.end
			prev_point = edge.start
		else:
			current_point = edge.start
			prev_point = edge.end

		if cycle.size() == 0:
			cycle.append(prev_point)
		cycle.append(current_point)

		if cycle.size() > 3:
			var first_point: Vector2 = cycle[0]
			if current_point.distance_squared_to(first_point) < 1.0:
				cycle.pop_back()
				break

		var neighbors: Array = street_network.get_neighbors(current_point)
		if neighbors.size() < 2:
			break

		var next_edge_idx: int = -1
		var next_dir: int = -1
		var min_signed_angle: float = 1e9

		for n in neighbors:
			if n.distance_squared_to(prev_point) < 0.1:
				continue

			var to_neighbor: Vector2 = (n - current_point).normalized()
			var from_prev: Vector2 = (current_point - prev_point).normalized()

			var cross: float = from_prev.x * to_neighbor.y - from_prev.y * to_neighbor.x
			var dot: float = from_prev.x * to_neighbor.x + from_prev.y * to_neighbor.y
			var angle: float = atan2(cross, dot)

			if angle < min_signed_angle:
				min_signed_angle = angle
				for e_idx in range(edges.size()):
					var e: StreetNetwork.StreetEdge = edges[e_idx]
					if e_idx == current_edge_idx:
						continue
					if (e.start.distance_squared_to(current_point) < 0.1 and e.end.distance_squared_to(n) < 0.1):
						next_edge_idx = e_idx
						next_dir = 0
						break
					elif (e.end.distance_squared_to(current_point) < 0.1 and e.start.distance_squared_to(n) < 0.1):
						next_edge_idx = e_idx
						next_dir = 1
						break

		if next_edge_idx == -1:
			break

		if next_edge_idx == start_edge_idx:
			var next_edge: StreetNetwork.StreetEdge = edges[next_edge_idx]
			var next_start: Vector2 = next_edge.start if next_dir == 0 else next_edge.end
			if next_start.distance_squared_to(cycle[0]) < 1.0:
				break

		current_edge_idx = next_edge_idx
		current_dir = next_dir
		iterations += 1

	return cycle

func _clean_cycle(cycle: Array) -> Array:
	if cycle.size() < 3:
		return cycle

	var cleaned: Array = []
	var tolerance: float = 1.0

	for i in range(cycle.size()):
		var p: Vector2 = cycle[i]
		var is_duplicate: bool = false

		for cp in cleaned:
			if p.distance_squared_to(cp) < tolerance * tolerance:
				is_duplicate = true
				break

		if not is_duplicate:
			cleaned.append(p)

	if cleaned.size() > 3:
		var first: Vector2 = cleaned[0]
		var last: Vector2 = cleaned[cleaned.size() - 1]
		if first.distance_squared_to(last) < tolerance * tolerance:
			cleaned.pop_back()

	var result: Array = []
	for i in range(cleaned.size()):
		var prev: Vector2 = cleaned[(i - 1 + cleaned.size()) % cleaned.size()]
		var curr: Vector2 = cleaned[i]
		var next: Vector2 = cleaned[(i + 1) % cleaned.size()]

		var to_curr: Vector2 = curr - prev
		var to_next: Vector2 = next - curr

		if to_curr.length() > 0.1 and to_next.length() > 0.1:
			var cross: float = to_curr.normalized().cross(to_next.normalized())
			if abs(cross) > 0.01:
				result.append(curr)
		else:
			result.append(curr)

	return result

func _is_simple_polygon(polygon: PackedVector2Array) -> bool:
	var n: int = polygon.size()
	if n < 3:
		return false

	for i in range(n):
		var a1: Vector2 = polygon[i]
		var a2: Vector2 = polygon[(i + 1) % n]

		for j in range(i + 2, n):
			var b1: Vector2 = polygon[j]
			var b2: Vector2 = polygon[(j + 1) % n]

			if j == i + 1 or (j + 1) % n == i:
				continue

			if _segments_intersect_strict(a1, a2, b1, b2):
				return false

	return true

func _segments_intersect_strict(a1: Vector2, a2: Vector2, b1: Vector2, b2: Vector2) -> bool:
	var denom: float = (b2.y - b1.y) * (a2.x - a1.x) - (b2.x - b1.x) * (a2.y - a1.y)
	if abs(denom) < 0.0001:
		return false

	var ua: float = ((b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x)) / denom
	var ub: float = ((a2.x - a1.x) * (a1.y - b1.y) - (a2.y - a1.y) * (a1.x - b1.x)) / denom

	return ua > 0.001 and ua < 0.999 and ub > 0.001 and ub < 0.999

func _is_counter_clockwise(polygon: PackedVector2Array) -> bool:
	var n: int = polygon.size()
	var signed_area: float = 0.0
	for i in range(n):
		var j: int = (i + 1) % n
		signed_area += polygon[i].x * polygon[j].y
		signed_area -= polygon[j].x * polygon[i].y
	return signed_area > 0

func _is_valid_block(block: Block, area_size: Vector2) -> bool:
	var margin: float = 20.0
	for p in block.polygon:
		if p.x < margin or p.x > area_size.x - margin:
			return false
		if p.y < margin or p.y > area_size.y - margin:
			return false
	return true

func _has_good_shape(block: Block, max_aspect_ratio: float) -> bool:
	var polygon: PackedVector2Array = block.polygon
	var n: int = polygon.size()
	if n < 3:
		return false

	var min_x: float = 1e9
	var max_x: float = -1e9
	var min_y: float = 1e9
	var max_y: float = -1e9

	for p in polygon:
		min_x = min(min_x, p.x)
		max_x = max(max_x, p.x)
		min_y = min(min_y, p.y)
		max_y = max(max_y, p.y)

	var width: float = max_x - min_x
	var height: float = max_y - min_y

	if width < 0.1 or height < 0.1:
		return false

	var aspect_ratio: float = max(width, height) / min(width, height)
	if aspect_ratio > max_aspect_ratio:
		return false

	var bbox_area: float = width * height
	if bbox_area < 0.001:
		return false

	var fill_ratio: float = block.area / bbox_area
	if fill_ratio < 0.3:
		return false

	var total_edge_length: float = 0.0
	for i in range(n):
		var j: int = (i + 1) % n
		total_edge_length += polygon[i].distance_to(polygon[j])

	if total_edge_length < 0.001:
		return true

	var compactness: float = (4.0 * PI * block.area) / (total_edge_length * total_edge_length)
	if compactness < 0.2:
		return false

	return true

func offset_block_polygon(block: Block, offset_amount: float) -> PackedVector2Array:
	var original: PackedVector2Array = block.polygon
	var offset: PackedVector2Array = PackedVector2Array()
	var n: int = original.size()

	for i in range(n):
		var prev: Vector2 = original[(i - 1 + n) % n]
		var curr: Vector2 = original[i]
		var next: Vector2 = original[(i + 1) % n]

		var dir1: Vector2 = (curr - prev).normalized()
		var dir2: Vector2 = (next - curr).normalized()

		var normal1: Vector2 = Vector2(-dir1.y, dir1.x)
		var normal2: Vector2 = Vector2(-dir2.y, dir2.x)

		var mid_normal: Vector2 = (normal1 + normal2).normalized()

		var bisector_len: float = offset_amount / max(0.3, mid_normal.dot(normal1))

		offset.append(curr + mid_normal * bisector_len)

	return offset
