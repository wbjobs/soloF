#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';
import { table } from 'table';
import http from 'http';

const API_BASE = 'http://localhost:3001/api';

function request(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          }
        } catch (e) {
          reject(new Error(`Invalid response: ${body}`));
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours}h ${minutes}m ${secs}s`;
}

yargs(hideBin(process.argv))
  .command('list', 'List all active streams', async () => {
    try {
      const response = await request('GET', '/streams');
      const streams = response.data;

      if (streams.length === 0) {
        console.log(chalk.yellow('No active streams'));
        return;
      }

      const data = [
        [
          chalk.bold('ID'),
          chalk.bold('Uptime'),
          chalk.bold('1080p Bitrate'),
          chalk.bold('720p Bitrate'),
          chalk.bold('480p Bitrate'),
          chalk.bold('Dropped'),
          chalk.bold('Watermark'),
          chalk.bold('PiP')
        ]
      ];

      for (const stream of streams) {
        data.push([
          stream.id.substring(0, 8),
          formatUptime(stream.uptime),
          stream.bitrates['1080p'] ? `${stream.bitrates['1080p']} kb/s` : 'N/A',
          stream.bitrates['720p'] ? `${stream.bitrates['720p']} kb/s` : 'N/A',
          stream.bitrates['480p'] ? `${stream.bitrates['480p']} kb/s` : 'N/A',
          Object.values(stream.droppedFrames).reduce((a, b) => a + b, 0),
          stream.hasWatermark ? chalk.green('Yes') : chalk.gray('No'),
          stream.hasPiP ? chalk.green(`${stream.pipInputCount} inputs`) : chalk.gray('No')
        ]);
      }

      console.log(table(data));
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  })
  .command('stats <id>', 'Show detailed stats for a stream', async (argv) => {
    try {
      const response = await request('GET', `/streams/${argv.id}`);
      const stats = response.data;

      console.log('\n' + chalk.bold.blue('=== Stream Statistics ==='));
      console.log(chalk.bold('ID:'), argv.id);
      console.log(chalk.bold('Uptime:'), formatUptime(stats.uptime));
      console.log(chalk.bold('Bytes Received:'), `${(stats.bytesReceived / 1024 / 1024).toFixed(2)} MB`);
      console.log(chalk.bold('Audio Score:'), stats.audioScore);
      console.log(chalk.bold('Video Score:'), stats.videoScore);
      
      console.log('\n' + chalk.bold('Bitrates:'));
      for (const [profile, bitrate] of Object.entries(stats.bitrates)) {
        console.log(`  ${profile}: ${chalk.green(`${bitrate} kb/s`)}`);
      }

      console.log('\n' + chalk.bold('Frame Rates:'));
      for (const [profile, fps] of Object.entries(stats.frameRates)) {
        console.log(`  ${profile}: ${chalk.green(`${fps} fps`)}`);
      }

      console.log('\n' + chalk.bold('Dropped Frames:'));
      for (const [profile, dropped] of Object.entries(stats.droppedFrames)) {
        const color = dropped > 10 ? chalk.red : chalk.green;
        console.log(`  ${profile}: ${color(dropped)}`);
      }

      console.log('\n' + chalk.bold('Features:'));
      console.log(`  Watermark: ${stats.hasWatermark ? chalk.green('Enabled') : chalk.gray('Disabled')}`);
      console.log(`  PiP: ${stats.hasPiP ? chalk.green(`${stats.pipInputCount} inputs`) : chalk.gray('Disabled')}`);
      console.log('');
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  })
  .command('stop <id>', 'Stop a stream', async (argv) => {
    try {
      await request('DELETE', `/streams/${argv.id}`);
      console.log(chalk.green(`Stream ${argv.id} stopped successfully`));
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  })
  .command('watermark <id> [options]', 'Configure watermark for a stream', (yargs) => {
    return yargs
      .option('enable', { type: 'boolean', description: 'Enable watermark' })
      .option('disable', { type: 'boolean', description: 'Disable watermark' })
      .option('text', { type: 'string', description: 'Watermark text' })
      .option('font-size', { type: 'number', default: 24, description: 'Font size' })
      .option('color', { type: 'string', default: 'white', description: 'Font color' })
      .option('position', { type: 'string', default: 'bottom-right', description: 'Position' })
      .option('image', { type: 'string', description: 'Image path (for image watermark)' });
  }, async (argv) => {
    try {
      const config = {
        enabled: argv.enable || !argv.disable,
        type: argv.image ? 'image' : 'text',
        text: argv.text || 'Live Stream',
        fontSize: argv.fontSize,
        fontColor: argv.color,
        position: argv.position,
        imagePath: argv.image
      };

      await request('POST', `/streams/${argv.id}/watermark`, config);
      console.log(chalk.green(`Watermark updated for stream ${argv.id}`));
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  })
  .command('pip <id> [options]', 'Configure Picture-in-Picture for a stream', (yargs) => {
    return yargs
      .option('enable', { type: 'boolean', description: 'Enable PiP' })
      .option('disable', { type: 'boolean', description: 'Disable PiP' })
      .option('layout', { type: 'string', default: 'grid', description: 'Layout mode (grid/side-by-side)' });
  }, async (argv) => {
    try {
      const config = {
        enabled: argv.enable || !argv.disable,
        layout: argv.layout
      };

      await request('POST', `/streams/${argv.id}/pip`, config);
      console.log(chalk.green(`PiP configuration updated for stream ${argv.id}`));
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  })
  .command('health', 'Check API server health', async () => {
    try {
      const response = await request('GET', '/health');
      console.log(chalk.green('Server is healthy:'), response.message);
    } catch (error) {
      console.error(chalk.red('Server is unhealthy:'), error.message);
      process.exit(1);
    }
  })
  .demandCommand(1, chalk.red('Please specify a command'))
  .help()
  .argv;
