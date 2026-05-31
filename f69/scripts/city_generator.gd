class_name CityGenerator
extends RefCounted

var seed: int = 0
var area_size: Vector2 = Vector2(1000, 800)
var poi_count: int = 50
var distribution: POIGenerator.DistributionType = POIGenerator.DistributionType.MULTI_CLUSTERED
var cluster_count: int = 4
var min_poi_distance: float = 50.0
var max_street_length: float = 300.0
var min_block_area: float = 800.0
var max_block_aspect_ratio: float = 4.0
var relaxation_iterations: int = 3
var relaxation_strength: float = 0.2

var pois: Array = []
var triangles: Array = []
var street_network: StreetNetwork
var blocks: Array = []

func _init(p_seed: int = 0) -> void:
	seed = p_seed
	street_network = StreetNetwork.new()

func generate() -> void:
	pois.clear()
	triangles.clear()
	blocks.clear()

	var poi_gen: POIGenerator = POIGenerator.new(seed)
	pois = poi_gen.generate_pois(area_size, poi_count, distribution, cluster_count)
	pois = poi_gen.ensure_min_distance(pois, min_poi_distance)

	if pois.size() < 3:
		return

	var delaunay: Delaunay = Delaunay.new()
	triangles = delaunay.triangulate(pois)

	var edges: Array = delaunay.get_edges(triangles)

	street_network.build_from_delaunay_edges(edges, max_street_length)

	street_network.remove_intersecting_edges()

	if relaxation_iterations > 0:
		street_network.relax_points(relaxation_iterations, relaxation_strength)
		street_network.remove_intersecting_edges()

	var block_gen: BlockGenerator = BlockGenerator.new()
	blocks = block_gen.generate_blocks(street_network, area_size, min_block_area, max_block_aspect_ratio, seed)

func get_city_data() -> Dictionary:
	return {
		"seed": seed,
		"area_size": area_size,
		"pois": pois,
		"triangles": triangles,
		"street_network": street_network,
		"blocks": blocks
	}
