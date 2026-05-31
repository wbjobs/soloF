import React, { useState, useEffect } from 'react';
import axios from 'axios';

function AlertSettings({ rules, onRulesUpdated }) {
  const [localRules, setLocalRules] = useState(rules);
  const [isOpen, setIsOpen] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocalRules(rules);
  }, [rules]);

  const handleToggle = (type) => {
    setLocalRules(prev => ({
      ...prev,
      [type]: {
        ...prev[type],
        enabled: !prev[type].enabled
      }
    }));
  };

  const handleValueChange = (type, field, value) => {
    setLocalRules(prev => ({
      ...prev,
      [type]: {
        ...prev[type],
        [field]: parseFloat(value)
      }
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await axios.put('/api/alert-rules', localRules);
      if (response.data.success) {
        onRulesUpdated(response.data.rules);
      }
    } catch (error) {
      console.error('Failed to save alert rules:', error);
    } finally {
      setSaving(false);
    }
  };

  const ruleLabels = {
    conductivity: { label: '⚡ 电导率', unit: 'μS/cm' },
    humidity: { label: '💧 湿度', unit: '%' },
    temperature: { label: '🌡️ 温度', unit: '°C' }
  };

  return (
    <div className="settings-panel">
      <div className="settings-header" onClick={() => setIsOpen(!isOpen)}>
        <h2>⚙️ 预警规则设置</h2>
        <span className="settings-toggle">{isOpen ? '−' : '+'}</span>
      </div>

      {isOpen && (
        <>
          <div className="rules-grid">
            {Object.entries(localRules).map(([type, config]) => (
              <div key={type} className="rule-card">
                <div className="rule-header">
                  <span className="rule-title">{ruleLabels[type].label}</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={config.enabled}
                      onChange={() => handleToggle(type)}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
                <div className="rule-inputs">
                  <div className="input-group">
                    <label>最小值 ({ruleLabels[type].unit})</label>
                    <input
                      type="number"
                      value={config.min}
                      onChange={(e) => handleValueChange(type, 'min', e.target.value)}
                      disabled={!config.enabled}
                    />
                  </div>
                  <div className="input-group">
                    <label>最大值 ({ruleLabels[type].unit})</label>
                    <input
                      type="number"
                      value={config.max}
                      onChange={(e) => handleValueChange(type, 'max', e.target.value)}
                      disabled={!config.enabled}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button className="save-btn" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '💾 保存设置'}
          </button>
        </>
      )}
    </div>
  );
}

export default AlertSettings;
