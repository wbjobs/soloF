import React from 'react';

function LatestDataTable({ data, nodes }) {
  const getNodeInfo = (devEui) => {
    const node = nodes.find(n => n.dev_eui === devEui);
    return node ? { name: node.name, location: node.location } : { name: devEui, location: '-' };
  };

  return (
    <div className="latest-data">
      <h2>📋 各节点最新数据汇总</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>节点名称</th>
            <th>位置</th>
            <th>湿度 (%)</th>
            <th>温度 (°C)</th>
            <th>电导率 (μS/cm)</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          {data.map(item => {
            const nodeInfo = getNodeInfo(item.dev_eui);
            return (
              <tr key={item.dev_eui}>
                <td><strong>{nodeInfo.name}</strong></td>
                <td>{nodeInfo.location}</td>
                <td style={{ color: '#2196f3', fontWeight: 600 }}>{item.humidity}</td>
                <td style={{ color: '#f44336', fontWeight: 600 }}>{item.temperature}</td>
                <td style={{ color: '#9c27b0', fontWeight: 600 }}>{item.conductivity}</td>
                <td>{new Date(item.timestamp).toLocaleString('zh-CN')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default LatestDataTable;
