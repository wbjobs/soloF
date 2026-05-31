import { Message } from '@lumino/messaging';
import { Widget } from '@lumino/widgets';
import { Signal } from '@lumino/signaling';

import Plotly from 'plotly.js-dist-min';

import { NetCDFAPIClient } from './api';
import { PlotRenderer } from './plot';

export interface NetCDFMetadata {
  filename: string;
  dimensions: {
    [key: string]: {
      size: number;
      unlimited: boolean;
    };
  };
  variables: {
    [key: string]: {
      dimensions: string[];
      shape: number[];
      dtype: string;
      attributes: { [key: string]: string };
    };
  };
  global_attributes: { [key: string]: string };
}

export interface NetCDFData {
  name: string;
  dimensions: string[];
  shape: number[];
  attributes: { [key: string]: string };
  values: number[][];
  time_index?: number;
  latitude?: number[];
  longitude?: number[];
  time?: string[];
  lat?: number[];
  lon?: number[];
}

export class NetCDFViewer extends Widget {
  private _client: NetCDFAPIClient;
  private _filePath: string | null = null;
  private _metadata: NetCDFMetadata | null = null;
  private _currentData: NetCDFData | null = null;
  private _currentVariable: string = '';
  private _currentTimeIndex: number = 0;
  private _plotRenderer: PlotRenderer;
  private _isLoading: boolean = false;
  private _error: string | null = null;

  private _header: HTMLDivElement;
  private _controls: HTMLDivElement;
  private _filterControls: HTMLDivElement;
  private _infoPanel: HTMLDivElement;
  private _plotContainer: HTMLDivElement;
  private _variableSelect: HTMLSelectElement;
  private _colormapSelect: HTMLSelectElement;
  private _timeSlider: HTMLInputElement;
  private _timeLabel: HTMLLabelElement;
  private _latMinInput: HTMLInputElement;
  private _latMaxInput: HTMLInputElement;
  private _lonMinInput: HTMLInputElement;
  private _lonMaxInput: HTMLInputElement;
  private _applyFilterBtn: HTMLButtonElement;
  private _colormap: string = 'RdBu_r';

