import requests
import json
import time
import random
from datetime import datetime, timezone

BASE_URL = "http://localhost:8000"

sensors = [
    {
        "device_id": "sensor_001",
        "latitude": 39.9042,
        "longitude": 116.4074,
        "base_moisture": 45.0,
        "base_temp": 22.0
    },
    {
        "device_id": "sensor_002",
        "latitude": 39.9142,
        "longitude": 116.4174,
        "base_moisture": 52.0,
        "base_temp": 21.5
    },
    {
        "device_id": "sensor_003",
        "latitude": 39.8942,
        "longitude": 116.3974,
        "base_moisture": 48.0,
        "base_temp": 23.0
    }
]

def send_sensor_data(anomaly_type=None, anomaly_count=0):
    for sensor in sensors:
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        
        if anomaly_type == "spike" and anomaly_count == 0:
            moisture = sensor["base_moisture"] + 200
            temp = sensor["base_temp"] + 100
            anomaly_label = " [瞬间突增-应被过滤]"
        elif anomaly_type == "gradual" and anomaly_count < 4:
            moisture = sensor["base_moisture"] + 35 + (anomaly_count * 2)
            temp = sensor["base_temp"] + 18 + (anomaly_count * 1)
            anomaly_label = " [渐变异常-应被检测]"
        else:
            moisture = sensor["base_moisture"] + random.uniform(-5, 5)
            temp = sensor["base_temp"] + random.uniform(-2, 2)
            anomaly_label = ""
        
        data = {
            "device_id": sensor["device_id"],
            "timestamp": timestamp,
            "latitude": sensor["latitude"],
            "longitude": sensor["longitude"],
            "soil_moisture": round(moisture, 2),
            "temperature": round(temp, 2)
        }
        
        try:
            response = requests.post(f"{BASE_URL}/api/lora/data", json=data)
            if response.status_code == 200:
                print(f"✅ {sensor['device_id']}: 湿度={data['soil_moisture']}%, 温度={data['temperature']}°C{anomaly_label}")
            else:
                print(f"❌ {sensor['device_id']}: HTTP {response.status_code}")
        except Exception as e:
            print(f"❌ {sensor['device_id']}: {e}")

def main():
    print("🌾 农业物联网 - 传感器数据模拟器")
    print("=" * 60)
    print("按 Ctrl+C 停止发送")
    print()
    print("测试场景:")
    print("  1. 正常数据发送 (前10次)")
    print("  2. 瞬间突增数据 (第11次 - 应被异常检测过滤)")
    print("  3. 渐变异常数据 (连续4次 - 应被检测为异常)")
    print("  4. 恢复正常数据")
    print()
    
    count = 0
    spike_sent = False
    gradual_count = 0
    gradual_finished = False
    
    try:
        while True:
            count += 1
            
            if count == 11 and not spike_sent:
                print("\n⚠️  [测试1] 发送瞬间突增数据 (应被过滤)...")
                send_sensor_data(anomaly_type="spike", anomaly_count=0)
                spike_sent = True
                print()
            elif count > 12 and not gradual_finished and gradual_count < 4:
                if gradual_count == 0:
                    print("\n⚠️  [测试2] 开始发送渐变异常数据 (连续4次)...")
                send_sensor_data(anomaly_type="gradual", anomaly_count=gradual_count)
                gradual_count += 1
                if gradual_count >= 4:
                    gradual_finished = True
                    print("   ✅ 渐变异常数据发送完成")
                    print()
            else:
                send_sensor_data(anomaly_type=None)
            
            time.sleep(2)
            
    except KeyboardInterrupt:
        print("\n\n🛑 已停止数据发送")

if __name__ == "__main__":
    main()
