const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDicomFiles: (folderPath) => ipcRenderer.invoke('get-dicom-files', folderPath),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  saveCase: (caseData) => ipcRenderer.invoke('save-case', caseData),
  getCases: () => ipcRenderer.invoke('get-cases'),
  saveContour: (contourData) => ipcRenderer.invoke('save-contour', contourData),
  getContours: (caseId) => ipcRenderer.invoke('get-contours', caseId),
  exportJson: (contourData, exportPath) => ipcRenderer.invoke('export-json', contourData, exportPath),
  exportCsv: (measurements, exportPath) => ipcRenderer.invoke('export-csv', measurements, exportPath),
  generateThumbnail: (imageData, width, height) => ipcRenderer.invoke('generate-thumbnail', imageData, width, height),
  deleteCase: (caseId) => ipcRenderer.invoke('delete-case', caseId),
  getMemoryUsage: () => ipcRenderer.invoke('get-memory-usage'),
  forceGC: () => ipcRenderer.invoke('force-gc')
});
