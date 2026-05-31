import React, { useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';

const SellBuyRatioChart = () => {
  const [data, setData] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchData = async () => {
    try {
      const response = await fetch('/api/book/top10');
      if (response.ok) {
        const result = await response.json();
        const filteredData = result.filter(item => item.buyCount > 0).slice(0, 10);
        setData(filteredData);
        setLastUpdate(new Date().toLocaleString('zh-CN'));
      }
    } catch (error) {
      console.error('获取Top10数据失败:', error);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const option = {
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow'
      },
      formatter: function(params) {
        const item = params[0];
        const book = data.find(d => d.isbn === item.name);
        if (book) {
          return `
            <div style="padding: 8px;">
              <strong>ISBN: ${item.name}</strong><br/>
              卖出-购买比: ${(book.sellBuyRatio * 100).toFixed(2)}%<br/>
              购买次数: ${book.buyCount}<br/>
              卖出次数: ${book.sellCount}
            </div>
          `;
        }
        return item.name + ': ' + (item.value * 100).toFixed(2) + '%';
      }
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true
    },
    xAxis: {
      type: 'value',
      max: 2,
      axisLabel: {
        formatter: '{value * 100} %'
      }
    },
    yAxis: {
      type: 'category',
      data: data.map(item => item.isbn),
      axisLabel: {
        fontSize: 11,
        interval: 0
      }
    },
    series: [
      {
        name: '卖出-购买比',
        type: 'bar',
        data: data.map(item => item.sellBuyRatio),
        itemStyle: {
          color: function(params) {
            const colors = ['#fac858', '#ee6666', '#73c0de', '#5470c6', '#91cc75',
                           '#fc8452', '#9a60b4', '#ea7ccc', '#3ba272', '#48b4e0'];
            return colors[params.dataIndex % colors.length];
          }
        },
        label: {
          show: true,
          position: 'right',
          fontSize: 10,
          formatter: function(params) {
            return (params.value * 100).toFixed(2) + '%';
          }
        }
      }
    ]
  };

  return (
    <div className="chart-container">
      <h2>📊 卖出-购买比 Top 10</h2>
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

export default SellBuyRatioChart;
