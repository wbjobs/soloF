import React, { useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';

const Top10BarChart = () => {
  const [data, setData] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchData = async () => {
    try {
      const response = await fetch('/api/book/top10');
      if (response.ok) {
        const result = await response.json();
        setData(result);
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
      animation: false,
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
              转化率: ${(book.conversionRate * 100).toFixed(2)}%<br/>
              浏览次数: ${book.viewCount}<br/>
              购买次数: ${book.buyCount}
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
      max: 1,
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
        name: '转化率',
        type: 'bar',
        data: data.map(item => item.conversionRate),
        itemStyle: {
          color: function(params) {
            const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', 
                           '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#48b4e0'];
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
        },
        barWidth: '60%',
        animationDelay: function (idx) {
          return idx * 10;
        }
      }
    ]
  };

  return (
    <div className="chart-container">
      <h2>📈 转化率 Top 10 书籍</h2>
      <ReactECharts 
        option={option} 
        style={{ height: '500px' }}
        notMerge={false}
        lazyUpdate={true}
      />
      <div className="last-update">
        最后更新: {lastUpdate || '加载中...'}
      </div>
    </div>
  );
};

export default Top10BarChart;
