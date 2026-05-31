import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'simulation.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    viscosity REAL NOT NULL,
    diffusion REAL NOT NULL,
    time_step REAL NOT NULL,
    pressure_iterations INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const count = db.prepare('SELECT COUNT(*) as count FROM presets').get() as { count: number };
if (count.count === 0) {
  const insert = db.prepare(`
    INSERT INTO presets (name, viscosity, diffusion, time_step, pressure_iterations)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  insert.run('标准配置', 0.0001, 0.0001, 0.05, 20);
  insert.run('高粘性', 0.001, 0.0001, 0.05, 20);
  insert.run('快速扩散', 0.0001, 0.001, 0.05, 20);
}

export default db;
