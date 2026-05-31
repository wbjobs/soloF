#!/usr/bin/env python3
import os
import argparse
import pyarrow as pa
import pyarrow.parquet as pq
import numpy as np
from datetime import datetime, timedelta

def generate_sensor_data(num_rows: int, num_sensors: int, output_path: str, row_group_size: int = 100_000) -> None:
    print(f"Generating {num_rows:,} rows of sensor data...")

    sensor_ids = np.random.randint(1, num_sensors + 1, size=num_rows)
    timestamps = np.array([
        (datetime(2024, 1, 1) + timedelta(seconds=i * 60)).timestamp() * 1000
        for i in range(num_rows)
    ], dtype=np.int64)
    temperature = np.random.normal(25.0, 5.0, size=num_rows).astype(np.float32)
    humidity = np.random.uniform(30.0, 80.0, size=num_rows).astype(np.float32)
    pressure = np.random.normal(1013.25, 10.0, size=num_rows).astype(np.float32)
    vibration = np.random.exponential(1.0, size=num_rows).astype(np.float32)
    status = np.random.choice(["normal", "warning", "error"], size=num_rows, p=[0.9, 0.08, 0.02])

    table = pa.table({
        "sensor_id": pa.array(sensor_ids, type=pa.int32()),
        "timestamp": pa.array(timestamps, type=pa.timestamp("ms")),
        "temp": pa.array(temperature, type=pa.float32()),
        "humidity": pa.array(humidity, type=pa.float32()),
        "pressure": pa.array(pressure, type=pa.float32()),
        "vibration": pa.array(vibration, type=pa.float32()),
        "status": pa.array(status, type=pa.string())
    })

    dir_path = os.path.dirname(output_path)
    if dir_path:
        os.makedirs(dir_path, exist_ok=True)

    print(f"Writing Parquet file to {output_path} with row_group_size={row_group_size}...")
    pq.write_table(
        table,
        output_path,
        row_group_size=row_group_size,
        compression="snappy"
    )

    file_size = os.path.getsize(output_path) / (1024 * 1024 * 1024)
    print(f"Done! File size: {file_size:.2f} GB")
    pf = pq.ParquetFile(output_path)
    print(f"Row groups: {pf.num_row_groups}")
    print(f"Schema: {table.schema}")
    print(f"Rows: {table.num_rows:,}")
    print(f"Columns: {table.num_columns}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate test sensor data in Parquet format")
    parser.add_argument("--rows", type=int, default=50_000_000,
                        help="Number of rows to generate (default: 50,000,000)")
    parser.add_argument("--sensors", type=int, default=100,
                        help="Number of sensors (default: 100)")
    parser.add_argument("--row-group-size", type=int, default=100_000,
                        help="Rows per row group (default: 100,000)")
    parser.add_argument("--output", type=str, default="sensor_data.parquet",
                        help="Output Parquet file path")
    args = parser.parse_args()

    generate_sensor_data(args.rows, args.sensors, args.output, args.row_group_size)
