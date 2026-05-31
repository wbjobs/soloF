import React, { useState } from 'react';

function ConfigEditor({ config, onSetConfig, onDeleteConfig }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [editingKey, setEditingKey] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (key.trim()) {
      onSetConfig(key.trim(), value);
      setKey('');
      setValue('');
    }
  };

  const handleEdit = (k, v) => {
    setKey(k);
    setValue(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
    setEditingKey(k);
  };

  const handleCancelEdit = () => {
    setKey('');
    setValue('');
    setEditingKey(null);
  };

  const handleDelete = (k) => {
    if (window.confirm(`确定要删除配置项 "${k}" 吗？`)) {
      onDeleteConfig(k);
      if (editingKey === k) {
        handleCancelEdit();
      }
    }
  };

  const configEntries = Object.entries(config);

  return (
    <div className="config-editor">
      <div className="editor-section">
        <h3>配置管理</h3>
        <form onSubmit={handleSubmit} className="config-form">
          <div className="form-group">
            <label>配置键</label>
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="输入配置键名"
              disabled={editingKey !== null}
            />
          </div>
          <div className="form-group">
            <label>配置值</label>
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="输入配置值 (支持字符串、数字、JSON对象)"
              rows={4}
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              {editingKey ? '更新配置' : '添加配置'}
            </button>
            {editingKey && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCancelEdit}
              >
                取消
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="config-list-section">
        <h3>当前配置 ({configEntries.length})</h3>
        {configEntries.length === 0 ? (
          <div className="empty-state">
            <p>暂无配置项</p>
            <p className="empty-hint">添加第一个配置项开始使用</p>
          </div>
        ) : (
          <div className="config-list">
            {configEntries.map(([k, v]) => (
              <div key={k} className="config-item">
                <div className="config-item-content">
                  <div className="config-key">{k}</div>
                  <div className="config-value">
                    {typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}
                  </div>
                </div>
                <div className="config-item-actions">
                  <button
                    className="btn btn-small"
                    onClick={() => handleEdit(k, v)}
                  >
                    编辑
                  </button>
                  <button
                    className="btn btn-danger btn-small"
                    onClick={() => handleDelete(k)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ConfigEditor;
