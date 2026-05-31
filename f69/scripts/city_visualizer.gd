extends Node2D

var city_generator: CityGenerator
var show_pois: bool = true
var show_triangulation: bool = false
var show_streets: bool = true
var show_blocks: bool = true
var show_labels: bool = false

var street_width: float = 8.0
var poi_radius: float = 5.0

var background_color: Color = Color(0.1, 0.12, 0.15)
var color_by_type: Dictionary = {
	BlockGenerator.BlockType.RESIDENTIAL: Color(0.35, 0.5, 0.75),
	BlockGenerator.BlockType.COMMERCIAL: Color(0.9, 0.6, 0.2),
	BlockGenerator.BlockType.PARK: Color(0.3, 0.7, 0.35),
	BlockGenerator.BlockType.INDUSTRIAL: Color(0.6, 0.4, 0.5)
}
var color_variation: float = 0.15
var street_color: Color = Color(0.4, 0.4, 0.45)
var street_centerline_color: Color = Color(0.6, 0.6, 0.65)
var poi_color: Color = Color(0.95, 0.3, 0.3)
var triangulation_color: Color = Color(0.3, 0.8, 0.5, 0.3)
var show_block_types: bool = true

func _init() -> void:
	city_generator = CityGenerator.new()

func generate_city(seed: int = 0) -> void:
	city_generator.seed = seed
	city_generator.generate()
	queue_redraw()

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, city_generator.area_size), background_color)

	if show_blocks and city_generator.blocks.size() > 0:
		_draw_blocks()

	if show_streets and city_generator.street_network.edges.size() > 0:
		_draw_streets()

	if show_triangulation and city_generator.triangles.size() > 0:
		_draw_triangulation()

	if show_pois and city_generator.pois.size() > 0:
		_draw_pois()

func _draw_blocks() -> void:
	var rng: RandomNumberGenerator = RandomNumberGenerator.new()
	rng.seed = city_generator.seed

	for block in city_generator.blocks:
		var base_color: Color
		if show_block_types:
			base_color = color_by_type[block.block_type]
			var variation: Vector3 = Vector3(
				rng.randf_range(-color_variation, color_variation),
				rng.randf_range(-color_variation, color_variation),
				rng.randf_range(-color_variation, color_variation)
			)
			base_color.r = clamp(base_color.r + variation.x, 0.0, 1.0)
			base_color.g = clamp(base_color.g + variation.y, 0.0, 1.0)
			base_color.b = clamp(base_color.b + variation.z, 0.0, 1.0)
		else:
			var gray: float = rng.randf_range(0.2, 0.35)
			base_color = Color(gray, gray * 1.1, gray * 1.2)

		var colors: Array = []
		for i in range(block.polygon.size()):
			colors.append(base_color)
		draw_polygon(block.polygon, colors, PackedVector2Array())

		if show_labels:
			var label_text: String = ""
			if show_block_types:
				match block.block_type:
					BlockGenerator.BlockType.RESIDENTIAL:
						label_text = "住宅"
					BlockGenerator.BlockType.COMMERCIAL:
						label_text = "商业"
					BlockGenerator.BlockType.PARK:
						label_text = "公园"
					BlockGenerator.BlockType.INDUSTRIAL:
						label_text = "工业"
				label_text += " " + str(round(block.area))
			else:
				label_text = str(round(block.area))

			draw_string(
				get_theme_default_font(),
				block.centroid - Vector2(20, 0),
				label_text,
				HorizontalAlignment.CENTER,
				40,
				11,
				Color(0.95, 0.95, 0.95)
			)

func _draw_streets() -> void:
	for edge in city_generator.street_network.edges:
		draw_line(edge.start, edge.end, street_color, street_width, true)
		draw_line(edge.start, edge.end, street_centerline_color, 1.5, true)

func _draw_triangulation() -> void:
	for tri in city_generator.triangles:
		var points: PackedVector2Array = PackedVector2Array()
		points.append(tri.a)
		points.append(tri.b)
		points.append(tri.c)
		var colors: Array = [triangulation_color, triangulation_color, triangulation_color]
		draw_polygon(points, colors, PackedVector2Array())
		draw_line(tri.a, tri.b, triangulation_color, 1.0, true)
		draw_line(tri.b, tri.c, triangulation_color, 1.0, true)
		draw_line(tri.c, tri.a, triangulation_color, 1.0, true)

func _draw_pois() -> void:
	for poi in city_generator.pois:
		draw_circle(poi, poi_radius, poi_color)
		draw_arc(poi, poi_radius + 3, 0.0, TAU, 16, Color(1, 1, 1, 0.5), 1.0, true)
