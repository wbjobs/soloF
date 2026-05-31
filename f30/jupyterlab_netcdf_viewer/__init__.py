__version__ = "0.1.0"


def _jupyter_labextension_paths():
    return [{
        "src": "labextension",
        "dest": "jupyterlab-netcdf-viewer"
    }]


def _jupyter_server_extension_points():
    return [{
        "module": "jupyterlab_netcdf_viewer"
    }]


def _load_jupyter_server_extension(server_app):
    from .handlers import setup_handlers
    setup_handlers(server_app.web_app)
    server_app.log.info("Registered jupyterlab-netcdf-viewer extension")
