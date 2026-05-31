import React, { useState, useEffect, useRef } from 'react';
import ReactECharts from 'echarts-for-react';

const RealTimeLineChart = () => {
  const [times, setTimes] = useState([]);
  const [bookRates, setBookRates] = useState({});
  const [lastUpdate, setLastUpdate] = useState(null);
  const chartRef = useRef(null);

  const MAX_DATA_POINTS = 100;
  const MAX_SERIES = 5;

  const BOOK_NAMES = [
    '978-7-111-54493-7', '978-7-111-54494-4', '978-7-111-54495-1',
    '978-7-111-54496-8', '978-7-111-54497-5'
  ];

  const fetchData = async () => {
    try {
      const response = await fetch('/api/book/all');
      if (response.ok) {
        const result = await response.json();
        const now = new Date().toLocaleTimeString('zh-CN');
        
        setBookRates(prevRates => {
          const newRates = { ...prevRates };
          result.forEach(book => {
            if (!newRates[book.isbn]) {
              newRates[book.isbn] = [];
            }
            newRates[book.isbn].push({
              time: now,
              rate: book.conversionRate
            });
            if (newRates[book.isbn].length > MAX_DATA_POINTS) {
              newRates[book.isbn].shift();
            }
          });

          const activeIsbns = Object.keys(newRates)
            .filter(isbn => newRates[isbn].some(item => item.rate > 0))
            .slice(0, MAX_SERIES);

          if (activeIsbns.length === 0 && Object.keys(newRates).length === 0) {
            BOOK_NAMES.slice(0, MAX_SERIES).forEach(isbn => {
              if (!newRates[isbn]) {
                newRates[isbn] = [];
              }
            });
          }

          return newRates;
        });

        setTimes(prev => {
          const newTimes = [...prev, now];
          if (newTimes.length > MAX_DATA_POINTS) {
            newTimes.shift();
          }
          return newTimes;
        });

        setLastUpdate(new Date().toLocaleString('zh-CN'));
      }
    } catch (error) {
      console.error('获取实时数据失败:', error);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const getSeries = () => {
    const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de'];
    const isbns = Object.keys(bookRates).slice(0, MAX_SERIES);
    
    if (isbns.length === 0) {
      return BOOK_NAMES.slice(0, 3).map((isbn, index) => ({
        name: isbn.slice(-5),
        type: 'line',
        smooth: false,
        showSymbol: false,
        data: [],
        itemStyle: { color: colors[index] },
        sampling: 'lttb',
        large: true,
        largeThreshold: 500
      }));
    }

    return isbns.map((isbn, index) => ({
      name: isbn.slice(-5),
      type: 'line',
      smooth: false,
      showSymbol: false,
      data: bookRates[isbn]?.map(item => item.rate) || [],
      itemStyle: { color: colors[index % colors.length] },
      lineStyle: {
        width: 1.5
      },
      sampling: 'lttb',
      large: true,
      largeThreshold: 500,
      emphasis: {
        scale: false
      },
      animation: false
    }));
  };

  const option = {
    animation: false,
    tooltip: {
      trigger: 'axis',
      animation: false,
      appendToBody: true,
      formatter: function(params) {
        if (!params || params.length === 0) return '';
        let html = `<div style="padding: 8px;"><strong>${params[0].axisValue}</strong><br/>`;
        params.forEach(param => {
          html += `${param.seriesName}: ${(param.value * 100).toFixed(2)}%<br/>`;
        });
        html += '</div>';
        return html;
      }
    },
    legend: {
      data: getSeries().map(s => s.name),
      top: 0,
      animation: false
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '15%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: times,
      axisLabel: {
        fontSize: 9,
        interval: Math.floor(times.length / 8)
      },
      axisTick: {
        alignWithLabel: true
      }
    },
    yAxis: {
      type: 'value',
      max: 1,
      axisLabel: {
        formatter: '{value * 100} %',
        fontSize: 9
      },
      splitLine: {
        lineStyle: {
          type: 'dashed'
        }
      }
    },
    dataZoom: [
      {
        type: 'inside',
        start: 0,
        end: 100,
        zoomLock: false
      }
    ],
    series: getSeries()
  };

  const onChartReady = (echarts) => {
    chartRef.current = echarts;
  };

  return (
    <div className="chart-container">
      <h2>📉 实时转化率变化趋势</h2>
      <ReactECharts 
        option={option} 
        style={{ height: '500px' }}
        onChartReady={onChartReady}
        notMerge={false}
        lazyUpdate={true}
      />
      <div className="last-update">
        最后更新: {lastUpdate || '加载中...'} | 数据点: {times.length}
      </div>
    </div>
  );
};

export default RealTimeLineChart;
