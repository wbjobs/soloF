import requests
import time

print("Testing /health endpoint...")
start = time.time()
r = requests.get("http://localhost:8000/health")
print(f"Status: {r.status_code}, Time: {(time.time()-start)*1000:.2f}ms")

print("\nTesting root endpoint...")
start = time.time()
r = requests.get("http://localhost:8000/")
print(f"Status: {r.status_code}, Time: {(time.time()-start)*1000:.2f}ms")

print("\nTesting /api/cache/stats...")
start = time.time()
r = requests.get("http://localhost:8000/api/cache/stats")
print(f"Status: {r.status_code}, Time: {(time.time()-start)*1000:.2f}ms")

print("\nTesting /api/generate first time...")
test_input = {
    "style": "electronic",
    "emotion": "happy",
    "temperature": 1.0,
    "input_notes": [{"pitch": 60, "start_time": 0, "duration": 0.5, "velocity": 80}]
}
start = time.time()
r = requests.post("http://localhost:8000/api/generate", json=test_input)
print(f"Status: {r.status_code}, Time: {(time.time()-start)*1000:.2f}ms")
data = r.json()
print(f"  Generation time: {data.get('generation_time_ms')}ms")
print(f"  MIDI time: {data.get('midi_time_ms')}ms")
print(f"  Processing time: {data.get('processing_time_ms')}ms")

print("\nTesting /api/generate second time (cached)...")
start = time.time()
r = requests.post("http://localhost:8000/api/generate", json=test_input)
print(f"Status: {r.status_code}, Time: {(time.time()-start)*1000:.2f}ms")
data = r.json()
print(f"  From cache: {data.get('from_cache')}")
