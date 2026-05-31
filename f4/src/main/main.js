const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const sharp = require('sharp');

app.commandLine.appendSwitch('js-flags', '--expose-gc --max-old-space-size=4096');
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('enable-features', 'V8VmFuture');

let mainWindow;
let db;

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'dicom-viewer.db');
  db = new Database(dbPath);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patientId TEXT,
      patientName TEXT,
      studyDate TEXT,
      studyDescription TEXT,
      modality TEXT,
      thumbnailPath TEXT,
      dicomFolder TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS contours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caseId INTEGER,
      contourName TEXT,
      contourData TEXT,
      volume REAL,
      viewType TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (caseId) REFERENCES cases(id)
    );
    
    CREATE TABLE IF NOT EXISTS measurements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caseId INTEGER,
      contourId INTEGER,
      volume REAL,
      area REAL,
      exportPath TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (caseId) REFERENCES cases(id),
      FOREIGN KEY (contourId) REFERENCES contours(id)
    );
  `);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webgl: true,
      experimentalFeatures: true,
      enableBlinkFeatures: 'WebGL2ComputeRenderingContext',
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
  
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setFrameRate(60);
  });
}

let gcInterval;

app.whenReady().then(() => {
  initDatabase();
  createWindow();
  
  gcInterval = setInterval(() => {
    if (global.gc) {
      global.gc();
    }
  }, 30000);
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (gcInterval) {
    clearInterval(gcInterval);
  }
  if (db) {
    db.close();
    db = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-dicom-files', async (event, folderPath) => {
  try {
    const files = fs.readdirSync(folderPath);
    const dicomFiles = files
      .filter(f => f.endsWith('.dcm') || !path.extname(f))
      .map(f => path.join(folderPath, f));
    return dicomFiles;
  } catch (error) {
    return [];
  }
});

ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('save-case', async (event, caseData) => {
  const stmt = db.prepare(`
    INSERT INTO cases (patientId, patientName, studyDate, studyDescription, modality, thumbnailPath, dicomFolder)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    caseData.patientId,
    caseData.patientName,
    caseData.studyDate,
    caseData.studyDescription,
    caseData.modality,
    caseData.thumbnailPath,
    caseData.dicomFolder
  );
  return result.lastInsertRowid;
});

ipcMain.handle('get-cases', async () => {
  const stmt = db.prepare('SELECT * FROM cases ORDER BY createdAt DESC');
  return stmt.all();
});

ipcMain.handle('save-contour', async (event, contourData) => {
  const stmt = db.prepare(`
    INSERT INTO contours (caseId, contourName, contourData, volume, viewType)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    contourData.caseId,
    contourData.contourName,
    JSON.stringify(contourData.contourData),
    contourData.volume,
    contourData.viewType
  );
  return result.lastInsertRowid;
});

ipcMain.handle('get-contours', async (event, caseId) => {
  const stmt = db.prepare('SELECT * FROM contours WHERE caseId = ? ORDER BY createdAt DESC');
  const rows = stmt.all(caseId);
  return rows.map(row => ({
    ...row,
    contourData: JSON.parse(row.contourData)
  }));
});

ipcMain.handle('export-json', async (event, contourData, exportPath) => {
  fs.writeFileSync(exportPath, JSON.stringify(contourData, null, 2));
  return true;
});

ipcMain.handle('export-csv', async (event, measurements, exportPath) => {
  const header = 'Contour Name,Volume (mm³),Area (mm²),Date\n';
  const rows = measurements.map(m => 
    `"${m.name}",${m.volume},${m.area},${m.date}`
  ).join('\n');
  fs.writeFileSync(exportPath, header + rows);
  return true;
});

ipcMain.handle('generate-thumbnail', async (event, imageData, width, height) => {
  const thumbPath = path.join(app.getPath('userData'), 'thumbnails');
  if (!fs.existsSync(thumbPath)) {
    fs.mkdirSync(thumbPath, { recursive: true });
  }
  const filename = `thumb_${Date.now()}.png`;
  const fullPath = path.join(thumbPath, filename);
  
  await sharp(Buffer.from(imageData))
    .resize(width, height)
    .png()
    .toFile(fullPath);
  
  return fullPath;
});

ipcMain.handle('delete-case', async (event, caseId) => {
  db.prepare('DELETE FROM contours WHERE caseId = ?').run(caseId);
  db.prepare('DELETE FROM cases WHERE id = ?').run(caseId);
  return true;
});

ipcMain.handle('get-memory-usage', async () => {
  return process.memoryUsage();
});

ipcMain.handle('force-gc', async () => {
  if (global.gc) {
    global.gc();
  }
  return true;
});
