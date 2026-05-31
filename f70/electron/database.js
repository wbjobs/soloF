import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';

const sqlite = sqlite3.verbose();

export function initializeDatabase(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite.Database(dbPath, (err) => {
      if (err) {
        reject(err);
      } else {
        db.run(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(db);
          }
        });
      }
    });
  });
}

export function closeDatabase(db) {
  return new Promise((resolve, reject) => {
    if (db) {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    } else {
      resolve();
    }
  });
}

export function getAppliedVersions(db) {
  return new Promise((resolve, reject) => {
    db.all('SELECT version FROM schema_migrations ORDER BY version ASC', (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows.map(row => row.version));
      }
    });
  });
}

export function getMigrations(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .filter(file => /^\d+_/.test(file))
    .sort();

  return files.map(file => {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) return null;

    const version = match[1];
    const name = match[2].replace(/_/g, ' ');
    const fullPath = path.join(migrationsDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');

    const { upSql, downSql } = parseMigrationContent(content);

    return {
      version,
      name,
      fileName: file,
      fullPath,
      upSql,
      downSql
    };
  }).filter(Boolean);
}

function parseMigrationContent(content) {
  const upMatch = content.match(/--\s*UP[\s\S]*?(?=--\s*DOWN|$)/i);
  const downMatch = content.match(/--\s*DOWN[\s\S]*$/i);

  let upSql = '';
  let downSql = '';

  if (upMatch) {
    upSql = upMatch[0].replace(/--\s*UP\s*\n?/i, '').trim();
  } else {
    upSql = content.trim();
  }

  if (downMatch) {
    downSql = downMatch[0].replace(/--\s*DOWN\s*\n?/i, '').trim();
  }

  return { upSql, downSql };
}

function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function execSql(db, sql) {
  return new Promise((resolve, reject) => {
    if (!sql || sql.trim().length === 0) {
      resolve();
      return;
    }
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function applyMigration(db, migrationsDir, version) {
  const migration = getMigrationByVersion(migrationsDir, version);
  if (!migration) {
    throw new Error(`Migration ${version} not found`);
  }

  try {
    await runSql(db, 'BEGIN TRANSACTION');

    if (migration.upSql && migration.upSql.trim()) {
      await execSql(db, migration.upSql);
    }

    await runSql(db, 'INSERT INTO schema_migrations (version) VALUES (?)', [version]);
    await runSql(db, 'COMMIT');
  } catch (err) {
    try {
      await runSql(db, 'ROLLBACK');
    } catch (rollbackErr) {
      console.error('Rollback failed:', rollbackErr);
    }
    throw err;
  }
}

export async function rollbackMigration(db, migrationsDir, version) {
  const migration = getMigrationByVersion(migrationsDir, version);
  if (!migration) {
    throw new Error(`Migration ${version} not found`);
  }

  try {
    await runSql(db, 'BEGIN TRANSACTION');

    if (migration.downSql && migration.downSql.trim()) {
      await execSql(db, migration.downSql);
    }

    await runSql(db, 'DELETE FROM schema_migrations WHERE version = ?', [version]);
    await runSql(db, 'COMMIT');
  } catch (err) {
    try {
      await runSql(db, 'ROLLBACK');
    } catch (rollbackErr) {
      console.error('Rollback failed:', rollbackErr);
    }
    throw err;
  }
}

function getMigrationByVersion(migrationsDir, version) {
  const migrations = getMigrations(migrationsDir);
  return migrations.find(m => m.version === version);
}
