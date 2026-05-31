<script>
  import { onMount } from 'svelte'
  import * as d3 from 'd3'

  export let ownership = []

  let container

  function formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M'
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K'
    }
    return num.toString()
  }

  onMount(() => {
    renderTreemap()
  })

  $: if (ownership.length > 0 && container) {
    renderTreemap()
  }

  function renderTreemap() {
    if (!container || ownership.length === 0) return

    d3.select(container).selectAll('*').remove()

    const margin = { top: 60, right: 20, bottom: 30, left: 20 }
    const width = 1000 - margin.left - margin.right
    const height = 500 - margin.top - margin.bottom

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    svg.append('text')
      .attr('x', width / 2)
      .attr('y', -30)
      .attr('text-anchor', 'middle')
      .style('font-size', '18px')
      .style('font-weight', 'bold')
      .style('fill', '#1e293b')
      .text('代码所有权分布')

    const topN = Math.min(10, ownership.length)
    const topData = ownership.slice(0, topN)
    const otherLines = ownership.slice(topN).reduce((sum, o) => sum + o.lines, 0)
    
    if (otherLines > 0) {
      topData.push({
        author: '其他',
        lines: otherLines,
        percentage: ownership.slice(topN).reduce((sum, o) => sum + o.percentage, 0)
      })
    }

    const colorScale = d3.scaleOrdinal()
      .domain(topData.map(d => d.author))
      .range(d3.schemeTableau10.concat(d3.schemeSet3))

    const root = d3.hierarchy({ children: topData })
      .sum(d => d.lines)
      .sort((a, b) => b.value - a.value)

    const treemap = d3.treemap()
      .size([width, height])
      .padding(3)
      .round(true)

    treemap(root)

    const leaf = svg.selectAll('g')
      .data(root.leaves())
      .enter()
      .append('g')
      .attr('transform', d => `translate(${d.x0},${d.y0})`)

    leaf.append('rect')
      .attr('width', d => d.x1 - d.x0)
      .attr('height', d => d.y1 - d.y0)
      .attr('fill', d => colorScale(d.data.author))
      .attr('rx', 4)
      .attr('ry', 4)
      .style('opacity', 0.9)
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        d3.select(this).style('opacity', 1)
      })
      .on('mouseout', function(event, d) {
        d3.select(this).style('opacity', 0.9)
      })
      .append('title')
      .text(d => `${d.data.author}\n${formatNumber(d.data.lines)} 行\n${d.data.percentage.toFixed(2)}%`)

    leaf.filter(d => (d.x1 - d.x0) > 80 && (d.y1 - d.y0) > 40)
      .append('text')
      .attr('x', d => (d.x1 - d.x0) / 2)
      .attr('y', d => (d.y1 - d.y0) / 2 - 8)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .style('font-weight', '600')
      .style('fill', 'white')
      .style('text-shadow', '0 1px 2px rgba(0,0,0,0.5)')
      .text(d => {
        const name = d.data.author
        const rectWidth = d.x1 - d.x0
        const maxChars = Math.floor(rectWidth / 8)
        return name.length > maxChars ? name.substring(0, maxChars - 1) + '...' : name
      })

    leaf.filter(d => (d.x1 - d.x0) > 80 && (d.y1 - d.y0) > 50)
      .append('text')
      .attr('x', d => (d.x1 - d.x0) / 2)
      .attr('y', d => (d.y1 - d.y0) / 2 + 12)
      .attr('text-anchor', 'middle')
      .style('font-size', '11px')
      .style('fill', 'white')
      .style('text-shadow', '0 1px 2px rgba(0,0,0,0.5)')
      .text(d => `${d.data.percentage.toFixed(1)}%`)
  }
</script>

<div class="ownership-container">
  <div class="treemap" bind:this={container}></div>
  
  {#if ownership.length > 0}
    <div class="ownership-table">
      <h3>详细排名</h3>
      <table>
        <thead>
          <tr>
            <th>排名</th>
            <th>作者</th>
            <th>代码行数</th>
            <th>占比</th>
          </tr>
        </thead>
        <tbody>
          {#each ownership.slice(0, 15) as item, index}
            <tr>
              <td class="rank">#{index + 1}</td>
              <td class="author">{item.author}</td>
              <td class="lines">{formatNumber(item.lines)}</td>
              <td class="percentage">{item.percentage.toFixed(2)}%</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .ownership-container {
    background: white;
    padding: 24px;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }

  .treemap {
    overflow-x: auto;
    margin-bottom: 30px;
  }

  .treemap :global(svg) {
    display: block;
    margin: 0 auto;
  }

  .ownership-table h3 {
    margin: 0 0 16px 0;
    color: #1e293b;
    font-size: 16px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th {
    text-align: left;
    padding: 12px 16px;
    background: #f8fafc;
    color: #475569;
    font-weight: 600;
    font-size: 13px;
    border-bottom: 2px solid #e2e8f0;
  }

  td {
    padding: 12px 16px;
    border-bottom: 1px solid #f1f5f9;
    font-size: 14px;
  }

  tr:hover td {
    background: #f8fafc;
  }

  .rank {
    color: #64748b;
    font-weight: 600;
    width: 60px;
  }

  .author {
    color: #1e293b;
    font-weight: 500;
  }

  .lines {
    color: #475569;
    font-family: 'SF Mono', Monaco, monospace;
  }

  .percentage {
    color: #4f46e5;
    font-weight: 600;
    font-family: 'SF Mono', Monaco, monospace;
  }
</style>
