<script>
  import { onMount } from 'svelte'
  import * as d3 from 'd3'

  export let commits = []

  let container

  onMount(() => {
    renderHeatmap()
  })

  $: if (commits.length > 0 && container) {
    renderHeatmap()
  }

  function renderHeatmap() {
    if (!container || commits.length === 0) return

    d3.select(container).selectAll('*').remove()

    const margin = { top: 50, right: 30, bottom: 100, left: 60 }
    const width = 1000 - margin.left - margin.right
    const height = 300 - margin.top - margin.bottom

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    const dailyCommits = {}
    commits.forEach(commit => {
      const date = new Date(commit.timestamp * 1000)
      const dateStr = date.toISOString().split('T')[0]
      dailyCommits[dateStr] = (dailyCommits[dateStr] || 0) + 1
    })

    const dates = Object.keys(dailyCommits).sort()
    if (dates.length === 0) return

    const startDate = new Date(dates[0])
    const endDate = new Date(dates[dates.length - 1])

    const weeks = []
    let currentDate = new Date(startDate)
    while (currentDate.getDay() !== 0) {
      currentDate.setDate(currentDate.getDate() - 1)
    }

    while (currentDate <= endDate) {
      const week = []
      for (let i = 0; i < 7; i++) {
        const dateStr = currentDate.toISOString().split('T')[0]
        week.push({
          date: new Date(currentDate),
          count: dailyCommits[dateStr] || 0
        })
        currentDate.setDate(currentDate.getDate() + 1)
      }
      weeks.push(week)
    }

    const cellSize = 15
    const colorScale = d3.scaleQuantize()
      .domain([0, d3.max(Object.values(dailyCommits)) || 1])
      .range(['#ebedf0', '#c6e48b', '#7bc96f', '#239a3b', '#196127'])

    const dayLabels = ['日', '一', '二', '三', '四', '五', '六']
    svg.selectAll('.dayLabel')
      .data(dayLabels)
      .enter()
      .append('text')
      .text(d => d)
      .attr('x', -10)
      .attr('y', (d, i) => i * cellSize + cellSize / 2)
      .attr('text-anchor', 'end')
      .attr('alignment-baseline', 'middle')
      .style('font-size', '10px')
      .style('fill', '#666')

    weeks.forEach((week, weekIndex) => {
      week.forEach((day, dayIndex) => {
        svg.append('rect')
          .attr('x', weekIndex * cellSize)
          .attr('y', dayIndex * cellSize)
          .attr('width', cellSize - 2)
          .attr('height', cellSize - 2)
          .attr('rx', 2)
          .attr('fill', colorScale(day.count))
          .append('title')
          .text(`${day.date.toLocaleDateString()}: ${day.count} 次提交`)
      })
    })

    svg.append('text')
      .attr('x', width / 2)
      .attr('y', -20)
      .attr('text-anchor', 'middle')
      .style('font-size', '16px')
      .style('font-weight', 'bold')
      .text('贡献活动热力图')
  }
</script>

<div class="heatmap-container">
  <div bind:this={container}></div>
</div>

<style>
  .heatmap-container {
    background: white;
    padding: 20px;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    overflow-x: auto;
  }
</style>
