const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

const MEMORY_LIMIT = 200 * 1024 * 1024;
const CHUNK_SIZE = 1024 * 1024;

function logMemoryUsage() {
  const used = process.memoryUsage();
  console.log(`内存使用: RSS=${Math.round(used.rss / 1024 / 1024)}MB, HeapTotal=${Math.round(used.heapTotal / 1024 / 1024)}MB, HeapUsed=${Math.round(used.heapUsed / 1024 / 1024)}MB`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    title: 'WebRTC 大文件传输'
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('save-file-dialog', async (event, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath,
    buttonLabel: '保存'
  });
  return result;
});

ipcMain.handle('select-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  return result;
});

ipcMain.handle('write-chunk-to-file', async (event, filePath, chunkIndex, chunkData, totalChunks) => {
  return new Promise((resolve, reject) => {
    const offset = chunkIndex * CHUNK_SIZE;
    const buffer = Buffer.from(chunkData);
    
    logMemoryUsage();
    
    fs.open(filePath, 'r+', (err, fd) => {
      if (err) {
        if (err.code === 'ENOENT') {
          fs.open(filePath, 'w', (err, fd) => {
            if (err) return reject(err);
            writeChunk(fd);
          });
        } else {
          reject(err);
        }
        return;
      }
      writeChunk(fd);
    });

    function writeChunk(fd) {
      fs.write(fd, buffer, 0, buffer.length, offset, (err) => {
        if (err) {
          fs.close(fd, () => reject(err));
          return;
        }
        fs.close(fd, (err) => {
          if (err) return reject(err);
          resolve({ success: true });
        });
      });
    }
  });
});

ipcMain.handle('initialize-file', async (event, filePath, fileSize) => {
  return new Promise((resolve, reject) => {
    fs.stat(filePath, async (err, stats) => {
      if (err && err.code !== 'ENOENT') {
        return reject(err);
      }
      
      if (stats && stats.size === fileSize) {
        return resolve({ exists: true, size: stats.size });
      }
      
      if (stats && stats.size > fileSize) {
        fs.truncate(filePath, fileSize, (err) => {
          if (err) return reject(err);
          resolve({ exists: false, size: fileSize });
        });
        return;
      }
      
      fs.open(filePath, 'w', (err, fd) => {
        if (err) return reject(err);
        
        if (fileSize === 0) {
          fs.close(fd, (err) => {
            if (err) return reject(err);
            resolve({ exists: false, size: 0 });
          });
          return;
        }
        
        fs.ftruncate(fd, fileSize, (err) => {
          if (err) {
            fs.close(fd, () => reject(err));
            return;
          }
          fs.close(fd, (err) => {
            if (err) return reject(err);
            resolve({ exists: false, size: fileSize });
          });
        });
      });
    });
  });
});

ipcMain.handle('get-file-chunk', async (event, filePath, chunkIndex) => {
  return new Promise((resolve, reject) => {
    const offset = chunkIndex * CHUNK_SIZE;
    const buffer = Buffer.alloc(CHUNK_SIZE);

    logMemoryUsage();

    fs.open(filePath, 'r', (err, fd) => {
      if (err) return reject(err);
      
      fs.read(fd, buffer, 0, CHUNK_SIZE, offset, (err, bytesRead) => {
        if (err) {
          fs.close(fd, () => reject(err));
          return;
        }
        fs.close(fd, (err) => {
          if (err) return reject(err);
          const result = buffer.slice(0, bytesRead);
          resolve(result);
        });
      });
    });
  });
});

ipcMain.handle('check-file-exists', async (event, filePath) => {
  return new Promise((resolve) => {
    fs.stat(filePath, (err, stats) => {
      if (err) {
        resolve({ exists: false });
      } else {
        resolve({ exists: true, size: stats.size });
      }
    });
  });
});

ipcMain.handle('get-existing-chunks', async (event, filePath, totalChunks) => {
  return new Promise((resolve, reject) => {
    fs.stat(filePath, async (err, stats) => {
      if (err) {
        if (err.code === 'ENOENT') {
          return resolve([]);
        }
        return reject(err);
      }
      
      const existingChunks = [];
      const sampleSize = 1024;
      const sampleBuffer = Buffer.alloc(sampleSize);
      
      fs.open(filePath, 'r', (err, fd) => {
        if (err) return reject(err);
        
        let checked = 0;
        
        function checkNextChunk() {
          if (checked >= totalChunks) {
            fs.close(fd, () => resolve(existingChunks));
            return;
          }
          
          const chunkIndex = checked;
          const offset = chunkIndex * CHUNK_SIZE;
          
          if (offset >= stats.size) {
            checked++;
            checkNextChunk();
            return;
          }
          
          fs.read(fd, sampleBuffer, 0, sampleSize, offset, (err, bytesRead) => {
            if (err) {
              checked++;
              checkNextChunk();
              return;
            }
            
            let hasData = false;
            for (let i = 0; i < bytesRead; i++) {
              if (sampleBuffer[i] !== 0) {
                hasData = true;
                break;
              }
            }
            
            if (hasData || offset + CHUNK_SIZE <= stats.size) {
              existingChunks.push(chunkIndex);
            }
            
            checked++;
            setImmediate(checkNextChunk);
          });
        }
        
        checkNextChunk();
      });
    });
  });
});

ipcMain.handle('get-memory-usage', async () => {
  const used = process.memoryUsage();
  return {
    rss: Math.round(used.rss / 1024 / 1024),
    heapTotal: Math.round(used.heapTotal / 1024 / 1024),
    heapUsed: Math.round(used.heapUsed / 1024 / 1024),
    limit: Math.round(MEMORY_LIMIT / 1024 / 1024)
  };
});
