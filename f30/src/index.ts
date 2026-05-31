import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ICommandPalette } from '@jupyterlab/apputils';
import { IFileBrowserFactory } from '@jupyterlab/filebrowser';

import { NetCDFViewer } from './widget';
import '../style/index.css';

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-netcdf-viewer:plugin',
  description: 'JupyterLab extension for viewing NetCDF meteorological data',
  autoStart: true,
  requires: [ICommandPalette, IFileBrowserFactory],
  activate: (
    app: JupyterFrontEnd,
    palette: ICommandPalette,
    fileBrowserFactory: IFileBrowserFactory
  ) => {
    const { commands, shell } = app;

    commands.addCommand('netcdf-viewer:open', {
      label: 'Open with NetCDF Viewer',
      isVisible: () => {
        const widget = fileBrowserFactory.tracker.currentWidget;
        if (!widget) return false;
        const selected = widget.selectedItems().next();
        return selected && !selected.isDir && selected.path.endsWith('.nc');
      },
      execute: async () => {
        const widget = fileBrowserFactory.tracker.currentWidget;
        if (!widget) {
          return;
        }

        const selected = widget.selectedItems().next();
        if (selected && !selected.isDir && selected.path.endsWith('.nc')) {
          const path = selected.path;
          
          const viewer = new NetCDFViewer();
          viewer.loadFile(path);
          
          shell.add(viewer, 'main');
          shell.activateById(viewer.id);
        }
      }
    });

    palette.addItem({
      command: 'netcdf-viewer:open',
      category: 'NetCDF Viewer'
    });

    console.log('JupyterLab extension jupyterlab-netcdf-viewer is activated!');
  }
};

export default plugin;
