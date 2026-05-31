import Plotly from 'plotly.js-dist-min';
import { NetCDFData } from './widget';

export class PlotRenderer {
  private _currentDiv: HTMLElement | null = null;

  render(container: HTMLElement, data: NetCDFData, colormap: string = 'RdBu_r'): void {
    this._currentDiv = container;
    container.innerHTML = '';

    const plotDiv = document.createElement('div');
    plotDiv.style.width = '100%';
    plotDiv.style.height = '100%';
    plotDiv.style.minHeight = '500px';
    container.appendChild(plotDiv);

    const latitude = data.latitude || data.lat || [];
    const longitude = data.longitude || data.lon || [];
    const values = data.values;

    if (latitude.length === 0 || longitude.length === 0 || !values) {
      this._renderFallback(plotDiv, data);
      return;
    }

    this._renderContour(plotDiv, data, latitude, longitude, values, colormap);
  }

  private async _renderContour(
    plotDiv: HTMLElement,
    data: NetCDFData,
    latitude: number[],
    longitude: number[],
    values: number[][],
    colormap: string
  ): Promise<void> {
    const units = data.attributes.units || '';
    const longName = data.attributes.long_name || data.name;
    const title = `${longName} (${units})${data.time && data.time_index !== undefined ? ` - ${data.time[data.time_index]}` : ''}`;

    const cmapEndsWithR = colormap.endsWith('_r');
    const baseCmap = cmapEndsWithR ? colormap.slice(0, -2) : colormap;

    const plotData: Plotly.Data[] = [
      {
        type: 'contour',
        x: longitude,
        y: latitude,
        z: values,
        colorscale: baseCmap,
        reversescale: !cmapEndsWithR,
        colorbar: {
          title: {
            text: units,
            font: { size: 12 }
          },
          thickness: 20,
          len: 0.8,
          x: 1.02
        },
        contours: {
          coloring: 'heatmap',
          showlines: true
        },
        line: {
          width: 0.5,
          color: '#333'
        }
      }
    ];

    const layout: Partial<Plotly.Layout> = {
      title: {
        text: title,
        font: { size: 16 },
        x: 0.5
      },
      xaxis: {
        title: {
          text: 'Longitude',
          font: { size: 14 }
        },
        tickfont: { size: 11 },
        showgrid: true,
        gridcolor: 'rgba(0,0,0,0.1)'
      },
      yaxis: {
        title: {
          text: 'Latitude',
          font: { size: 14 }
        },
        tickfont: { size: 11 },
        showgrid: true,
        gridcolor: 'rgba(0,0,0,0.1)',
        scaleanchor: 'x',
        scaleratio: 1
      },
      margin: {
        l: 60,
        r: 80,
        t: 60,
        b: 60
      },
      hovermode: 'closest',
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)'
    };

    const config: Partial<Plotly.Config> = {
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      toImageButtonOptions: {
        format: 'png',
        filename: 'netcdf-plot',
        height: 600,
        width: 800,
        scale: 2
      }
    };

    try {
      await Plotly.newPlot(plotDiv, plotData, layout, config);
    } catch (error) {
      console.error('Plotly error:', error);
      this._renderError(plotDiv, error as Error);
    }
  }

  private _renderFallback(plotDiv: HTMLElement, data: NetCDFData): void {
    const fallbackDiv = document.createElement('div');
    fallbackDiv.style.padding = '20px';
    fallbackDiv.style.textAlign = 'center';
    fallbackDiv.innerHTML = `
      <h3>Data Preview: ${data.name}</h3>
      <p>Dimensions: ${data.dimensions.join(', ')}</p>
      <p>Shape: ${data.shape.join(' x ')}</p>
      <p>Units: ${data.attributes.units || 'N/A'}</p>
      <p style="color: #666; font-size: 12px;">
        (Cannot render contour plot without latitude/longitude coordinates)
      </p>
    `;
    plotDiv.appendChild(fallbackDiv);
  }

  private _renderError(plotDiv: HTMLElement, error: Error): void {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'jp-NetCDFViewer-error';
    errorDiv.textContent = `Plot rendering error: ${error.message}`;
    plotDiv.appendChild(errorDiv);
  }

  dispose(): void {
    if (this._currentDiv) {
      try {
        Plotly.purge(this._currentDiv);
      } catch (e) {
      }
      this._currentDiv = null;
    }
  }
}
