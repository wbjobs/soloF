import json
import hashlib
import os
import time
from typing import Optional, Dict, Any
from dotenv import load_dotenv

load_dotenv()

class CacheManager:
    def __init__(self):
        self.enabled = os.getenv('ENABLE_CACHE', 'true').lower() == 'true'
        self.redis_available = False
        self.cache_ttl = int(os.getenv('CACHE_TTL', 3600))
        self.disable_redis = os.getenv('DISABLE_REDIS', 'false').lower() == 'true'
        
        self.memory_cache: Dict[str, tuple[float, Any]] = {}
        self.max_memory_cache = 1000
        
        if self.enabled and not self.disable_redis:
            try:
                import redis
                self.redis_client = redis.Redis(
                    host=os.getenv('REDIS_HOST', 'localhost'),
                    port=int(os.getenv('REDIS_PORT', 6379)),
                    db=int(os.getenv('REDIS_DB', 0)),
                    password=os.getenv('REDIS_PASSWORD') if os.getenv('REDIS_PASSWORD') else None,
                    decode_responses=False,
                    socket_timeout=0.5,
                    socket_connect_timeout=0.5
                )
                self.redis_client.ping()
                self.redis_available = True
                print("Redis cache connected successfully")
            except Exception as e:
                print(f"Redis connection failed, using memory cache only: {e}")
        else:
            print("Memory cache only mode (Redis disabled)")
    
    def _generate_cache_key(self, data: Dict) -> str:
        sorted_data = self._sort_dict(data)
        json_str = json.dumps(sorted_data, sort_keys=True)
        hash_obj = hashlib.md5(json_str.encode())
        return f"music_gen:{hash_obj.hexdigest()}"
    
    def _sort_dict(self, d: Dict) -> Dict:
        sorted_dict = {}
        for key in sorted(d.keys()):
            value = d[key]
            if isinstance(value, dict):
                sorted_dict[key] = self._sort_dict(value)
            elif isinstance(value, list):
                sorted_dict[key] = [self._sort_dict(item) if isinstance(item, dict) else item for item in value]
            else:
                sorted_dict[key] = value
        return sorted_dict
    
    def get(self, request_data: Dict) -> Optional[Dict]:
        if not self.enabled:
            return None
        
        cache_key = self._generate_cache_key(request_data)
        
        if cache_key in self.memory_cache:
            expiry, data = self.memory_cache[cache_key]
            if time.time() < expiry:
                print(f"Memory cache hit: {cache_key}")
                return data
            else:
                del self.memory_cache[cache_key]
        
        if self.redis_available:
            try:
                cached_data = self.redis_client.get(cache_key)
                if cached_data:
                    print(f"Redis cache hit: {cache_key}")
                    data = json.loads(cached_data)
                    self.memory_cache[cache_key] = (time.time() + self.cache_ttl, data)
                    return data
            except Exception as e:
                print(f"Redis get error: {e}")
        
        return None
    
    def set(self, request_data: Dict, result: Dict) -> None:
        if not self.enabled:
            return
        
        cache_key = self._generate_cache_key(request_data)
        
        self.memory_cache[cache_key] = (time.time() + self.cache_ttl, result)
        
        if len(self.memory_cache) > self.max_memory_cache:
            oldest_key = min(self.memory_cache.keys(), key=lambda k: self.memory_cache[k][0])
            del self.memory_cache[oldest_key]
        
        if self.redis_available:
            try:
                self.redis_client.setex(cache_key, self.cache_ttl, json.dumps(result))
                print(f"Cached (redis+memory): {cache_key}")
            except Exception as e:
                print(f"Redis set error (memory only): {e}")
        else:
            print(f"Cached (memory only): {cache_key}")
    
    def clear(self) -> None:
        self.memory_cache.clear()
        print("Memory cache cleared")
        
        if self.redis_available:
            try:
                self.redis_client.flushdb()
                print("Redis cache cleared")
            except Exception as e:
                print(f"Redis clear error: {e}")
    
    def stats(self) -> Dict:
        stats = {
            "memory_cache": {
                "status": "active",
                "total_keys": len(self.memory_cache)
            }
        }
        
        if self.redis_available:
            try:
                info = self.redis_client.info()
                stats["redis_cache"] = {
                    "status": "connected",
                    "total_keys": info.get('db0', {}).get('keys', 0),
                    "used_memory_human": info.get('used_memory_human', 'N/A')
                }
            except Exception as e:
                stats["redis_cache"] = {"status": "error", "error": str(e)}
        else:
            stats["redis_cache"] = {"status": "disabled"}
        
        return stats

cache_manager = CacheManager()
