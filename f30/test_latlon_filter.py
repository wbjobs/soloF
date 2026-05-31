#!/usr/bin/env python

import numpy as np
from netCDF4 import Dataset
import tempfile
import os

def find_coord_index(coord_array, min_val, max_val):
    indices = np.where((coord_array >= min_val) & (coord_array <= max_val))[0]
    if len(indices) == 0:
        return 0, len(coord_array)
    return indices[0], indices[-1] + 1

def test_latlon_filter():
    print("Testing lat/lon filter...")
    
    with tempfile.NamedTemporaryFile(suffix='.nc', delete=False) as tmp:
        tmp_path = tmp.name
    
    try:
        nc = Dataset(tmp_path, 'w')
        
        lat_dim = nc.createDimension('latitude', 50)
        lon_dim = nc.createDimension('longitude', 100)
        time_dim = nc.createDimension('time', 3)
        
        lat_var = nc.createVariable('latitude', 'f4', ('latitude',))
        lon_var = nc.createVariable('longitude', 'f4', ('longitude',))
        temp_var = nc.createVariable('temperature', 'f4', ('time', 'latitude', 'longitude'))
        
        lat_values = np.linspace(20, 70, 50)
        lon_values = np.linspace(100, 180, 100)
        
        lat_var[:] = lat_values
        lon_var[:] = lon_values
        
        for t in range(3):
            temp_var[t, :, :] = 280 + t * 10 + np.random.rand(50, 100) * 10
        
        nc.close()
        
        with Dataset(tmp_path, 'r') as ds:
            print(f"\nOriginal data shape: {ds.variables['temperature'].shape}")
            print(f"Lat range: {lat_values.min():.1f} - {lat_values.max():.1f}")
            print(f"Lon range: {lon_values.min():.1f} - {lon_values.max():.1f}")
            
            test_lat_min, test_lat_max = 30, 50
            test_lon_min, test_lon_max = 120, 150
            
            print(f"\nTest filter: lat={test_lat_min},{test_lat_max} lon={test_lon_min},{test_lon_max}")
            
            lat_start, lat_end = find_coord_index(lat_values, test_lat_min, test_lat_max)
            lon_start, lon_end = find_coord_index(lon_values, test_lon_min, test_lon_max)
            
            print(f"Lat indices: {lat_start} - {lat_end}")
            print(f"Lon indices: {lon_start} - {lon_end}")
            
            filtered = ds.variables['temperature'][0, lat_start:lat_end, lon_start:lon_end]
            print(f"Filtered data shape: {filtered.shape}")
            
            actual_lat = lat_values[lat_start:lat_end]
            actual_lon = lon_values[lon_start:lon_end]
            print(f"Actual lat range: {actual_lat.min():.1f} - {actual_lat.max():.1f}")
            print(f"Actual lon range: {actual_lon.min():.1f} - {actual_lon.max():.1f}")
            
            if (actual_lat.min() >= test_lat_min and actual_lat.max() <= test_lat_max and
                actual_lon.min() >= test_lon_min and actual_lon.max() <= test_lon_max):
                print("\n✓ Filter test passed!")
            else:
                print("\n✗ Filter test failed!")
        
    finally:
        os.unlink(tmp_path)

if __name__ == '__main__':
    test_latlon_filter()
