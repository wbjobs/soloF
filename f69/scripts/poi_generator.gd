class_name POIGenerator
extends RefCounted

enum DistributionType {
	UNIFORM,
	CENTER_CLUSTERED,
	MULTI_CLUSTERED
}

var seed: int = 0
var random_number_generator: RandomNumberGenerator

func _init(p_seed: int = 0):
	seed = p_seed
	random_number_generator = RandomNumberGenerator.new()
	if seed == 0:
		random_number_generator.randomize()
	else:
		random_number_generator.seed = seed

func generate_pois(area_size: Vector2, count: int, distribution: DistributionType = DistributionType.UNIFORM, cluster_count: int = 3) -> Array:
	var pois: Array = []

	match distribution:
		DistributionType.UNIFORM:
			pois = _generate_uniform(area_size, count)
		DistributionType.CENTER_CLUSTERED:
			pois = _generate_center_clustered(area_size, count)
		DistributionType.MULTI_CLUSTERED:
			pois = _generate_multi_clustered(area_size, count, cluster_count)

	return pois

func _generate_uniform(area_size: Vector2, count: int) -> Array:
	var pois: Array = []
	var margin: float = 50.0
	for i in range(count):
		var x: float = random_number_generator.randf_range(margin, area_size.x - margin)
		var y: float = random_number_generator.randf_range(margin, area_size.y - margin)
		pois.append(Vector2(x, y))
	return pois

func _generate_center_clustered(area_size: Vector2, count: int) -> Array:
	var pois: Array = []
	var center: Vector2 = area_size / 2.0
	var max_radius: float = min(area_size.x, area_size.y) * 0.45

	for i in range(count):
		var angle: float = random_number_generator.randf_range(0.0, TAU)
		var radius_factor: float = sqrt(random_number_generator.randf())
		var radius: float = radius_factor * max_radius
		var pos: Vector2 = center + Vector2(cos(angle), sin(angle)) * radius
		pois.append(pos)
	return pois

func _generate_multi_clustered(area_size: Vector2, count: int, cluster_count: int) -> Array:
	var pois: Array = []
	var margin: float = 80.0
	var cluster_centers: Array = []

	for i in range(cluster_count):
		var cx: float = random_number_generator.randf_range(margin, area_size.x - margin)
		var cy: float = random_number_generator.randf_range(margin, area_size.y - margin)
		cluster_centers.append(Vector2(cx, cy))

	var points_per_cluster: int = count / cluster_count
	var remaining_points: int = count % cluster_count

	for cluster_idx in range(cluster_count):
		var cluster_center: Vector2 = cluster_centers[cluster_idx]
		var num_points: int = points_per_cluster
		if cluster_idx < remaining_points:
			num_points += 1

		var cluster_radius: float = random_number_generator.randf_range(60.0, 150.0)

		for i in range(num_points):
			var angle: float = random_number_generator.randf_range(0.0, TAU)
			var radius_factor: float = sqrt(random_number_generator.randf())
			var radius: float = radius_factor * cluster_radius
			var pos: Vector2 = cluster_center + Vector2(cos(angle), sin(angle)) * radius
			pos.x = clamp(pos.x, 20.0, area_size.x - 20.0)
			pos.y = clamp(pos.y, 20.0, area_size.y - 20.0)
			pois.append(pos)

	return pois

func ensure_min_distance(pois: Array, min_dist: float) -> Array:
	var filtered: Array = []
	for p in pois:
		var too_close: bool = false
		for fp in filtered:
			if p.distance_to(fp) < min_dist:
				too_close = true
				break
		if not too_close:
			filtered.append(p)
	return filtered
