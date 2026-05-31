import React, { useState, useEffect } from 'react';
import { policyApi } from '../services/api';

function PolicySettings() {
  const [policies, setPolicies] = useState([]);
  const [devices, setDevices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState('policies');
  const [editingPolicy, setEditingPolicy] = useState(null);
  const [conditions, setConditions] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    try {
      if (activeTab === 'policies') {
        const [policiesRes, conditionsRes] = await Promise.all([
          policyApi.getPolicies(),
          policyApi.getConditions()
        ]);
        setPolicies(policiesRes.data.policies);
        setConditions(conditionsRes.data.conditions);
      } else if (activeTab === 'devices') {
        const res = await policyApi.getDevices();
        setDevices(res.data.devices);
      } else if (activeTab === 'logs') {
        const res = await policyApi.getAuthLogs(50);
        setLogs(res.data.logs);
      }
    } catch (err) {
      setError('Failed to load data');
    }
  };

  const handleInitPolicies = async () => {
    try {
      setError('');
      await policyApi.initDefaultPolicies();
      setSuccess('Default policies initialized successfully');
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to initialize policies');
    }
  };

  const handleCreatePolicy = () => {
    setEditingPolicy({
      name: '',
      description: '',
      conditions: {},
      requiredFactors: ['webauthn'],
      priority: 0
    });
  };

  const handleSavePolicy = async () => {
    try {
      setError('');
      if (editingPolicy.id) {
        await policyApi.updatePolicy(editingPolicy.id, editingPolicy);
      } else {
        await policyApi.createPolicy(editingPolicy);
      }
      setSuccess('Policy saved successfully');
      setEditingPolicy(null);
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save policy');
    }
  };

  const handleDeletePolicy = async (id) => {
    if (!window.confirm('Are you sure you want to delete this policy?')) return;
    
    try {
      await policyApi.deletePolicy(id);
      setSuccess('Policy deleted');
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete policy');
    }
  };

  const handleSetDefault = async (id) => {
    try {
      await policyApi.setDefaultPolicy(id);
      setSuccess('Default policy updated');
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to set default policy');
    }
  };

  const handleToggleDeviceTrust = async (fingerprint, currentTrust) => {
    try {
      await policyApi.setDeviceTrust(fingerprint, !currentTrust);
      setSuccess('Device trust updated');
      loadData();
    } catch (err) {
      setError('Failed to update device trust');
    }
  };

  const handleDeleteDevice = async (fingerprint) => {
    if (!window.confirm('Are you sure you want to remove this device?')) return;
    
    try {
      await policyApi.deleteDevice(fingerprint);
      setSuccess('Device removed');
      loadData();
    } catch (err) {
      setError('Failed to remove device');
    }
  };

  return (
    <div className="container">
      <div className="card card-wide">
        <h1>Security Policies</h1>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
          <button
            className={`btn-small ${activeTab === 'policies' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('policies')}
          >
            Policies
          </button>
          <button
            className={`btn-small ${activeTab === 'devices' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('devices')}
          >
            Trusted Devices
          </button>
          <button
            className={`btn-small ${activeTab === 'logs' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('logs')}
          >
            Activity Logs
          </button>
        </div>

        {activeTab === 'policies' && (
          <div>
            {policies.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <p>No policies configured</p>
                <button
                  className="btn-primary"
                  style={{ marginTop: '20px', maxWidth: '200px' }}
                  onClick={handleInitPolicies}
                >
                  Initialize Default Policies
                </button>
              </div>
            ) : (
              <>
                <button
                  className="btn-small btn-primary"
                  onClick={handleCreatePolicy}
                >
                  + Add Policy
                </button>
                <div style={{ marginTop: '20px' }}>
                  {policies.map((policy) => (
                    <div key={policy.id} className="factor-card">
                      <div className="factor-info">
                        <h3>
                          {policy.name}
                          {policy.is_default && (
                            <span className="status-badge status-enabled" style={{ marginLeft: '10px' }}>
                              Default
                            </span>
                          )}
                        </h3>
                        <p style={{ fontSize: '14px', marginBottom: '5px' }}>
                          {policy.description}
                        </p>
                        <p style={{ fontSize: '12px', color: '#718096' }}>
                          Priority: {policy.priority} | 
                          Factors: {policy.required_factors.join(', ')} | 
                          Conditions: {Object.keys(policy.conditions).length > 0 ? 
                            Object.entries(policy.conditions).map(([k, v]) => `${k}=${v}`).join(', ') : 
                            'Always apply'}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button
                          className="btn-small btn-secondary"
                          onClick={() => setEditingPolicy(policy)}
                        >
                          Edit
                        </button>
                        {!policy.is_default && (
                          <button
                            className="btn-small btn-secondary"
                            onClick={() => handleSetDefault(policy.id)}
                          >
                            Set Default
                          </button>
                        )}
                        {!policy.is_default && (
                          <button
                            className="btn-small btn-danger"
                            onClick={() => handleDeletePolicy(policy.id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'devices' && (
          <div>
            {devices.length === 0 ? (
              <p>No devices found</p>
            ) : (
              devices.map((device) => (
                <div key={device.id} className="factor-card">
                  <div className="factor-info">
                    <h3>{device.device_name || 'Unknown Device'}</h3>
                    <p style={{ fontSize: '14px' }}>
                      {device.user_agent?.substring(0, 100)}...
                    </p>
                    <p style={{ fontSize: '12px', color: '#718096' }}>
                      IP: {device.ip_address} | 
                      Last used: {new Date(device.last_used_at).toLocaleString()}
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-end' }}>
                    <span className={`status-badge ${device.is_trusted ? 'status-enabled' : 'status-disabled'}`}>
                      {device.is_trusted ? 'Trusted' : 'Untrusted'}
                    </span>
                    <button
                      className="btn-small btn-secondary"
                      onClick={() => handleToggleDeviceTrust(device.fingerprint, device.is_trusted)}
                    >
                      {device.is_trusted ? 'Untrust' : 'Trust'}
                    </button>
                    <button
                      className="btn-small btn-danger"
                      onClick={() => handleDeleteDevice(device.fingerprint)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'logs' && (
          <div>
            {logs.length === 0 ? (
              <p>No activity logs found</p>
            ) : (
              <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                {logs.map((log) => (
                  <div key={log.id} style={{
                    padding: '10px',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div>
                      <span className={`status-badge ${log.success ? 'status-enabled' : 'status-disabled'}`}>
                        {log.success ? 'Success' : 'Failed'}
                      </span>
                      <span style={{ marginLeft: '10px', fontSize: '14px' }}>
                        {log.auth_factors?.join(', ') || 'N/A'}
                      </span>
                      {log.failure_reason && (
                        <span style={{ color: '#c53030', marginLeft: '10px', fontSize: '12px' }}>
                          ({log.failure_reason})
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '12px', color: '#718096' }}>
                      {new Date(log.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {editingPolicy && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}>
            <div style={{
              background: 'white',
              padding: '30px',
              borderRadius: '12px',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '90vh',
              overflowY: 'auto'
            }}>
              <h2>{editingPolicy.id ? 'Edit Policy' : 'Create Policy'}</h2>
              
              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  value={editingPolicy.name}
                  onChange={(e) => setEditingPolicy({ ...editingPolicy, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  value={editingPolicy.description}
                  onChange={(e) => setEditingPolicy({ ...editingPolicy, description: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Priority (higher = checked first)</label>
                <input
                  type="number"
                  value={editingPolicy.priority}
                  onChange={(e) => setEditingPolicy({ ...editingPolicy, priority: parseInt(e.target.value) || 0 })}
                />
              </div>

              <div className="form-group">
                <label>Required Factors</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {['webauthn', 'totp', 'backup'].map((factor) => (
                    <label key={factor} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <input
                        type="checkbox"
                        checked={editingPolicy.requiredFactors.includes(factor)}
                        onChange={(e) => {
                          const factors = e.target.checked
                            ? [...editingPolicy.requiredFactors, factor]
                            : editingPolicy.requiredFactors.filter(f => f !== factor);
                          setEditingPolicy({ ...editingPolicy, requiredFactors: factors });
                        }}
                      />
                      {factor}
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Conditions</label>
                <div style={{ background: '#f7fafc', padding: '15px', borderRadius: '8px' }}>
                  <p style={{ fontSize: '12px', color: '#718096', marginBottom: '10px' }}>
                    Leave empty for "always apply"
                  </p>
                  {conditions.map((cond) => (
                    <div key={cond.type} style={{ marginBottom: '10px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input
                          type="checkbox"
                          checked={editingPolicy.conditions[cond.type] !== undefined}
                          onChange={(e) => {
                            const newConditions = { ...editingPolicy.conditions };
                            if (e.target.checked) {
                              newConditions[cond.type] = cond.valueType === 'boolean' ? true : 1;
                            } else {
                              delete newConditions[cond.type];
                            }
                            setEditingPolicy({ ...editingPolicy, conditions: newConditions });
                          }}
                        />
                        <strong>{cond.name}</strong>
                        <span style={{ fontSize: '12px', color: '#718096' }}>
                          ({cond.description})
                        </span>
                      </label>
                      {editingPolicy.conditions[cond.type] !== undefined && cond.valueType === 'number' && (
                        <input
                          type="number"
                          min={cond.min}
                          max={cond.max}
                          value={editingPolicy.conditions[cond.type]}
                          onChange={(e) => setEditingPolicy({
                            ...editingPolicy,
                            conditions: { ...editingPolicy.conditions, [cond.type]: parseInt(e.target.value) }
                          })}
                          style={{ marginTop: '5px', width: '100px' }}
                        />
                      )}
                      {editingPolicy.conditions[cond.type] !== undefined && cond.valueType === 'boolean' && (
                        <select
                          value={editingPolicy.conditions[cond.type]}
                          onChange={(e) => setEditingPolicy({
                            ...editingPolicy,
                            conditions: { ...editingPolicy.conditions, [cond.type]: e.target.value === 'true' }
                          })}
                          style={{ marginTop: '5px' }}
                        >
                          <option value="true">True</option>
                          <option value="false">False</option>
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button className="btn-primary" onClick={handleSavePolicy}>
                  Save
                </button>
                <button className="btn-secondary" onClick={() => setEditingPolicy(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PolicySettings;
