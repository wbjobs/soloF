import { NetCDFMetadata, NetCDFData } from './widget';
import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';

export class NetCDFAPIClient {
  private _serverSettings: ServerConnection.ISettings;

  constructor() {
    this._serverSettings = ServerConnection.makeSettings();
  }

  async getMetadata(filePath: string): Promise<NetCDFMetadata> {
    const encodedPath = encodeURIComponent(filePath);
    const url = URLExt.join(
      this._serverSettings.baseUrl,
      'api',
      'netcdf',
      'meta',
      encodedPath
    );

    const response = await ServerConnection.makeRequest(
      url,
      { method: 'GET' },
      this._serverSettings
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch metadata: ${error}`);
    }

    return response.json();
  }

  async getData(
    filePath: string,
    variableName: string,
    timeIndex?: number,
    latRange?: string,
    lonRange?: string
  ): Promise<NetCDFData> {
    const encodedPath = encodeURIComponent(filePath);
    const encodedVar = encodeURIComponent(variableName);
    let url = URLExt.join(
      this._serverSettings.baseUrl,
      'api',
      'netcdf',
      'data',
      encodedPath,
      encodedVar
    );

    const params: string[] = [];
    if (timeIndex !== undefined) {
      params.push(`time=${timeIndex}`);
    }
    if (latRange) {
      params.push(`lat=${latRange}`);
    }
    if (lonRange) {
      params.push(`lon=${lonRange}`);
    }

    if (params.length > 0) {
      url += `?${params.join('&')}`;
    }

    const response = await ServerConnection.makeRequest(
      url,
      { method: 'GET' },
      this._serverSettings
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch data: ${error}`);
    }

    return response.json();
  }
}
