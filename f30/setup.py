#!/usr/bin/env python

from setuptools import setup

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="jupyterlab-netcdf-viewer",
    version="0.1.0",
    author="Your Name",
    author_email="your.email@example.com",
    description="JupyterLab extension for viewing NetCDF meteorological data",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/your-username/jupyterlab-netcdf-viewer",
    packages=["jupyterlab_netcdf_viewer"],
    include_package_data=True,
    zip_safe=False,
    install_requires=[
        "jupyter_server>=1.0.0",
        "netCDF4>=1.5.0",
        "numpy>=1.19.0",
    ],
    python_requires=">=3.7",
    classifiers=[
        "Framework :: Jupyter",
        "Framework :: Jupyter :: JupyterLab",
        "Framework :: Jupyter :: JupyterLab :: 3",
        "Framework :: Jupyter :: JupyterLab :: 4",
        "Framework :: Jupyter :: JupyterLab :: Extensions",
        "Framework :: Jupyter :: JupyterLab :: Extensions :: Prebuilt",
        "License :: OSI Approved :: BSD License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.7",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
    entry_points={
        "jupyter_serverproxy_servers": [],
    },
)
