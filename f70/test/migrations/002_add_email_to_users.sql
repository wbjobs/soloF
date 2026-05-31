-- UP
ALTER TABLE users ADD COLUMN email TEXT;

-- DOWN
-- SQLite 不支持直接删除列，需要重建表
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO users_new (id, username, password_hash, created_at)
SELECT id, username, password_hash, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
