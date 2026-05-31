import React, { useState, useEffect } from 'react';

function App() {
  const [dbPath, setDbPath] = useState(null);
  const [migrationsDir, setMigrationsDir] = useState(null);
  const [migrations, setMigrations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState('info');
  const [previewModal, setPreviewModal] = useState(null);

  const showMessage = (msg, type = 'info') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(null), 3000);
  };

  const handleOpenDatabase = async () => {
    setLoading(true);
    try {
      const result = await window.api.openDatabase();
      if (result.success) {
        setDbPath(result.data.dbPath);
        setMigrationsDir(result.data.migrationsDir);
        setMigrations(result.data.migrations);
        showMessage(`已打开数据库: ${result.data.dbPath}`, 'success');
      } else {
        showMessage(result.message, 'error');
      }
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!dbPath || !migrationsDir) return;
    setLoading(true);
    try {
      const result = await window.api.refreshMigrations(dbPath, migrationsDir);
      if (result.success) {
        setMigrations(result.data.migrations);
        showMessage('已刷新迁移列表', 'success');
      } else {
        showMessage(result.message, 'error');
      }
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewApply = (migration) => {
    setPreviewModal({
      migration,
      type: 'apply',
      title: `预览应用迁移 - ${migration.version}`,
      sql: migration.upSql || '无 SQL 语句'
    });
  };

  const handlePreviewRollback = (migration) => {
    setPreviewModal({
      migration,
      type: 'rollback',
      title: `预览回滚迁移 - ${migration.version}`,
      sql: migration.downSql || '无 SQL 语句'
    });
  };

  const handleConfirmAction = async () => {
    if (!previewModal) return;

    const { migration, type } = previewModal;

    if (type === 'apply') {
      await handleApply(migration.version);
    } else {
      await handleRollback(migration.version);
    }

    setPreviewModal(null);
  };

  const handleApply = async (version) => {
    if (!dbPath || !migrationsDir) return;
    setLoading(true);
    try {
      const result = await window.api.applyMigration(dbPath, migrationsDir, version);
      if (result.success) {
        setMigrations(result.data.migrations);
        showMessage(`已应用迁移: ${version}`, 'success');
      } else {
        showMessage(result.message, 'error');
      }
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRollback = async (version) => {
    if (!dbPath || !migrationsDir) return;
    setLoading(true);
    try {
      const result = await window.api.rollbackMigration(dbPath, migrationsDir, version);
      if (result.success) {
        setMigrations(result.data.migrations);
        showMessage(`已回滚迁移: ${version}`, 'success');
      } else {
        showMessage(result.message, 'error');
      }
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyAll = async () => {
    if (!dbPath || !migrationsDir) return;
    setLoading(true);
    try {
      const result = await window.api.applyAllMigrations(dbPath, migrationsDir);
      if (result.success) {
        setMigrations(result.data.migrations);
        showMessage('已应用所有未执行的迁移', 'success');
      } else {
        showMessage(result.message, 'error');
      }
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRollbackAll = async () => {
    if (!dbPath || !migrationsDir) return;
    if (!window.confirm('确定要回滚所有已应用的迁移吗？')) return;
    setLoading(true);
    try {
      const result = await window.api.rollbackAllMigrations(dbPath, migrationsDir);
      if (result.success) {
        setMigrations(result.data.migrations);
        showMessage('已回滚所有迁移', 'success');
      } else {
        showMessage(result.message, 'error');
      }
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && previewModal) {
        setPreviewModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewModal]);

  const appliedCount = migrations.filter(m => m.applied).length;

  return (
    <div className="app">
      <header className="header">
        <h1>SQLite Migration Manager</h1>
        <p className="subtitle">管理 SQLite 数据库的 Schema 版本</p>
      </header>

      {message && (
        <div className={`message message-${messageType}`}>
          {message}
        </div>
      )}

      <div className="toolbar">
        <button
          className="btn btn-primary"
          onClick={handleOpenDatabase}
          disabled={loading}
        >
          {loading ? '加载中...' : '打开数据库'}
        </button>

        {dbPath && (
          <>
            <button
              className="btn"
              onClick={handleRefresh}
              disabled={loading}
            >
              刷新
            </button>
            <button
              className="btn btn-success"
              onClick={handleApplyAll}
              disabled={loading || appliedCount === migrations.length}
            >
              全部应用
            </button>
            <button
              className="btn btn-danger"
              onClick={handleRollbackAll}
              disabled={loading || appliedCount === 0}
            >
              全部回滚
            </button>
          </>
        )}
      </div>

      {dbPath && (
        <div className="db-info">
          <div className="info-row">
            <span className="info-label">数据库:</span>
            <span className="info-value">{dbPath}</span>
          </div>
          <div className="info-row">
            <span className="info-label">迁移目录:</span>
            <span className="info-value">{migrationsDir}</span>
          </div>
          <div className="info-row">
            <span className="info-label">进度:</span>
            <span className="info-value">{appliedCount} / {migrations.length} 已应用</span>
          </div>
        </div>
      )}

      <div className="migrations-list">
        {!dbPath ? (
          <div className="empty-state">
            <div className="empty-icon">📁</div>
            <p>点击 "打开数据库" 选择一个 SQLite 文件</p>
            <p className="empty-hint">迁移文件应位于数据库同目录的 migrations 文件夹中</p>
          </div>
        ) : migrations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📄</div>
            <p>未找到迁移文件</p>
            <p className="empty-hint">请在 migrations 文件夹中创建 .sql 迁移文件</p>
            <p className="empty-hint">命名格式: 001_create_table.sql</p>
          </div>
        ) : (
          <table className="migrations-table">
            <thead>
              <tr>
                <th width="80">版本</th>
                <th>名称</th>
                <th width="100">状态</th>
                <th width="280">操作</th>
              </tr>
            </thead>
            <tbody>
              {migrations.map((migration) => (
                <tr key={migration.version} className={migration.applied ? 'applied' : 'pending'}>
                  <td className="version">{migration.version}</td>
                  <td className="name">{migration.name}</td>
                  <td>
                    <span className={`status-badge ${migration.applied ? 'status-applied' : 'status-pending'}`}>
                      {migration.applied ? '已应用' : '待应用'}
                    </span>
                  </td>
                  <td className="actions">
                    {migration.applied ? (
                      <>
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => handlePreviewRollback(migration)}
                          disabled={loading}
                        >
                          预览
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => handleRollback(migration.version)}
                          disabled={loading}
                        >
                          回滚
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => handlePreviewApply(migration)}
                          disabled={loading}
                        >
                          预览
                        </button>
                        <button
                          className="btn btn-sm btn-success"
                          onClick={() => handleApply(migration.version)}
                          disabled={loading}
                        >
                          应用
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {previewModal && (
        <div className="modal-overlay" onClick={() => setPreviewModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{previewModal.title}</h3>
              <button className="modal-close" onClick={() => setPreviewModal(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="sql-preview">
                <pre className="sql-code">{previewModal.sql}</pre>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn"
                onClick={() => setPreviewModal(null)}
                disabled={loading}
              >
                取消
              </button>
              <button
                className={`btn ${previewModal.type === 'apply' ? 'btn-success' : 'btn-danger'}`}
                onClick={handleConfirmAction}
                disabled={loading}
              >
                {loading ? '执行中...' : `确认${previewModal.type === 'apply' ? '应用' : '回滚'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
