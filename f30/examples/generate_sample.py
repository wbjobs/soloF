#!/usr/bin/env python

import numpy as np
from netCDF4 import Dataset, num2date, date2num
from datetime import datetime, timedelta
import os

def generate_sample_nc(output_path='temperature.nc'):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    nc = Dataset(output_path, 'w', format='NETCDF4')
    
    lat_dim = nc.createDimension('latitude', 50)
    lon_dim = nc.createDimension('longitude', 100)
    time_dim = nc.createDimension('time', 24)
    
    lat_var = nc.createVariable('latitude', 'f4', ('latitude',))
    lon_var = nc.createVariable('longitude', 'f4', ('longitude',))
    time_var = nc.createVariable('time', 'f4', ('time',))
    temp_var = nc.createVariable('temperature', 'f4', ('time', 'latitude', 'longitude'), zlib=True)
    
    lat_var.units = 'degrees_north'
    lat_var.long_name = 'Latitude'
    lat_var.standard_name = 'latitude'
    
    lon_var.units = 'degrees_east'
    lon_var.long_name = 'Longitude'
    lon_var.standard_name = 'longitude'
    
    time_var.units = 'hours since 1900-01-01 00:00:00'
    time_var.long_name = 'Time'
    time_var.standard_name = 'time'
    time_var.calendar = 'gregorian'
    
    temp_var.units = 'K'
    temp_var.long_name = 'Temperature'
    temp_var.standard_name = 'air_temperature'
    
    latitudes = np.linspace(20, 50, 50)
    longitudes = np.linspace(100, 150, 100)
    times = [datetime(2024, 1, 1) + timedelta(hours=i) for i in range(24)]
    
    lat_var[:] = latitudes
    lon_var[:] = longitudes
    time_var[:] = date2num(times, units=time_var.units, calendar='gregorian')
    
    lon_grid, lat_grid = np.meshgrid(longitudes, latitudes)
    
    for t in range(24):
        base_temp = 280 + 10 * np.sin(2 * np.pi * t / 24)
        lat_effect = -0.5 * (lat_grid - 35) ** 2 / 100
        lon_effect = 5 * np.sin(2 * np.pi * (lon_grid - 125) / 50)
        noise = np.random.normal(0, 0.5, lat_grid.shape)
        temp_var[t, :, :] = base_temp + lat_effect + lon_effect + noise
    
    nc.Conventions = 'CF-1.8'
    nc.title = 'Sample Temperature Data'
    nc.institution = 'Test Institution'
    nc.source = 'Generated sample data'
    nc.history = f'Created on {datetime.now().isoformat()}'
    
    nc.close()
    print(f'Sample NetCDF file created: {output_path}')
    print(f'Dimensions: time=24, latitude=50, longitude=100')
    return output_path

if __name__ == '__main__':
    generate_sample_nc()
