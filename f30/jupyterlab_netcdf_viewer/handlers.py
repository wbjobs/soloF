import json
import os
from typing import Any, Dict, Optional

import numpy as np
from netCDF4 import Dataset, num2date
from tornado import web
from tornado.log import app_log

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join


class NetCDFBaseHandler(APIHandler):
    def initialize(self, notebook_dir: str) -> None:
        self.notebook_dir = notebook_dir

    def get_file_path(self, file_path: str) -> str:
        full_path = os.path.join(self.notebook_dir, file_path.lstrip("/"))
        if not os.path.exists(full_path):
            raise web.HTTPError(404, f"File not found: {file_path}")
        return full_path


class NetCDFMetaHandler(NetCDFBaseHandler):
    @web.authenticated
    def get(self, file_path: str) -> None:
        try:
            full_path = self.get_file_path(file_path)
            with Dataset(full_path, "r") as ds:
                metadata = {
                    "filename": os.path.basename(full_path),
                    "dimensions": {
                        name: {"size": dim.size, "unlimited": dim.isunlimited()}
                        for name, dim in ds.dimensions.items()
                    },
                    "variables": {},
                    "global_attributes": {
                        name: str(ds.getncattr(name))
                        for name in ds.ncattrs()
                    }
                }

                for var_name, var in ds.variables.items():
                    var_info = {
                        "dimensions": var.dimensions,
                        "shape": var.shape,
                        "dtype": str(var.dtype),
                        "attributes": {
                            name: str(var.getncattr(name))
                            for name in var.ncattrs()
                        }
                    }
                    metadata["variables"][var_name] = var_info

            self.finish(json.dumps(metadata))
        except Exception as e:
            app_log.error(f"Error reading NetCDF metadata: {e}")
            raise web.HTTPError(500, str(e))


def find_coord_index(coord_array: np.ndarray, min_val: float, max_val: float) -> tuple:
    indices = np.where((coord_array >= min_val) & (coord_array <= max_val))[0]
    if len(indices) == 0:
        return 0, len(coord_array)
    return indices[0], indices[-1] + 1


class NetCFDataHandler(NetCDFBaseHandler):
    @web.authenticated
    def get(self, file_path: str, var_name: str) -> None:
        try:
            full_path = self.get_file_path(file_path)
            time_index = self.get_argument("time", None)
            lat_range = self.get_argument("lat", None)
            lon_range = self.get_argument("lon", None)
            
            with Dataset(full_path, "r") as ds:
                if var_name not in ds.variables:
                    raise web.HTTPError(404, f"Variable not found: {var_name}")
                
                var = ds.variables[var_name]
                
                lat_var = None
                lon_var = None
                for ln in ["latitude", "lat"]:
                    if ln in ds.variables:
                        lat_var = ds.variables[ln]
                        break
                for ln in ["longitude", "lon"]:
                    if ln in ds.variables:
                        lon_var = ds.variables[ln]
                        break
                
                lat_start, lat_end = 0, lat_var.shape[0] if lat_var else 0
                lon_start, lon_end = 0, lon_var.shape[0] if lon_var else 0
                
                if lat_range and lat_var is not None:
                    try:
                        lat_min, lat_max = map(float, lat_range.split(","))
                        lat_values = lat_var[:]
                        lat_start, lat_end = find_coord_index(lat_values, lat_min, lat_max)
                    except Exception as e:
                        app_log.warning(f"Invalid lat range: {lat_range}, error: {e}")
                
                if lon_range and lon_var is not None:
                    try:
                        lon_min, lon_max = map(float, lon_range.split(","))
                        lon_values = lon_var[:]
                        lon_start, lon_end = find_coord_index(lon_values, lon_min, lon_max)
                    except Exception as e:
                        app_log.warning(f"Invalid lon range: {lon_range}, error: {e}")
                
                data: Dict[str, Any] = {
                    "name": var_name,
                    "dimensions": var.dimensions,
                    "attributes": {
                        name: str(var.getncattr(name))
                        for name in var.ncattrs()
                    }
                }

                time_idx = 0
                if time_index is not None:
                    time_idx = int(time_index)

                if len(var.shape) == 3:
                    values = var[time_idx, lat_start:lat_end, lon_start:lon_end]
                    data["time_index"] = time_idx
                elif len(var.shape) == 2:
                    values = var[lat_start:lat_end, lon_start:lon_end]
                else:
                    values = var[:]
                
                data["shape"] = values.shape

                if np.ma.is_masked(values):
                    values = values.filled(np.nan)
                
                data["values"] = values.tolist()

                for coord_name in ["latitude", "lat", "longitude", "lon", "time"]:
                    if coord_name in ds.variables:
                        coord_var = ds.variables[coord_name]
                        coord_values = coord_var[:]
                        if coord_name == "time":
                            try:
                                units = coord_var.units if hasattr(coord_var, "units") else "hours since 1970-01-01"
                                calendar = coord_var.calendar if hasattr(coord_var, "calendar") else "standard"
                                dates = num2date(coord_values, units=units, calendar=calendar)
                                data[coord_name] = []
                                for d in dates:
                                    if hasattr(d, 'isoformat'):
                                        data[coord_name].append(d.isoformat())
                                    elif hasattr(d, 'strftime'):
                                        data[coord_name].append(d.strftime('%Y-%m-%dT%H:%M:%S'))
                                    else:
                                        data[coord_name].append(str(d))
                            except Exception as e:
                                app_log.warning(f"Time conversion failed: {e}, using raw values")
                                data[coord_name] = coord_values.tolist()
                        elif coord_name in ["latitude", "lat"] and lat_var is not None:
                            data[coord_name] = coord_values[lat_start:lat_end].tolist()
                        elif coord_name in ["longitude", "lon"] and lon_var is not None:
                            data[coord_name] = coord_values[lon_start:lon_end].tolist()
                        else:
                            data[coord_name] = coord_values.tolist()

            self.finish(json.dumps(data))
        except Exception as e:
            app_log.error(f"Error reading NetCDF data: {e}")
            raise web.HTTPError(500, str(e))


def setup_handlers(web_app: Any) -> None:
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]
    notebook_dir = web_app.settings["notebook_dir"]

    handlers = [
        (
            url_path_join(base_url, "api", "netcdf", "meta", "(.*)"),
            NetCDFMetaHandler,
            {"notebook_dir": notebook_dir}
        ),
        (
            url_path_join(base_url, "api", "netcdf", "data", "(.*)", "([^/]+)"),
            NetCFDataHandler,
            {"notebook_dir": notebook_dir}
        ),
    ]

    web_app.add_handlers(host_pattern, handlers)
