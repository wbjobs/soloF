#!/usr/bin/env node
const axios = require('axios');
const { Command } = require('commander');
const arrow = require('apache-arrow');
const fs = require('fs');

class ParquetQueryClient {
    constructor(baseURL, token = null) {
        this.baseURL = baseURL.replace(/\/$/, '');
        this.token = token;
        this.client = axios.create({ baseURL: this.baseURL });
    }

    async login(username, password) {
        const response = await this.client.post('/token', { username, password });
        this.token = response.data.access_token;
        return this.token;
    }

    _getHeaders() {
        if (!this.token) {
            throw new Error('Not authenticated. Please login first.');
        }
        return { Authorization: `Bearer ${this.token}` };
    }

    async getColumns() {
        const response = await this.client.get('/columns', {
            headers: this._getHeaders()
        });
        return response.data.columns;
    }

    async _readStream(response) {
        const buffer = Buffer.from(response.data, 'binary');
        let offset = 0;
        const allBatches = [];
        let totalRows = 0;
        let expectedRows = 0;
        let schema = null;

        while (offset < buffer.length) {
            const headerLen = buffer.readUInt32BE(offset);
            offset += 4;

            const header = JSON.parse(buffer.slice(offset, offset + headerLen).toString('utf8'));
            offset += headerLen;

            const dataLen = buffer.readUInt32BE(offset);
            offset += 4;

            const arrowData = buffer.slice(offset, offset + dataLen);
            offset += dataLen;

            const table = arrow.tableFromIPC(arrowData);
            if (!schema) schema = table.schema;
            for (let i = 0; i < table.batches.length; i++) {
                allBatches.push(table.batches[i]);
            }

            totalRows += header.num_rows;
            expectedRows = header.total_rows;
            console.error(`Received batch: ${header.num_rows} rows, total: ${totalRows}/${expectedRows}`);
        }

        if (allBatches.length > 0 && schema) {
            const combined = new arrow.Table(schema, allBatches);
            console.error(`Query complete. Total rows: ${combined.numRows}`);
            return combined;
        }
        return arrow.tableFromArrays({});
    }

    async query(options) {
        const { columns, filters, pageSize, method = 'GET' } = options;
        const headers = this._getHeaders();

        let response;
        if (method.toUpperCase() === 'GET') {
            const params = {};
            if (columns) params.columns = columns.join(',');
            if (filters) params.filters = JSON.stringify(filters);
            if (pageSize) params.page_size = pageSize;

            response = await this.client.get('/DoGet', {
                headers,
                params,
                responseType: 'arraybuffer'
            });
        } else {
            const body = {};
            if (columns) body.columns = columns;
            if (filters) body.filters = filters;
            if (pageSize) body.page_size = pageSize;

            response = await this.client.post('/DoGet', body, {
                headers,
                responseType: 'arraybuffer'
            });
        }

        return this._readStream(response);
    }
}

function parseFilters(filterStrings) {
    const filters = {};
    for (const f of filterStrings) {
        if (f.includes('>=') && !f.includes('=') || f.includes('>=')) {
            const [col, val] = f.split('>=');
            filters[col] = { '>=': isNaN(val) ? val : Number(val) };
        } else if (f.includes('<=')) {
            const [col, val] = f.split('<=');
            filters[col] = { '<=': isNaN(val) ? val : Number(val) };
        } else if (f.includes('!=')) {
            const [col, val] = f.split('!=');
            filters[col] = { '!=': isNaN(val) ? val : Number(val) };
        } else if (f.includes('>')) {
            const [col, val] = f.split('>');
            filters[col] = { '>': isNaN(val) ? val : Number(val) };
        } else if (f.includes('<')) {
            const [col, val] = f.split('<');
            filters[col] = { '<': isNaN(val) ? val : Number(val) };
        } else if (f.includes('=')) {
            const [col, val] = f.split('=');
            filters[col] = isNaN(val) ? val : Number(val);
        }
    }
    return Object.keys(filters).length > 0 ? filters : null;
}

const program = new Command();

program
    .name('parquet-query')
    .description('Parquet Query Service CLI Client (Node.js)')
    .version('1.0.0')
    .option('--url <url>', 'Service base URL', 'http://localhost:8000')
    .option('--token <token>', 'JWT authentication token');

program
    .command('login')
    .requiredOption('-u, --username <username>', 'Username')
    .requiredOption('-p, --password <password>', 'Password')
    .action(async (options) => {
        const globalOpts = program.opts();
        const client = new ParquetQueryClient(globalOpts.url);
        try {
            const token = await client.login(options.username, options.password);
            console.log(`Token: ${token}`);
        } catch (error) {
            console.error('Login failed:', error.response?.data?.detail || error.message);
            process.exit(1);
        }
    });

program
    .command('columns')
    .action(async () => {
        const globalOpts = program.opts();
        if (!globalOpts.token) {
            console.error('Error: --token is required');
            process.exit(1);
        }
        const client = new ParquetQueryClient(globalOpts.url, globalOpts.token);
        try {
            const columns = await client.getColumns();
            columns.forEach(col => console.log(`  - ${col}`));
        } catch (error) {
            console.error('Error:', error.response?.data?.detail || error.message);
            process.exit(1);
        }
    });

program
    .command('query')
    .option('-c, --columns <columns>', 'Comma-separated columns to select')
    .option('-f, --filter <filter...>', 'Filter in format column=value or column>value')
    .option('-p, --page-size <number>', 'Rows per page', parseInt)
    .option('--method <method>', 'HTTP method (GET or POST)', 'GET')
    .option('-o, --output <file>', 'Output file (Arrow IPC format)')
    .option('--limit <number>', 'Limit output rows displayed', parseInt)
    .action(async (options) => {
        const globalOpts = program.opts();
        if (!globalOpts.token) {
            console.error('Error: --token is required');
            process.exit(1);
        }
        const client = new ParquetQueryClient(globalOpts.url, globalOpts.token);

        try {
            const colList = options.columns ? options.columns.split(',') : null;
            const filters = options.filter ? parseFilters(options.filter) : null;

            const table = await client.query({
                columns: colList,
                filters,
                pageSize: options.pageSize,
                method: options.method
            });

            if (options.output) {
                const writer = arrow.RecordBatchFileWriter.writeAll(table);
                fs.writeFileSync(options.output, writer.toUint8Array());
                console.log(`Table written to ${options.output}`);
            }

            const displayLimit = options.limit || 20;
            console.log('\nArrow Table (first ' + Math.min(displayLimit, table.numRows) + ' rows):');
            console.log(table.slice(0, displayLimit).toString());
        } catch (error) {
            console.error('Query failed:', error.response?.data?.detail || error.message);
            process.exit(1);
        }
    });

program.parseAsync(process.argv);
