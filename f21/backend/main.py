from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS
import psycopg2
import numpy as np
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="农业物联网系统 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

INFLUXDB_URL = os.getenv("INFLUXDB_URL", "http://localhost:8086")
INFLUXDB_TOKEN = os.getenv("INFLUXDB_TOKEN", "my-token")
INFLUXDB_ORG = os.getenv("INFLUXDB_ORG", "agri-iot")
INFLUXDB_BUCKET = os.getenv("INFLUXDB_BUCKET", "sensor-data")

POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")
POSTGRES_DB = os.getenv("POSTGRES_DB", "agri_iot")
POSTGRES_USER = os.getenv("POSTGRES_USER", "postgres")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "postgres")

influx_client = InfluxDBClient(url=INFLUXDB_URL, token=INFLUXDB_TOKEN, org=INFLUXDB_ORG)
write_api = influx_client.write_api(write_options=SYNCHRONOUS)
query_api = influx_client.query_api()

def get_postgres_connection():
    return psycopg2.connect(
        host=POSTGRES_HOST,
        port=POSTGRES_PORT,
        database=POSTGRES_DB,
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD
    )

def init_postgres():
    conn = get_postgres_connection()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS anomalies (
            id SERIAL PRIMARY KEY,
            device_id VARCHAR(50) NOT NULL,
            timestamp TIMESTAMP NOT NULL,
            latitude FLOAT,
            longitude FLOAT,
            sensor_type VARCHAR(20),
            value FLOAT,
            mean_value FLOAT,
            std_value FLOAT,
            is_anomaly BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    cur.close()
    conn.close()

init_postgres()

class SensorData(BaseModel):
    device_id: str
    timestamp: str
    latitude: float
    longitude: float
    soil_moisture: float
    temperature: float

class AnomalyConfig(BaseModel):
    window_size: int | None = None
    iqr_threshold: float | None = None
    min_data_points: int | None = None
    recent_window: int | None = None
    required_anomalies: int | None = None

class AnomalyDetector:
    def __init__(self, window_size: int = 20, iqr_threshold: float = 2.5, 
                 min_data_points: int = 5, recent_window: int = 4, required_anomalies: int = 3):
        self.window_size = window_size
        self.iqr_threshold = iqr_threshold
        self.min_data_points = min_data_points
        self.recent_window = recent_window
        self.required_anomalies = required_anomalies
        self.data_buffer = {}
        self.valid_ranges = {
            "soil_moisture": {"min": 0, "max": 100, "max_change": 30},
            "temperature": {"min": -40, "max": 85, "max_change": 15}
        }
    
    def get_config(self) -> dict:
        return {
            "window_size": self.window_size,
            "iqr_threshold": self.iqr_threshold,
            "min_data_points": self.min_data_points,
            "recent_window": self.recent_window,
            "required_anomalies": self.required_anomalies
        }
    
    def update_config(self, config: dict) -> None:
        if "window_size" in config:
            self.window_size = int(config["window_size"])
        if "iqr_threshold" in config:
            self.iqr_threshold = float(config["iqr_threshold"])
        if "min_data_points" in config:
            self.min_data_points = int(config["min_data_points"])
        if "recent_window" in config:
            self.recent_window = int(config["recent_window"])
        if "required_anomalies" in config:
            self.required_anomalies = int(config["required_anomalies"])
        
        for key in self.data_buffer:
            while len(self.data_buffer[key]) > self.window_size:
                self.data_buffer[key].pop(0)
    
    def _calculate_rate_of_change(self, values: list, new_value: float) -> float:
        if len(values) < 2:
            return 0.0
        return abs(new_value - values[-2])
    
    def _is_within_valid_range(self, sensor_type: str, value: float) -> bool:
        if sensor_type not in self.valid_ranges:
            return True
        range_info = self.valid_ranges[sensor_type]
        return range_info["min"] <= value <= range_info["max"]
    
    def _is_change_rate_valid(self, sensor_type: str, values: list, new_value: float) -> bool:
        if sensor_type not in self.valid_ranges or len(values) < 2:
            return True
        max_change = self.valid_ranges[sensor_type]["max_change"]
        rate_of_change = self._calculate_rate_of_change(values, new_value)
        return rate_of_change <= max_change
    
    def detect(self, device_id: str, sensor_type: str, value: float) -> dict:
        key = f"{device_id}_{sensor_type}"
        if key not in self.data_buffer:
            self.data_buffer[key] = []
        
        if not self._is_within_valid_range(sensor_type, value):
            return {"is_anomaly": False, "mean": value, "std": 0, "skipped": "out_of_range"}
        
        if not self._is_change_rate_valid(sensor_type, self.data_buffer[key], value):
            return {"is_anomaly": False, "mean": value, "std": 0, "skipped": "change_rate_too_high"}
        
        self.data_buffer[key].append(value)
        if len(self.data_buffer[key]) > self.window_size:
            self.data_buffer[key].pop(0)
        
        if len(self.data_buffer[key]) < self.min_data_points:
            return {"is_anomaly": False, "mean": value, "std": 0}
        
        data_array = np.array(self.data_buffer[key])
        median_val = np.median(data_array)
        q1 = np.percentile(data_array, 25)
        q3 = np.percentile(data_array, 75)
        iqr = q3 - q1
        threshold = self.iqr_threshold * iqr
        
        lower_bound = median_val - threshold
        upper_bound = median_val + threshold
        
        recent_values = self.data_buffer[key][-self.recent_window:]
        anomalies_in_window = sum(1 for v in recent_values if v < lower_bound or v > upper_bound)
        is_anomaly = anomalies_in_window >= self.required_anomalies and len(recent_values) >= self.recent_window
        
        return {
            "is_anomaly": is_anomaly,
            "mean": float(median_val),
            "std": float(iqr)
        }

detector = AnomalyDetector(window_size=20, iqr_threshold=2.5)

@app.post("/api/lora/data")
async def receive_lora_data(data: SensorData):
    try:
        timestamp = datetime.fromisoformat(data.timestamp.replace("Z", "+00:00"))
        
        point = Point("sensor_data") \
            .tag("device_id", data.device_id) \
            .field("latitude", data.latitude) \
            .field("longitude", data.longitude) \
            .field("soil_moisture", data.soil_moisture) \
            .field("temperature", data.temperature) \
            .time(timestamp, WritePrecision.NS)
        
        write_api.write(bucket=INFLUXDB_BUCKET, org=INFLUXDB_ORG, record=point)
        
        for sensor_type, value in [("soil_moisture", data.soil_moisture), ("temperature", data.temperature)]:
            result = detector.detect(data.device_id, sensor_type, value)
            if result["is_anomaly"]:
                conn = get_postgres_connection()
                cur = conn.cursor()
                cur.execute("""
                    INSERT INTO anomalies (device_id, timestamp, latitude, longitude, sensor_type, value, mean_value, std_value)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    data.device_id, timestamp, data.latitude, data.longitude,
                    sensor_type, value, result["mean"], result["std"]
                ))
                conn.commit()
                cur.close()
                conn.close()
        
        return {"status": "success", "message": "数据接收成功"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/sensors/latest")
async def get_latest_sensors():
    query = f'''
    from(bucket: "{INFLUXDB_BUCKET}")
        |> range(start: -1h)
        |> filter(fn: (r) => r["_measurement"] == "sensor_data")
        |> group(columns: ["device_id"])
        |> sort(columns: ["_time"], desc: false)
        |> last()
        |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
    '''
    result = query_api.query(query=query, org=INFLUXDB_ORG)
    
    sensors = []
    for table in result:
        for record in table.records:
            sensors.append({
                "device_id": record.values.get("device_id"),
                "timestamp": record.values.get("_time").isoformat(),
                "latitude": record.values.get("latitude"),
                "longitude": record.values.get("longitude"),
                "soil_moisture": record.values.get("soil_moisture"),
                "temperature": record.values.get("temperature")
            })
    
    return sensors

@app.get("/api/anomalies")
async def get_anomalies(limit: int = 100):
    conn = get_postgres_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT device_id, timestamp, latitude, longitude, sensor_type, value, mean_value, std_value
        FROM anomalies
        ORDER BY timestamp DESC
        LIMIT %s
    """, (limit,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    
    anomalies = []
    for row in rows:
        anomalies.append({
            "device_id": row[0],
            "timestamp": row[1].isoformat(),
            "latitude": row[2],
            "longitude": row[3],
            "sensor_type": row[4],
            "value": row[5],
            "mean_value": row[6],
            "std_value": row[7]
        })
    
    return anomalies

@app.get("/api/anomaly/config")
async def get_anomaly_config():
    return detector.get_config()

@app.put("/api/anomaly/config")
async def update_anomaly_config(config: AnomalyConfig):
    try:
        detector.update_config(config.dict(exclude_none=True))
        return {"status": "success", "config": detector.get_config()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/sensors/export")
async def export_sensor_data(hours: int = 24):
    query = f'''
    from(bucket: "{INFLUXDB_BUCKET}")
        |> range(start: -{hours}h)
        |> filter(fn: (r) => r["_measurement"] == "sensor_data")
        |> sort(columns: ["_time"], desc: true)
    '''
    result = query_api.query(query=query, org=INFLUXDB_ORG)
    
    data_by_time = {}
    for table in result:
        for record in table.records:
            timestamp = record.values.get("_time").isoformat()
            device_id = record.values.get("device_id")
            key = f"{timestamp}_{device_id}"
            if key not in data_by_time:
                data_by_time[key] = {
                    "timestamp": timestamp,
                    "device_id": device_id,
                    "latitude": 0,
                    "longitude": 0,
                    "soil_moisture": 0,
                    "temperature": 0
                }
            field = record.values.get("_field")
            if field in data_by_time[key]:
                data_by_time[key][field] = record.values.get("_value")
    
    csv_lines = ["timestamp,device_id,latitude,longitude,soil_moisture,temperature"]
    for data in sorted(data_by_time.values(), key=lambda x: x["timestamp"], reverse=True):
        csv_lines.append(
            f"{data['timestamp']},{data['device_id']},{data['latitude']},{data['longitude']},{data['soil_moisture']},{data['temperature']}"
        )
    
    return Response(
        content="\n".join(csv_lines),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=sensor_data_{hours}h.csv"}
    )

@app.get("/api/anomalies/export")
async def export_anomalies(limit: int = 1000):
    conn = get_postgres_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT device_id, timestamp, latitude, longitude, sensor_type, value, mean_value, std_value
        FROM anomalies
        ORDER BY timestamp DESC
        LIMIT %s
    """, (limit,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    
    csv_lines = ["device_id,timestamp,latitude,longitude,sensor_type,value,mean_value,std_value"]
    for row in rows:
        csv_lines.append(
            f"{row[0]},{row[1].isoformat()},{row[2]},{row[3]},{row[4]},{row[5]},{row[6]},{row[7]}"
        )
    
    return Response(
        content="\n".join(csv_lines),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=anomalies_{limit}.csv"}
    )

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
