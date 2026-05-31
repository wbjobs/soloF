#!/usr/bin/env python

import numpy as np
from netCDF4 import Dataset, num2date, date2num
from datetime import datetime
import os
import tempfile

def test_time_conversion():
    print("Testing time conversion with 'hours since 1900-01-01'...")
    
    with tempfile.NamedTemporaryFile(suffix='.nc', delete=False) as tmp:
        tmp_path = tmp.name
    
    try:
        nc = Dataset(tmp_path, 'w')
        time_dim = nc.createDimension('time', 5)
        time_var = nc.createVariable('time', 'f4', ('time',))
        time_var.units = 'hours since 1900-01-01 00:00:00'
        time_var.calendar = 'gregorian'
        
        times = [datetime(2024, 1, 1) + np.timedelta64(i, 'h') for i in range(5)]
        time_var[:] = date2num(times, units=time_var.units, calendar='gregorian')
        
        print(f"Raw time values: {time_var[:].tolist()}")
        print(f"Time units: {time_var.units}")
        
        coord_values = time_var[:]
        units = time_var.units
        calendar = time_var.calendar
        dates = num2date(coord_values, units=units, calendar=calendar)
        
        print("\nConverting dates to ISO 8601 format:")
        result = []
        for d in dates:
            if hasattr(d, 'isoformat'):
                iso_date = d.isoformat()
                result.append(iso_date)
                print(f"  {d} -> {iso_date}")
            elif hasattr(d, 'strftime'):
                iso_date = d.strftime('%Y-%m-%dT%H:%M:%S')
                result.append(iso_date)
                print(f"  {d} -> {iso_date}")
            else:
                result.append(str(d))
                print(f"  {d} -> {str(d)} (using str())")
        
        print(f"\nSuccess! All {len(result)} dates converted to ISO 8601.")
        return result
        
    finally:
        os.unlink(tmp_path)

if __name__ == '__main__':
    test_time_conversion()
