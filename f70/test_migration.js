import { initializeDatabase, applyMigration, rollbackMigration, getAppliedVersions, getMigrations, closeDatabase } from './electron/database.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testDbPath = path.join(__dirname, 'test', 'test.sqlite');
const migrationsDir = path.join(__dirname, 'test', 'migrations');

async function test() {
  console.log('=== 开始测试迁移功能 ===\n');

  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
    console.log('已删除旧的测试数据库');
  }

  console.log('1. 初始化数据库...');
  const db = await initializeDatabase(testDbPath);
  console.log('   ✓ 数据库初始化成功\n');

  console.log('2. 读取迁移文件...');
  const migrations = getMigrations(migrationsDir);
  console.log(`   ✓ 找到 ${migrations.length} 个迁移文件:`);
  migrations.forEach(m => console.log(`     - ${m.version}: ${m.name}`));
  console.log();

  console.log('3. 应用所有迁移...');
  for (const migration of migrations) {
    console.log(`   正在应用迁移 ${migration.version}...`);
    await applyMigration(db, migrationsDir, migration.version);
    console.log(`   ✓ 迁移 ${migration.version} 应用成功`);
  }
  console.log();

  console.log('4. 验证已应用的版本...');
  let applied = await getAppliedVersions(db);
  console.log(`   ✓ 已应用版本: ${applied.join(', ')}`);
  console.log();

  console.log('5. 回滚到版本 001 (先回滚 003, 再回滚 002)...');
  
  console.log('   正在回滚迁移 003...');
  await rollbackMigration(db, migrationsDir, '003');
  console.log('   ✓ 迁移 003 回滚成功');
  
  applied = await getAppliedVersions(db);
  console.log(`   当前已应用版本: ${applied.join(', ')}`);
  console.log();

  console.log('   正在回滚迁移 002...');
  await rollbackMigration(db, migrationsDir, '002');
  console.log('   ✓ 迁移 002 回滚成功');
  
  applied = await getAppliedVersions(db);
  console.log(`   当前已应用版本: ${applied.join(', ')}`);
  console.log();

  console.log('6. 验证 users 表仍然存在 (通过尝试查询)...');
  try {
    await new Promise((resolve, reject) => {
      db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", (err, row) => {
        if (err) reject(err);
        else if (row) {
          console.log('   ✓ users 表存在');
          resolve();
        } else {
          reject(new Error('users 表不存在!'));
        }
      });
    });
  } catch (err) {
    console.error(`   ✗ 错误: ${err.message}`);
    await closeDatabase(db);
    process.exit(1);
  }
  console.log();

  console.log('7. 回滚最后一个迁移 001...');
  await rollbackMigration(db, migrationsDir, '001');
  console.log('   ✓ 迁移 001 回滚成功');
  
  applied = await getAppliedVersions(db);
  console.log(`   当前已应用版本: ${applied.length > 0 ? applied.join(', ') : '(无)'}`);
  console.log();

  console.log('8. 验证 users 表已被删除...');
  try {
    await new Promise((resolve, reject) => {
      db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", (err, row) => {
        if (err) reject(err);
        else if (!row) {
          console.log('   ✓ users 表已被成功删除');
          resolve();
        } else {
          reject(new Error('users 表仍然存在!'));
        }
      });
    });
  } catch (err) {
    console.error(`   ✗ 错误: ${err.message}`);
    await closeDatabase(db);
    process.exit(1);
  }
  console.log();

  console.log('9. 重新应用所有迁移验证完整性...');
  for (const migration of migrations) {
    await applyMigration(db, migrationsDir, migration.version);
  }
  applied = await getAppliedVersions(db);
  console.log(`   ✓ 所有迁移重新应用成功，已应用版本: ${applied.join(', ')}`);
  console.log();

  await closeDatabase(db);
  console.log('=== 所有测试通过! ===');
}

test().catch(err => {
  console.error('\n❌ 测试失败:', err);
  process.exit(1);
});
