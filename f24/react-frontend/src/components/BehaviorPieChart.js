import React, { useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';

const BehaviorPieChart = () => {
  const [behaviorData, setBehaviorData] = useState({ view: 0, buy: 0, sell: 0 });
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchData = async () => {
    try {
      const response = await fetch('/api/book/behavior-summary');
      if (response.ok) {
        const result = await response.json();
        setBehaviorData(result);
        setLastUpdate(new Date().toLocaleString('zh-CN'));
      }
    } catch (error) {
      console.error('获取行为统计失败:', error);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const total = behaviorData.view + behaviorData.buy + behaviorData.sell;

  const option = {
    animation: false,
    tooltip: {
      trigger: 'item',
      formatter: '{a} <br/>{b}: {c} ({d}%)'
    },
    legend: {
      orient: 'horizontal',
      bottom: 0,
      data: ['浏览', '购买', '卖出']
    },
    series: [
      {
        name: '行为类型',
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 10,
          borderColor: '#fff',
          borderWidth: 2
        },
        label: {
          show: true,
          formatter: '{b}: {c} ({d}%)'
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 16,
            fontWeight: 'bold'
          }
        },
        labelLine: {
          show: true
        },
        data: [
          { value: behaviorData.view, name: '浏览', itemStyle: { color: '#5470c6' } },
          { value: behaviorData.buy, name: '购买', itemStyle: { color: '#91cc75' } },
          { value: behaviorData.sell, name: '卖出', itemStyle: { color: '#fac858' } }
        ]
      }
    ],
    graphic: [
      {
        type: 'text',
        left: 'center',
        top: '42%',
        style: {
          text: '总计\n' + total,
          textAlign: 'center',
          fill: '#333',
          fontSize: 14
        }
      }
    ]
  };

  return (
    <div className="chart-container">
      <h2>🥧 行为类型分布</h2>
      <ReactECharts 
        option={option} 
        style={{ height: '450px' }}
        notMerge={false}
        lazyUpdate={true}
      />
      <div className="last-update">
        最后更新: {lastUpdate || '加载中...'}
      </div>
    </div>
  );
};

export default BehaviorPieChart;
