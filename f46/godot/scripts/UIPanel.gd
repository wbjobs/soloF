extends Control

@onready var dungeon_manager: DungeonManager = get_node("/root/Main/DungeonManager")

@onready var method_option: OptionButton = $VBoxContainer/MethodContainer/MethodOption
@onready var width_spin: SpinBox = $VBoxContainer/SizeContainer/WidthSpin
@onready var height_spin: SpinBox = $VBoxContainer/SizeContainer/HeightSpin
@onready var seed_spin: SpinBox = $VBoxContainer/SeedContainer/SeedSpin
@onready var use_seed_check: CheckBox = $VBoxContainer/SeedContainer/UseSeedCheck

@onready var ensure_connected_check: CheckBox = $VBoxContainer/ConnectivityContainer/EnsureConnectedCheck
@onready var min_region_size_spin: SpinBox = $VBoxContainer/ConnectivityContainer/MinRegionSizeContainer/MinRegionSizeSpin
@onready var connect_corridor_width_spin: SpinBox = $VBoxContainer/ConnectivityContainer/ConnectCorridorWidthContainer/ConnectCorridorWidthSpin

@onready var cellular_params: VBoxContainer = $VBoxContainer/ParamsContainer/CellularParams
@onready var rooms_params: VBoxContainer = $VBoxContainer/ParamsContainer/RoomsParams
@onready var noise_params: VBoxContainer = $VBoxContainer/ParamsContainer/NoiseParams
@onready var hybrid_params: VBoxContainer = $VBoxContainer/ParamsContainer/HybridParams

@onready var generate_button: Button = $VBoxContainer/GenerateButton
@onready var clear_button: Button = $VBoxContainer/ClearButton
@onready var status_label: Label = $VBoxContainer/StatusLabel

func _ready() -> void:
    setup_method_options()
    connect_signals()
    show_params_for_method("hybrid")

func setup_method_options() -> void:
    method_option.clear()
    method_option.add_item("混合 (Hybrid)", 0)
    method_option.add_item("元胞自动机 (Cellular)", 1)
    method_option.add_item("房间走廊 (Rooms)", 2)
    method_option.add_item("噪声 (Noise)", 3)
    method_option.selected = 0

func connect_signals() -> void:
    method_option.item_selected.connect(_on_method_changed)
    generate_button.pressed.connect(_on_generate_pressed)
    clear_button.pressed.connect(_on_clear_pressed)
    dungeon_manager.dungeon_generated.connect(_on_dungeon_generated)
    dungeon_manager.generation_failed.connect(_on_generation_failed)

func show_params_for_method(method: String) -> void:
    cellular_params.visible = false
    rooms_params.visible = false
    noise_params.visible = false
    hybrid_params.visible = false
    
    match method:
        "cellular":
            cellular_params.visible = true
        "rooms":
            rooms_params.visible = true
        "noise":
            noise_params.visible = true
        "hybrid":
            hybrid_params.visible = true

func _on_method_changed(index: int) -> void:
    var methods = ["hybrid", "cellular", "rooms", "noise"]
    show_params_for_method(methods[index])

func _on_generate_pressed() -> void:
    status_label.text = "Generating..."
    generate_button.disabled = true
    
    var methods = ["hybrid", "cellular", "rooms", "noise"]
    var method = methods[method_option.selected]
    var width = int(width_spin.value)
    var height = int(height_spin.value)
    var seed = int(seed_spin.value) if use_seed_check.button_pressed else -1
    
    var params = get_params_for_method(method)
    
    var ensure_connected = ensure_connected_check.button_pressed
    var min_region_size = int(min_region_size_spin.value)
    var connect_corridor_width = int(connect_corridor_width_spin.value)
    
    dungeon_manager.generate_dungeon(width, height, seed, method, params, ensure_connected, min_region_size, connect_corridor_width)

func get_params_for_method(method: String) -> Dictionary:
    var params: Dictionary = {}
    
    match method:
        "cellular":
            params.fill_probability = $VBoxContainer/ParamsContainer/CellularParams/FillProbabilitySlider.value
            params.iterations = int($VBoxContainer/ParamsContainer/CellularParams/IterationsSpin.value)
            params.birth_limit = int($VBoxContainer/ParamsContainer/CellularParams/BirthLimitSpin.value)
            params.death_limit = int($VBoxContainer/ParamsContainer/CellularParams/DeathLimitSpin.value)
        
        "rooms":
            params.room_min_size = int($VBoxContainer/ParamsContainer/RoomsParams/RoomMinSpin.value)
            params.room_max_size = int($VBoxContainer/ParamsContainer/RoomsParams/RoomMaxSpin.value)
            params.num_rooms = int($VBoxContainer/ParamsContainer/RoomsParams/NumRoomsSpin.value)
            params.corridor_width = int($VBoxContainer/ParamsContainer/RoomsParams/CorridorWidthSpin.value)
        
        "noise":
            params.scale = $VBoxContainer/ParamsContainer/NoiseParams/ScaleSlider.value
            params.octaves = int($VBoxContainer/ParamsContainer/NoiseParams/OctavesSpin.value)
            params.persistence = $VBoxContainer/ParamsContainer/NoiseParams/PersistenceSlider.value
            params.lacunarity = $VBoxContainer/ParamsContainer/NoiseParams/LacunaritySlider.value
            params.threshold = $VBoxContainer/ParamsContainer/NoiseParams/ThresholdSlider.value
        
        "hybrid":
            params.fill_probability = $VBoxContainer/ParamsContainer/HybridParams/FillProbabilitySlider.value
            params.ca_iterations = int($VBoxContainer/ParamsContainer/HybridParams/CaIterationsSpin.value)
            params.birth_limit = int($VBoxContainer/ParamsContainer/HybridParams/BirthLimitSpin.value)
            params.death_limit = int($VBoxContainer/ParamsContainer/HybridParams/DeathLimitSpin.value)
            params.room_min_size = int($VBoxContainer/ParamsContainer/HybridParams/RoomMinSpin.value)
            params.room_max_size = int($VBoxContainer/ParamsContainer/HybridParams/RoomMaxSpin.value)
            params.num_rooms = int($VBoxContainer/ParamsContainer/HybridParams/NumRoomsSpin.value)
            params.corridor_width = int($VBoxContainer/ParamsContainer/HybridParams/CorridorWidthSpin.value)
    
    return params

func _on_clear_pressed() -> void:
    dungeon_manager.clear_dungeon()
    status_label.text = "Cleared"

func _on_dungeon_generated(dungeon_data: Dictionary) -> void:
    status_label.text = "Generated! Seed: %d" % dungeon_data.seed
    generate_button.disabled = false

func _on_generation_failed(error_message: String) -> void:
    status_label.text = "Error: %s" % error_message
    generate_button.disabled = false
