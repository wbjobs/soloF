<script>
  import { onMount } from 'svelte'
  import * as d3 from 'd3'

  export let commits = []
  export let authorStats = {}

  let container

  onMount(() => {
    renderChart()
  })

  $: if (commits.length > 0 && container) {
    renderChart()
  }

  function renderChart() {
    if (!container || commits.length === 0) return

    d3.select(container).selectAll('*').remove()

    const margin = { top: 60, right: 150, bottom: 80, left: 60 }
    const width = 1000 - margin.left - margin.right
    const height = 400 - margin.top - margin.bottom

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    const authors = Object.keys(authorStats)
    if (authors.length === 0) return

    const dailyData = {}
    commits.forEach(commit => {
      const date = new Date(commit.timestamp * 1000)
      const dateStr = date.toISOString().split('T')[0]
      if (!dailyData[dateStr]) {
        dailyData[dateStr] = {}
        authors.forEach(author => dailyData[dateStr][author] = { lines_added: 0, lines_deleted: 0 })
      }
      if (dailyData[dateStr][commit.author]) {
        dailyData[dateStr][commit.author].lines_added += commit.lines_added || 0
        dailyData[dateStr][commit.author].lines_deleted += commit.lines_deleted || 0
      }
    })

    const dates = Object.keys(dailyData).sort()
    if (dates.length === 0) return

    const data = dates.map(date => {
      const row = { date: new Date(date) }
      let total = 0
      authors.forEach(author => {
        const net = dailyData[date][author].lines_added - dailyData[date][author].lines_deleted
        row[author] = Math.max(0, net)
        total += row[author]
      })
      return row
    })

    const x = d3.scaleTime()
      .domain(d3.extent(data, d => d.date))
      .range([0, width])

    const maxY = d3.max(data, d => {
      let sum = 0
      authors.forEach(author => sum += d[author])
      return sum
    }) || 1

    const y = d3.scaleLinear()
      .domain([0, maxY])
      .range([height, 0])

    const color = d3.scaleOrdinal()
      .domain(authors)
      .range(d3.schemeTableau10)

    const stack = d3.stack().keys(authors)
    const stackedData = stack(data)

    const area = d3.area()
      .x(d => x(d.data.date))
      .y0(d => y(d[0]))
      .y1(d => y(d[1]))
      .curve(d3.curveMonotoneX)

    svg.selectAll('.layer')
      .data(stackedData)
      .enter()
      .append('path')
      .attr('class', 'layer')
      .style('fill', d => color(d.key))
      .style('opacity', 0.8)
      .attr('d', area)
      .append('title')
      .text(d => d.key)

    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(d3.timeMonth.every(1)).tickFormat(d3.timeFormat('%Y-%m')))
      .selectAll('text')
      .style('text-anchor', 'end')
      .attr('dx', '-.8em')
      .attr('dy', '.15em')
      .attr('transform', 'rotate(-45)')

    svg.append('g')
      .call(d3.axisLeft(y))

    const legend = svg.append('g')
      .attr('transform', `translate(${width + 20}, 0)`)

    authors.forEach((author, i) => {
      const legendRow = legend.append('g')
        .attr('transform', `translate(0, ${i * 25})`)

      legendRow.append('rect')
        .attr('width', 15)
        .attr('height', 15)
        .attr('fill', color(author))

      legendRow.append('text')
        .attr('x', 20)
        .attr('y', 12)
        .text(author.length > 20 ? author.substring(0, 20) + '...' : author)
        .style('font-size', '12px')
    })

    svg.append('text')
      .attr('x', width / 2)
      .attr('y', -30)
      .attr('text-anchor', 'middle')
      .style('font-size', '16px')
      .style('font-weight', 'bold')
      .text('代码增删堆叠面积图')

    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -height / 2)
      .attr('y', -45)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .text('净行数')
  }
</script>

<div class="chart-container">
  <div bind:this={container}></div>
</div>

<style>
  .chart-container {
    background: white;
    padding: 20px;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    overflow-x: auto;
  }
</style>
