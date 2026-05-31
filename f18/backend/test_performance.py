import requests
import time
import json

API_URL = "http://localhost:8000/api/generate"

test_input = {
    "style": "electronic",
    "emotion": "happy",
    "temperature": 1.0,
    "input_notes": [
        {"pitch": 60, "start_time": 0, "duration": 0.5, "velocity": 80},
        {"pitch": 62, "start_time": 0.5, "duration": 0.5, "velocity": 80},
        {"pitch": 64, "start_time": 1, "duration": 0.5, "velocity": 80},
        {"pitch": 65, "start_time": 1.5, "duration": 0.5, "velocity": 80},
    ]
}

def test_performance():
    print("=" * 60)
    print("AI Music Generator - Performance Test")
    print("=" * 60)
    
    print("\n1. Testing first request (cold)...")
    start_time = time.time()
    response = requests.post(API_URL, json=test_input)
    elapsed_first = time.time() - start_time
    
    if response.status_code == 200:
        data = response.json()
        print(f"   Status: Success ✓")
        print(f"   Time: {elapsed_first * 1000:.2f}ms")
        print(f"   Generated notes: {len(data['notes'])}")
        print(f"   From cache: {data.get('from_cache', False)}")
        if 'generation_time_ms' in data:
            print(f"   Generation time: {data['generation_time_ms']}ms")
    else:
        print(f"   Status: Failed (code {response.status_code})")
        return
    
    print("\n2. Testing second request (cached)...")
    start_time = time.time()
    response = requests.post(API_URL, json=test_input)
    elapsed_second = time.time() - start_time
    
    if response.status_code == 200:
        data = response.json()
        print(f"   Status: Success ✓")
        print(f"   Time: {elapsed_second * 1000:.2f}ms")
        print(f"   From cache: {data.get('from_cache', False)}")
    else:
        print(f"   Status: Failed (code {response.status_code})")
    
    print("\n3. Testing multiple concurrent requests...")
    num_requests = 10
    times = []
    
    for i in range(num_requests):
        start = time.time()
        response = requests.post(API_URL, json=test_input)
        elapsed = time.time() - start
        times.append(elapsed)
        print(f"   Request {i+1}: {elapsed * 1000:.2f}ms")
    
    avg_time = sum(times) / len(times)
    min_time = min(times)
    max_time = max(times)
    
    print(f"\n   Average: {avg_time * 1000:.2f}ms")
    print(f"   Min: {min_time * 1000:.2f}ms")
    print(f"   Max: {max_time * 1000:.2f}ms")
    
    speedup = elapsed_first / avg_time if avg_time > 0 else 0
    print(f"\n4. Performance Summary:")
    print(f"   First request (cold): {elapsed_first * 1000:.2f}ms")
    print(f"   Cached request: {elapsed_second * 1000:.2f}ms")
    print(f"   Speedup: {speedup:.1f}x")
    
    if elapsed_second < 0.1:
        print("   ✓ Optimization successful! Response under 100ms")
    else:
        print("   ⚠ Consider further optimizations")
    
    print("\n" + "=" * 60)

def test_cache_stats():
    print("\nCache Statistics:")
    response = requests.get("http://localhost:8000/api/cache/stats")
    if response.status_code == 200:
        stats = response.json()
        print(json.dumps(stats, indent=2))

if __name__ == "__main__":
    test_performance()
    test_cache_stats()
