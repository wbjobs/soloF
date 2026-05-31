extends Node2D

signal dungeon_generated(dungeon_data)
signal generation_failed(error_message)

@onready var tile_map: TileMap = $TileMap
@onready var http_request: HttpRequest = $HttpRequest

var server_url: String = "http://localhost:5000"
var is_connected: bool = false

var current_dungeon: Dictionary = {}
var tile_size: Vector2i = Vector2i(16, 16)

func _ready() -> void:
    check_server_connection()

func check_server_connection() -> void:
    http_request.request("%s/health" % server_url)

func get_available_methods() -> void:
    http_request.request("%s/methods" % server_url)

func generate_dungeon(width: int = 80, height: int = 60, seed: int = -1, method: String = "hybrid", params: Dictionary = {}, ensure_connected: bool = true, min_region_size: int = 20, connect_corridor_width: int = 2) -> void:
    var request_data: Dictionary = {
        "width": width,
        "height": height,
        "method": method,
        "params": params,
        "ensure_connected": ensure_connected,
        "min_region_size": min_region_size,
        "connect_corridor_width": connect_corridor_width
    }
    
    if seed >= 0:
        request_data["seed"] = seed
    
    var json_string: String = JSON.stringify(request_data)
    var headers: PackedStringArray = ["Content-Type: application/json"]
    
    http_request.request(
        "%s/generate" % server_url,
        headers,
        HTTPClient.METHOD_POST,
        json_string
    )

func _on_http_request_request_completed(result: int, response_code: int, headers: PackedStringArray, body: PackedByteArray) -> void:
    if response_code != 200:
        generation_failed.emit("HTTP Error: %d" % response_code)
        return
    
    var json_string: String = body.get_string_from_utf8()
    var json: JSON = JSON.new()
    var parse_result: JSONParseResult = json.parse(json_string)
    
    if parse_result.error != OK:
        generation_failed.emit("JSON Parse Error: %s" % parse_result.error_string)
        return
    
    var response: Dictionary = parse_result.data
    
    if not response.get("success", false):
        generation_failed.emit(response.get("error", "Unknown error"))
        return
    
    if "dungeon" in response:
        current_dungeon = response.dungeon
        render_dungeon(current_dungeon)
        dungeon_generated.emit(current_dungeon)
    
    if "methods" in response:
        print("Available methods: ", response.methods)
        print("Default params: ", response.default_params)
    
    if "status" in response and response.status == "ok":
        is_connected = true
        print("Server connection successful!")

func render_dungeon(dungeon_data: Dictionary) -> void:
    tile_map.clear()
    
    var width: int = dungeon_data.width
    var height: int = dungeon_data.height
    var data: Array = dungeon_data.data
    
    var layer: int = 0
    
    for y in range(height):
        for x in range(width):
            var cell_value: int = data[y][x]
            var tile_coords: Vector2i = Vector2i(x, y)
            
            if cell_value == 1:
                tile_map.set_cell(layer, tile_coords, 1, Vector2i(0, 0))
            else:
                tile_map.set_cell(layer, tile_coords, 0, Vector2i(0, 0))
    
    center_map(width, height)

func center_map(width: int, height: int) -> void:
    var map_width_pixels: float = width * tile_size.x
    var map_height_pixels: float = height * tile_size.y
    
    var viewport_size: Vector2 = get_viewport_rect().size
    var offset: Vector2 = (viewport_size - Vector2(map_width_pixels, map_height_pixels)) / 2
    
    tile_map.position = offset

func clear_dungeon() -> void:
    tile_map.clear()
    current_dungeon = {}