  constructor() {
    super();
    this.addClass('jp-NetCDFViewer');
    this.id = `netcdf-viewer-${Private.id++}`;
    this.title.label = 'NetCDF Viewer';
    this.title.closable = true;

    this._client = new NetCDFAPIClient();
    this._plotRenderer = new PlotRenderer();

    this._header = document.createElement('div');
    this._header.className = 'jp-NetCDFViewer-header';

    const title = document.createElement('h2');
    title.className = 'jp-NetCDFViewer-title';
    title.textContent = 'NetCDF Meteorological Data Viewer';
    this._header.appendChild(title);

    this._controls = document.createElement('div');
    this._controls.className = 'jp-NetCDFViewer-controls';

    const varGroup = document.createElement('div');
    varGroup.className = 'jp-NetCDFViewer-controlGroup';
    
    const varLabel = document.createElement('label');
    varLabel.textContent = 'Variable:';
    this._variableSelect = document.createElement('select');
    this._variableSelect.addEventListener('change', () => this._onVariableChange());
    
    varGroup.appendChild(varLabel);
    varGroup.appendChild(this._variableSelect);
    this._controls.appendChild(varGroup);

    const cmapGroup = document.createElement('div');
    cmapGroup.className = 'jp-NetCDFViewer-controlGroup';
    
    const cmapLabel = document.createElement('label');
    cmapLabel.textContent = 'Colormap:';
    this._colormapSelect = document.createElement('select');
    const colormaps = ['RdBu_r', 'viridis', 'plasma', 'inferno', 'magma', 'cividis', 'jet', 'rainbow', 'coolwarm', 'bwr', 'seismic', 'terrain', 'ocean', 'gist_earth'];
    for (const cmap of colormaps) {
      const option = document.createElement('option');
      option.value = cmap;
      option.textContent = cmap;
      this._colormapSelect.appendChild(option);
    }
    this._colormapSelect.value = this._colormap;
    this._colormapSelect.addEventListener('change', () => this._onColormapChange());
    
    cmapGroup.appendChild(cmapLabel);
    cmapGroup.appendChild(this._colormapSelect);
    this._controls.appendChild(cmapGroup);

    const timeGroup = document.createElement('div');
    timeGroup.className = 'jp-NetCDFViewer-controlGroup';
    
    this._timeLabel = document.createElement('label');
    this._timeLabel.textContent = 'Time: 0';
    this._timeSlider = document.createElement('input');
    this._timeSlider.type = 'range';
    this._timeSlider.min = '0';
    this._timeSlider.max = '0';
    this._timeSlider.value = '0';
    this._timeSlider.addEventListener('input', () => this._onTimeChange());
    
    timeGroup.appendChild(this._timeLabel);
    timeGroup.appendChild(this._timeSlider);
    this._controls.appendChild(timeGroup);

    this._header.appendChild(this._controls);

    this._filterControls = document.createElement('div');
    this._filterControls.className = 'jp-NetCDFViewer-controls';

    const latGroup = document.createElement('div');
    latGroup.className = 'jp-NetCDFViewer-controlGroup';
    const latLabel = document.createElement('label');
    latLabel.textContent = 'Lat Range:';
    this._latMinInput = document.createElement('input');
    this._latMinInput.type = 'number';
    this._latMinInput.placeholder = 'min';
    this._latMinInput.step = '0.1';
    const latSep = document.createElement('span');
    latSep.textContent = '-';
    this._latMaxInput = document.createElement('input');
    this._latMaxInput.type = 'number';
    this._latMaxInput.placeholder = 'max';
    this._latMaxInput.step = '0.1';
    latGroup.appendChild(latLabel);
    latGroup.appendChild(this._latMinInput);
    latGroup.appendChild(latSep);
    latGroup.appendChild(this._latMaxInput);
    this._filterControls.appendChild(latGroup);

    const lonGroup = document.createElement('div');
    lonGroup.className = 'jp-NetCDFViewer-controlGroup';
    const lonLabel = document.createElement('label');
    lonLabel.textContent = 'Lon Range:';
    this._lonMinInput = document.createElement('input');
    this._lonMinInput.type = 'number';
    this._lonMinInput.placeholder = 'min';
    this._lonMinInput.step = '0.1';
    const lonSep = document.createElement('span');
    lonSep.textContent = '-';
    this._lonMaxInput = document.createElement('input');
    this._lonMaxInput.type = 'number';
    this._lonMaxInput.placeholder = 'max';
    this._lonMaxInput.step = '0.1';
    lonGroup.appendChild(lonLabel);
    lonGroup.appendChild(this._lonMinInput);
    lonGroup.appendChild(lonSep);
    lonGroup.appendChild(this._lonMaxInput);
    this._filterControls.appendChild(lonGroup);

    this._applyFilterBtn = document.createElement('button');
    this._applyFilterBtn.textContent = 'Apply Filter';
    this._applyFilterBtn.className = 'jp-NetCDFViewer-button';
    this._applyFilterBtn.addEventListener('click', () => this._onApplyFilter());
    this._filterControls.appendChild(this._applyFilterBtn);

    this._header.appendChild(this._filterControls);

    this._infoPanel = document.createElement('div');
    this._infoPanel.className = 'jp-NetCDFViewer-info';
    
    this._plotContainer = document.createElement('div');
    this._plotContainer.className = 'jp-NetCDFViewer-plotContainer';

    this.node.appendChild(this._header);
    this.node.appendChild(this._infoPanel);
    this.node.appendChild(this._plotContainer);
  }

  get filePath(): string | null {
    return this._filePath;
  }

  get metadata(): NetCDFMetadata | null {
    return this._metadata;
  }

  get currentData(): NetCDFData | null {
    return this._currentData;
  }

  async loadFile(filePath: string): Promise<void> {
    this._filePath = filePath;
    this.title.label = `NetCDF: ${filePath.split('/').pop()}`;
    
    this._showLoading();
    
    try {
      this._metadata = await this._client.getMetadata(filePath);
      this._updateVariableSelect();
      await this._loadData();
    } catch (error) {
      this._showError(error as Error);
    }
  }

  private _updateVariableSelect(): void {
    if (!this._metadata) {
      return;
    }

    this._variableSelect.innerHTML = '';
    
    const variables = Object.keys(this._metadata.variables);
    const dataVariables = variables.filter(name => {
      const varInfo = this._metadata!.variables[name];
      return varInfo.shape.length >= 2 && 
             !['latitude', 'longitude', 'lat', 'lon', 'time'].includes(name.toLowerCase());
    });

    for (const name of dataVariables) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      this._variableSelect.appendChild(option);
    }

