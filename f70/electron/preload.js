import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  openDatabase: () => ipcRenderer.invoke('open-database'),
  refreshMigrations: (dbPath, migrationsDir) =>
    ipcRenderer.invoke('refresh-migrations', { dbPath, migrationsDir }),
  applyMigration: (dbPath, migrationsDir, version) =>
    ipcRenderer.invoke('apply-migration', { dbPath, migrationsDir, version }),
  rollbackMigration: (dbPath, migrationsDir, version) =>
    ipcRenderer.invoke('rollback-migration', { dbPath, migrationsDir, version }),
  applyAllMigrations: (dbPath, migrationsDir) =>
    ipcRenderer.invoke('apply-all-migrations', { dbPath, migrationsDir }),
  rollbackAllMigrations: (dbPath, migrationsDir) =>
    ipcRenderer.invoke('rollback-all-migrations', { dbPath, migrationsDir })
});
