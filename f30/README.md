# jupyterlab-netcdf-viewer

JupyterLab extension for viewing NetCDF meteorological data with Plotly.js contour plots.

## Features

- Open and visualize NetCDF (.nc) files directly in JupyterLab
- Interactive contour plots using Plotly.js
- Variable selection for multi-variable datasets
- Time slider for 3D (time, latitude, longitude) data
- Display of variable metadata (dimensions, shape, units)
- Backend Python API for efficient data extraction

## Requirements

- JupyterLab >= 4.0.0
- Python >= 3.8
- netCDF4
- numpy

## Install

To install the extension:

```bash
# First install the Python package
pip install .

# Then install the JupyterLab extension
jupyter labextension install .
```

## Development install

For a development installation:

```bash
# Install dependencies
jlpm

# Build Typescript source
jlpm build

# Link your development version of the extension with JupyterLab
jupyter labextension install .

# Rebuild Typescript source after making changes
jlpm build

# Rebuild JupyterLab after making any changes
jupyter lab build
```

You can watch the source directory and run JupyterLab in watch mode to watch for changes in the extension's source and automatically rebuild the extension and application.

```bash
# Watch the source directory in another terminal tab
jlpm watch

# Run jupyterlab in watch mode in one terminal tab
jupyter lab --watch
```

## Uninstall

```bash
pip uninstall jupyterlab-netcdf-viewer
jupyter labextension uninstall jupyterlab-netcdf-viewer
```

## Usage

1. Generate a sample NetCDF file (with "hours since 1900-01-01" time units):
   ```bash
   cd examples
   python generate_sample.py
   ```

2. Install the extension:
   ```bash
   # Install Python package
   pip install .

   # Install JupyterLab extension
   jlpm install
   jlpm build
   jupyter labextension install .
   ```

3. Start JupyterLab:
   ```bash
   jupyter lab
   ```

4. In JupyterLab:
   - Navigate to the file browser
   - Select a .nc file
   - Right-click and select "Open with NetCDF Viewer" from the context menu
   - Or use the command palette (Ctrl+Shift+C) and search for "NetCDF Viewer"

5. Interact with the viewer:
   - Select different variables from the dropdown
   - Use the time slider to view different time steps (time displayed in ISO 8601 format)
   - Use Plotly's toolbar to zoom, pan, or download the plot
   - View metadata about the selected variable

## API Endpoints

The extension provides the following API endpoints:

- `GET /api/netcdf/meta/{file_path}` - Get metadata (dimensions, variables, attributes)
- `GET /api/netcdf/data/{file_path}/{var_name}?time={t}` - Get variable data

## Project Structure

```
jupyterlab-netcdf-viewer/
├── src/
│   ├── index.ts       # Extension entry point
│   ├── widget.ts      # Main viewer widget
│   ├── factory.ts     # Widget factory for document registry
│   ├── api.ts         # API client for backend
│   └── plot.ts        # Plotly.js rendering
├── style/
│   └── index.css      # CSS styles
├── jupyterlab_netcdf_viewer/
│   ├── __init__.py    # Python package init
│   └── handlers.py    # Server API handlers
├── examples/
│   └── generate_sample.py  # Generate sample NetCDF file
├── package.json       # NPM package config
├── tsconfig.json      # Typescript config
└── pyproject.toml     # Python package config
```
