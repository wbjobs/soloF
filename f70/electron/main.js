import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { initializeDatabase, getMigrations, applyMigration, rollbackMigration, getAppliedVersions, closeDatabase } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let db = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  if (db) {
    await closeDatabase(db);
    db = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

async function getMigrationsWithStatus(db, migrationsDir) {
  const appliedVersions = await getAppliedVersions(db);
  const migrations = getMigrations(migrationsDir);
  return migrations.map(m => ({
    ...m,
    applied: appliedVersions.includes(m.version)
  }));
}

ipcMain.handle('open-database', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 SQLite 数据库文件',
    filters: [{ name: 'SQLite Files', extensions: ['sqlite', 'db', 'sqlite3'] }],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: '未选择文件' };
  }

  const dbPath = result.filePaths[0];
  const migrationsDir = path.join(path.dirname(dbPath), 'migrations');

  try {
    if (db) {
      await closeDatabase(db);
    }
    db = await initializeDatabase(dbPath);
    const migrationsWithStatus = await getMigrationsWithStatus(db, migrationsDir);

    return {
      success: true,
      data: {
        dbPath,
        migrationsDir,
        migrations: migrationsWithStatus
      }
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('refresh-migrations', async (_, { dbPath, migrationsDir }) => {
  try {
    if (!db) {
      db = await initializeDatabase(dbPath);
    }
    const migrationsWithStatus = await getMigrationsWithStatus(db, migrationsDir);

    return {
      success: true,
      data: { migrations: migrationsWithStatus }
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('apply-migration', async (_, { dbPath, migrationsDir, version }) => {
  try {
    if (!db) {
      db = await initializeDatabase(dbPath);
    }
    await applyMigration(db, migrationsDir, version);
    const migrationsWithStatus = await getMigrationsWithStatus(db, migrationsDir);

    return {
      success: true,
      data: { migrations: migrationsWithStatus }
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('rollback-migration', async (_, { dbPath, migrationsDir, version }) => {
  try {
    if (!db) {
      db = await initializeDatabase(dbPath);
    }
    await rollbackMigration(db, migrationsDir, version);
    const migrationsWithStatus = await getMigrationsWithStatus(db, migrationsDir);

    return {
      success: true,
      data: { migrations: migrationsWithStatus }
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('apply-all-migrations', async (_, { dbPath, migrationsDir }) => {
  try {
    if (!db) {
      db = await initializeDatabase(dbPath);
    }
    const migrations = getMigrations(migrationsDir);
    const appliedVersions = await getAppliedVersions(db);

    for (const migration of migrations) {
      if (!appliedVersions.includes(migration.version)) {
        await applyMigration(db, migrationsDir, migration.version);
      }
    }

    const migrationsWithStatus = await getMigrationsWithStatus(db, migrationsDir);

    return {
      success: true,
      data: { migrations: migrationsWithStatus }
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('rollback-all-migrations', async (_, { dbPath, migrationsDir }) => {
  try {
    if (!db) {
      db = await initializeDatabase(dbPath);
    }
    const migrations = getMigrations(migrationsDir);
    const appliedVersions = await getAppliedVersions(db);

    const reversedMigrations = [...migrations].reverse();
    for (const migration of reversedMigrations) {
      if (appliedVersions.includes(migration.version)) {
        await rollbackMigration(db, migrationsDir, migration.version);
      }
    }

    const migrationsWithStatus = await getMigrationsWithStatus(db, migrationsDir);

    return {
      success: true,
      data: { migrations: migrationsWithStatus }
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
});
