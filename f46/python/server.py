from flask import Flask, request, jsonify
from flask_cors import CORS
from dungeon_generator import DungeonGenerator
import json

app = Flask(__name__)
CORS(app)


@app.route('/generate', methods=['POST'])
def generate_dungeon():
    try:
        data = request.get_json()
        
        width = data.get('width', 80)
        height = data.get('height', 60)
        seed = data.get('seed')
        method = data.get('method', 'hybrid')
        ensure_connected = data.get('ensure_connected', True)
        min_region_size = data.get('min_region_size', 20)
        connect_corridor_width = data.get('connect_corridor_width', 2)
        
        params = data.get('params', {})
        
        generator = DungeonGenerator(width=width, height=height, seed=seed)
        result = generator.generate(
            method=method,
            ensure_connected=ensure_connected,
            min_region_size=min_region_size,
            connect_corridor_width=connect_corridor_width,
            **params
        )
        
        return jsonify({
            'success': True,
            'dungeon': result
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok'})


@app.route('/methods', methods=['GET'])
def get_methods():
    return jsonify({
        'methods': ['cellular', 'rooms', 'noise', 'hybrid'],
        'default_params': {
            'cellular': {
                'fill_probability': 0.45,
                'iterations': 5,
                'birth_limit': 4,
                'death_limit': 3
            },
            'rooms': {
                'room_min_size': 5,
                'room_max_size': 12,
                'num_rooms': 15,
                'corridor_width': 2
            },
            'noise': {
                'scale': 10.0,
                'octaves': 3,
                'persistence': 0.5,
                'lacunarity': 2.0,
                'threshold': 0.5
            },
            'hybrid': {
                'fill_probability': 0.45,
                'ca_iterations': 5,
                'birth_limit': 4,
                'death_limit': 3,
                'room_min_size': 5,
                'room_max_size': 12,
                'num_rooms': 15,
                'corridor_width': 2
            }
        }
    })


if __name__ == '__main__':
    print('Dungeon Generator Server starting...')
    print('Available endpoints:')
    print('  GET  /health')
    print('  GET  /methods')
    print('  POST /generate')
    print('Server running on http://localhost:5000')
    app.run(host='localhost', port=5000, debug=False)