    if (dataVariables.length > 0) {
      this._currentVariable = dataVariables[0];
    }
  }

  private async _onVariableChange(): Promise<void> {
    this._currentVariable = this._variableSelect.value;
    this._currentTimeIndex = 0;
    await this._loadData();
  }

  private async _onTimeChange(): Promise<void> {
    this._currentTimeIndex = parseInt(this._timeSlider.value, 10);
    this._timeLabel.textContent = `Time: ${this._currentTimeIndex}`;
    await this._loadData();
  }

  private _onColormapChange(): void {
    this._colormap = this._colormapSelect.value;
    if (this._currentData) {
      this._renderPlot();
    }
  }

  private async _onApplyFilter(): Promise<void> {
    await this._loadData();
  }

  private async _loadData(): Promise<void> {
    if (!this._filePath || !this._currentVariable) {
      return;
    }

    this._showLoading();
    
    try {
      let latRange: string | undefined;
      let lonRange: string | undefined;

      const latMin = this._latMinInput.value;
      const latMax = this._latMaxInput.value;
      const lonMin = this._lonMinInput.value;
      const lonMax = this._lonMaxInput.value;

      if (latMin && latMax) {
        latRange = `${latMin},${latMax}`;
      }
      if (lonMin && lonMax) {
        lonRange = `${lonMin},${lonMax}`;
      }

      this._currentData = await this._client.getData(
        this._filePath,
        this._currentVariable,
        this._currentTimeIndex,
        latRange,
        lonRange
      );
      
      this._updateInfoPanel();
      this._updateTimeSlider();
      this._renderPlot();
    } catch (error) {
      this._showError(error as Error);
    }
  }

  private _updateInfoPanel(): void {
    if (!this._currentData) {
      this._infoPanel.innerHTML = '';
      return;
    }

    const meta = document.createElement('div');
    meta.className = 'jp-NetCDFViewer-meta';

    const items = [
      { label: 'Variable', value: this._currentData.name },
      { label: 'Dimensions', value: this._currentData.dimensions.join(', ') },
      { label: 'Shape', value: this._currentData.shape.join(' x ') },
      { label: 'Units', value: this._currentData.attributes.units || 'N/A' }
    ];

    for (const item of items) {
      const metaItem = document.createElement('div');
      metaItem.className = 'jp-NetCDFViewer-metaItem';
      
      const label = document.createElement('span');
      label.className = 'jp-NetCDFViewer-metaLabel';
      label.textContent = item.label;
      
      const value = document.createElement('span');
      value.className = 'jp-NetCDFViewer-metaValue';
      value.textContent = item.value;
      
      metaItem.appendChild(label);
      metaItem.appendChild(value);
      meta.appendChild(metaItem);
    }

    this._infoPanel.innerHTML = '';
    this._infoPanel.appendChild(meta);
  }

  private _updateTimeSlider(): void {
    if (!this._currentData || !this._currentData.time) {
      this._timeSlider.max = '0';
      this._timeSlider.disabled = true;
      return;
    }

    const maxTime = this._currentData.time.length - 1;
    this._timeSlider.max = maxTime.toString();
    this._timeSlider.disabled = false;
    this._timeSlider.value = this._currentTimeIndex.toString();
    
    if (this._currentData.time[this._currentTimeIndex]) {
      this._timeLabel.textContent = `Time: ${this._currentData.time[this._currentTimeIndex]}`;
    } else {
      this._timeLabel.textContent = `Time: ${this._currentTimeIndex}`;
    }
  }

  private _renderPlot(): void {
    if (!this._currentData) {
      return;
    }

    this._plotRenderer.render(this._plotContainer, this._currentData, this._colormap);
  }

  private _showLoading(): void {
    this._isLoading = true;
    this._error = null;
    this._plotContainer.innerHTML = '<div class="jp-NetCDFViewer-loading">Loading...</div>';
  }

  private _showError(error: Error): void {
    this._isLoading = false;
    this._error = error.message;
    this._plotContainer.innerHTML = `<div class="jp-NetCDFViewer-error">Error: ${error.message}</div>`;
  }

  protected onAfterShow(msg: Message): void {
    super.onAfterShow(msg);
    if (this._currentData) {
      this._renderPlot();
    }
  }

  protected onResize(msg: Widget.ResizeMessage): void {
    super.onResize(msg);
    if (this._currentData) {
      this._renderPlot();
    }
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._plotRenderer.dispose();
    super.dispose();
  }
}

namespace Private {
  export let id = 0;
}
