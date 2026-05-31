#!/usr/bin/env python3
import pyarrow as pa
import pyarrow.parquet as pq
import numpy as np
import os

sensor_ids = list(range(1, 101))
locations = ["Building A", "Building B", "Building C", "Building D", "Building E"]
calibrations = np.random.uniform(0.95, 1.05, 100).astype(np.float32)
installation_dates = ["2023-01-15", "2023-03-20", "2023-06-10", "2023-09-05", "2024-01-01"]

table = pa.table({
    "id": pa.array(sensor_ids, type=pa.int32()),
    "location": pa.array([locations[i % 5] for i in range(100)], type=pa.string()),
    "calibration": pa.array(calibrations, type=pa.float32()),
    "install_date": pa.array([installation_dates[i % 5] for i in range(100)], type=pa.string()),
    "active": pa.array([True] * 100, type=pa.bool_())
})

output_path = os.path.join(os.path.dirname(__file__), "sensor_metadata.parquet")
pq.write_table(table, output_path)
print(f"Created sensor_metadata.parquet with {table.num_rows} rows")
print(f"Columns: {table.column_names}")
