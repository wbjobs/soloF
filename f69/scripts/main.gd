extends Node2D

@onready var city_visualizer: Node2D = $CityVisualizer
@onready var seed_input: LineEdit = $UI/ControlPanel/SeedInput
@onready var poi_count_slider: HSlider = $UI/ControlPanel/POICountSlider
@onready var poi_count_label: Label = $UI/ControlPanel/POICountLabel
@onready var distribution_option: OptionButton = $UI/ControlPanel/DistributionOption
@onready var generate_button: Button = $UI/ControlPanel/GenerateButton
@onready var random_seed_button: Button = $UI/ControlPanel/RandomSeedButton
@onready var show_pois_check: CheckBox = $UI/ControlPanel/ShowPOIsCheck
@onready var show_streets_check: CheckBox = $UI/ControlPanel/ShowStreetsCheck
@onready var show_blocks_check: CheckBox = $UI/ControlPanel/ShowBlocksCheck
@onready var show_triangulation_check: CheckBox = $UI/ControlPanel/ShowTriangulationCheck
@onready var info_label: Label = $UI/InfoPanel/InfoLabel
@onready var cluster_count_slider: HSlider = $UI/ControlPanel/ClusterCountSlider
@onready var cluster_count_label: Label = $UI/ControlPanel/ClusterCountLabel
@onready var aspect_ratio_slider: HSlider = $UI/ControlPanel/AspectRatioSlider
@onready var aspect_ratio_label: Label = $UI/ControlPanel/AspectRatioLabel
@onready var min_area_slider: HSlider = $UI/ControlPanel/MinAreaSlider
@onready var min_area_label: Label = $UI/ControlPanel/MinAreaLabel
@onready var show_block_types_check: CheckBox = $UI/ControlPanel/ShowBlockTypesCheck
@onready var show_labels_check: CheckBox = $UI/ControlPanel/ShowLabelsCheck

var current_seed: int = 0

func _ready() -> void:
	randomize()
	distribution_option.clear()
	distribution_option.add_item("均匀分布", POIGenerator.DistributionType.UNIFORM)
	distribution_option.add_item("中心聚集", POIGenerator.DistributionType.CENTER_CLUSTERED)
	distribution_option.add_item("多簇分布", POIGenerator.DistributionType.MULTI_CLUSTERED)
	distribution_option.selected = 2

	generate_city()

func _on_generate_button_pressed() -> void:
	generate_city()

func _on_random_seed_button_pressed() -> void:
	current_seed = randi()
	seed_input.text = str(current_seed)
	generate_city()

func _on_poi_count_slider_value_changed(value: float) -> void:
	poi_count_label.text = "POI数量: " + str(int(value))
	city_visualizer.city_generator.poi_count = int(value)

func _on_cluster_count_slider_value_changed(value: float) -> void:
	cluster_count_label.text = "簇数量: " + str(int(value))
	city_visualizer.city_generator.cluster_count = int(value)

func _on_aspect_ratio_slider_value_changed(value: float) -> void:
	aspect_ratio_label.text = "街区最大宽高比: " + str(value)
	city_visualizer.city_generator.max_block_aspect_ratio = value

func _on_min_area_slider_value_changed(value: float) -> void:
	min_area_label.text = "街区最小面积: " + str(int(value))
	city_visualizer.city_generator.min_block_area = int(value)

func _on_distribution_option_item_selected(index: int) -> void:
	var dist_type: int = distribution_option.get_item_id(index)
	city_visualizer.city_generator.distribution = dist_type

func _on_show_pois_toggled(button_pressed: bool) -> void:
	city_visualizer.show_pois = button_pressed
	city_visualizer.queue_redraw()

func _on_show_streets_toggled(button_pressed: bool) -> void:
	city_visualizer.show_streets = button_pressed
	city_visualizer.queue_redraw()

func _on_show_blocks_toggled(button_pressed: bool) -> void:
	city_visualizer.show_blocks = button_pressed
	city_visualizer.queue_redraw()

func _on_show_triangulation_toggled(button_pressed: bool) -> void:
	city_visualizer.show_triangulation = button_pressed
	city_visualizer.queue_redraw()

func _on_show_block_types_toggled(button_pressed: bool) -> void:
	city_visualizer.show_block_types = button_pressed
	city_visualizer.queue_redraw()

func _on_show_labels_toggled(button_pressed: bool) -> void:
	city_visualizer.show_labels = button_pressed
	city_visualizer.queue_redraw()

func generate_city() -> void:
	var seed_text: String = seed_input.text.strip_edges()
	if seed_text.is_valid_int():
		current_seed = int(seed_text)
	else:
		current_seed = randi()
		seed_input.text = str(current_seed)

	city_visualizer.generate_city(current_seed)
	update_info()

func update_info() -> void:
	var gen: CityGenerator = city_visualizer.city_generator
	var residential_count: int = 0
	var commercial_count: int = 0
	var park_count: int = 0
	var industrial_count: int = 0

	for block in gen.blocks:
		match block.block_type:
			BlockGenerator.BlockType.RESIDENTIAL:
				residential_count += 1
			BlockGenerator.BlockType.COMMERCIAL:
				commercial_count += 1
			BlockGenerator.BlockType.PARK:
				park_count += 1
			BlockGenerator.BlockType.INDUSTRIAL:
				industrial_count += 1

	var info: String = ""
	info += "种子: " + str(current_seed) + "\n"
	info += "POI数量: " + str(gen.pois.size()) + "\n"
	info += "三角形数量: " + str(gen.triangles.size()) + "\n"
	info += "街道数量: " + str(gen.street_network.edges.size()) + "\n"
	info += "街区总数: " + str(gen.blocks.size()) + "\n"
	info += "  住宅: " + str(residential_count) + "\n"
	info += "  商业: " + str(commercial_count) + "\n"
	info += "  公园: " + str(park_count) + "\n"
	info += "  工业: " + str(industrial_count)
	info_label.text = info
