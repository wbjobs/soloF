from flask import Flask, jsonify
from flask_cors import CORS
from .graph_algorithms import GraphAnalyzer
from .data_import import generate_and_import_data
from config import NEO4J_CONFIG, FLASK_CONFIG

app = Flask(__name__)
CORS(app)


def get_analyzer():
    return GraphAnalyzer(
        uri=NEO4J_CONFIG["uri"],
        user=NEO4J_CONFIG["user"],
        password=NEO4J_CONFIG["password"],
        database=NEO4J_CONFIG["database"]
    )


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "message": "Network Traffic Analysis API is running"})


@app.route('/api/graph', methods=['GET'])
def get_full_graph():
    analyzer = get_analyzer()
    try:
        result = analyzer.analyze_full_graph()
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        analyzer.close()


@app.route('/api/nodes', methods=['GET'])
def get_nodes():
    analyzer = get_analyzer()
    try:
        result = analyzer.analyze_full_graph()
        return jsonify({"nodes": result["nodes"], "statistics": result["statistics"]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        analyzer.close()


@app.route('/api/edges', methods=['GET'])
def get_edges():
    analyzer = get_analyzer()
    try:
        result = analyzer.analyze_full_graph()
        return jsonify({"edges": result["edges"]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        analyzer.close()


@app.route('/api/pagerank/top/<int:n>', methods=['GET'])
def get_top_pagerank(n):
    analyzer = get_analyzer()
    try:
        top_nodes = analyzer.get_top_pagerank_nodes(n)
        return jsonify({"top_pagerank_nodes": top_nodes})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        analyzer.close()


@app.route('/api/communities', methods=['GET'])
def get_communities():
    analyzer = get_analyzer()
    try:
        communities = analyzer.get_community_summary()
        return jsonify({"communities": communities})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        analyzer.close()


@app.route('/api/statistics', methods=['GET'])
def get_statistics():
    analyzer = get_analyzer()
    try:
        result = analyzer.analyze_full_graph()
        return jsonify({"statistics": result["statistics"]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        analyzer.close()


@app.route('/api/generate-data', methods=['POST'])
def generate_data():
    try:
        df = generate_and_import_data()
        return jsonify({
            "status": "success",
            "message": "Data generated and imported successfully",
            "records_count": len(df),
            "anomaly_count": int(df["is_anomaly"].sum())
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/node/<ip_address>', methods=['GET'])
def get_node_details(ip_address):
    analyzer = get_analyzer()
    try:
        result = analyzer.analyze_full_graph()

        node_data = None
        for node in result["nodes"]:
            if node["id"] == ip_address:
                node_data = node
                break

        if not node_data:
            return jsonify({"error": "Node not found"}), 404

        related_edges = []
        for edge in result["edges"]:
            if edge["source"] == ip_address or edge["target"] == ip_address:
                related_edges.append(edge)

        return jsonify({
            "node": node_data,
            "related_edges": related_edges
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        analyzer.close()


@app.route('/api/time/range', methods=['GET'])
def get_time_range():
    analyzer = get_analyzer()
    try:
        time_range = analyzer.get_time_range()
        return jsonify(time_range)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        analyzer.close()


@app.route('/api/time/slices', methods=['GET'])
def get_time_slices():
    from flask import request
    num_slices = int(request.args.get('count', 10))
    analyzer = get_analyzer()
    try:
        slices = analyzer.get_time_slices(num_slices=num_slices)
        return jsonify({"slices": slices})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        analyzer.close()


@app.route('/api/graph/snapshot', methods=['GET'])
def get_graph_snapshot():
    from flask import request
    start_time = request.args.get('start')
    end_time = request.args.get('end')

    if not start_time or not end_time:
        return jsonify({"error": "start and end time parameters are required"}), 400

    analyzer = get_analyzer()
    try:
        result = analyzer.analyze_full_graph(start_time=start_time, end_time=end_time)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        analyzer.close()


def run_server():
    app.run(
        host=FLASK_CONFIG["host"],
        port=FLASK_CONFIG["port"],
        debug=FLASK_CONFIG["debug"]
    )


if __name__ == "__main__":
    run_server()
