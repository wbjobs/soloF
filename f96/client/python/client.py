#!/usr/bin/env python3
import io
import json
import struct
import sys
from typing import Optional, Dict, Any, List, Iterator, Callable

import click
import requests
import pyarrow as pa
import pyarrow.ipc as ipc
import pyarrow.compute as pc


class ParquetQueryClient:
    def __init__(self, base_url: str, token: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.session = requests.Session()
        self.last_metrics = None

    def login(self, username: str, password: str) -> str:
        response = self.session.post(
            f"{self.base_url}/token",
            json={"username": username, "password": password}
        )
        response.raise_for_status()
        data = response.json()
        self.token = data["access_token"]
        return self.token

    def _get_headers(self) -> Dict[str, str]:
        if not self.token:
            raise ValueError("Not authenticated. Please login first.")
        return {"Authorization": f"Bearer {self.token}"}

    def list_tables(self) -> List[Dict[str, Any]]:
        response = self.session.get(
            f"{self.base_url}/tables",
            headers=self._get_headers()
        )
        response.raise_for_status()
        return response.json()["tables"]

    def get_columns(self, table: Optional[str] = None) -> List[str]:
        params = {"table": table} if table else {}
        response = self.session.get(
            f"{self.base_url}/columns",
            headers=self._get_headers(),
            params=params
        )
        response.raise_for_status()
        return response.json()["columns"]

    def _parse_header_metrics(self, header: Dict[str, Any]):
        if "metrics" in header:
            self.last_metrics = header["metrics"]

    def _stream_batches(self, response: requests.Response) -> Iterator[pa.RecordBatch]:
        buffer = b""
        total_rows = 0
        expected_rows = None

        for chunk in response.iter_content(chunk_size=8192):
            buffer += chunk
            
            while len(buffer) >= 8:
                header_len = struct.unpack(">I", buffer[:4])[0]
                if len(buffer) < 4 + header_len + 4:
                    break
                
                header_start = 4
                header = json.loads(buffer[header_start:header_start + header_len].decode("utf-8"))
                
                self._parse_header_metrics(header)
                
                data_len_start = header_start + header_len
                data_len = struct.unpack(">I", buffer[data_len_start:data_len_start + 4])[0]
                
                data_start = data_len_start + 4
                total_message_len = data_start + data_len
                
                if len(buffer) < total_message_len:
                    break
                
                arrow_data = buffer[data_start:data_start + data_len]
                buffer = buffer[total_message_len:]
                
                reader = ipc.open_stream(io.BytesIO(arrow_data))
                batch = reader.read_next_batch()
                
                total_rows += header["num_rows"]
                expected_rows = header["total_rows"]
                print(f"Received batch: {header['num_rows']} rows, "
                      f"total: {total_rows}/{expected_rows}", file=sys.stderr)
                
                yield batch

        print(f"Query complete. Total rows: {total_rows}", file=sys.stderr)
        if self.last_metrics:
            print(f"Metrics: {json.dumps(self.last_metrics, indent=2)}", file=sys.stderr)

    def query_stream(
        self,
        table: Optional[str] = None,
        columns: Optional[List[str]] = None,
        filters: Optional[Dict[str, Any]] = None,
        page_size: Optional[int] = None,
        method: str = "GET"
    ) -> Iterator[pa.RecordBatch]:
        headers = self._get_headers()

        if method.upper() == "GET":
            params = {}
            if table:
                params["table"] = table
            if columns:
                params["columns"] = ",".join(columns)
            if filters:
                params["filters"] = json.dumps(filters)
            if page_size:
                params["page_size"] = page_size

            response = self.session.get(
                f"{self.base_url}/DoGet",
                headers=headers,
                params=params,
                stream=True
            )
        else:
            body = {}
            if table:
                body["table"] = table
            if columns:
                body["columns"] = columns
            if filters:
                body["filters"] = filters
            if page_size:
                body["page_size"] = page_size

            response = self.session.post(
                f"{self.base_url}/DoGet",
                headers=headers,
                json=body,
                stream=True
            )

        response.raise_for_status()
        return self._stream_batches(response)

    def query_sql_stream(
        self,
        sql: str,
        page_size: Optional[int] = None
    ) -> Iterator[pa.RecordBatch]:
        headers = self._get_headers()
        body = {"sql": sql}
        if page_size:
            body["page_size"] = page_size

        response = self.session.post(
            f"{self.base_url}/DoQuery",
            headers=headers,
            json=body,
            stream=True
        )
        response.raise_for_status()
        return self._stream_batches(response)

    def query_to_pandas_stream(
        self,
        table: Optional[str] = None,
        columns: Optional[List[str]] = None,
        filters: Optional[Dict[str, Any]] = None,
        page_size: Optional[int] = None,
        method: str = "GET",
        sql: Optional[str] = None
    ) -> Iterator[Any]:
        if sql:
            batch_iter = self.query_sql_stream(sql, page_size)
        else:
            batch_iter = self.query_stream(table, columns, filters, page_size, method)
            
        for batch in batch_iter:
            df = batch.to_pandas(split_blocks=True, zero_copy_only=True)
            yield df
            del df

    def query(
        self,
        table: Optional[str] = None,
        columns: Optional[List[str]] = None,
        filters: Optional[Dict[str, Any]] = None,
        page_size: Optional[int] = None,
        method: str = "GET",
        sql: Optional[str] = None
    ) -> pa.Table:
        if sql:
            batches = list(self.query_sql_stream(sql, page_size))
        else:
            batches = list(self.query_stream(table, columns, filters, page_size, method))
        if batches:
            return pa.Table.from_batches(batches)
        return pa.Table.from_batches([])

    def query_to_pandas(
        self,
        table: Optional[str] = None,
        columns: Optional[List[str]] = None,
        filters: Optional[Dict[str, Any]] = None,
        page_size: Optional[int] = None,
        method: str = "GET",
        sql: Optional[str] = None
    ) -> Any:
        import pandas as pd
        dfs = list(self.query_to_pandas_stream(table, columns, filters, page_size, method, sql))
        if dfs:
            return pd.concat(dfs, ignore_index=True)
        return pd.DataFrame()


@click.group()
@click.option("--url", default="http://localhost:8000", help="Service base URL")
@click.option("--token", help="JWT authentication token")
@click.pass_context
def cli(ctx, url: str, token: Optional[str]):
    """Parquet Query Service CLI Client"""
    ctx.ensure_object(dict)
    ctx.obj["client"] = ParquetQueryClient(url, token)


@cli.command()
@click.option("--username", "-u", required=True, help="Username")
@click.option("--password", "-p", required=True, help="Password")
@click.pass_context
def login(ctx, username: str, password: str):
    """Login and get authentication token"""
    client = ctx.obj["client"]
    token = client.login(username, password)
    click.echo(f"Token: {token}")
    return token


@cli.command(name="tables")
@click.pass_context
def list_tables_cmd(ctx):
    """List available tables and their columns"""
    client = ctx.obj["client"]
    tables = client.list_tables()
    for table_info in tables:
        click.echo(f"\nTable: {table_info['name']}")
        click.echo(f"  Columns: {', '.join(table_info['columns'])}")


@cli.command(name="columns")
@click.option("--table", "-t", help="Table name")
@click.pass_context
def list_columns(ctx, table: Optional[str]):
    """List columns for a table"""
    client = ctx.obj["client"]
    columns = client.get_columns(table)
    click.echo(f"Columns ({table or 'default'}):")
    for col in columns:
        click.echo(f"  - {col}")


@cli.command()
@click.option("--table", "-t", help="Table name")
@click.option("--columns", "-c", help="Comma-separated columns to select")
@click.option("--filter", "-f", "filters", multiple=True,
              help="Filter in format 'column=value' or 'column>value' etc.")
@click.option("--page-size", "-p", type=int, help="Rows per page (default: 10000)")
@click.option("--method", type=click.Choice(["GET", "POST"]), default="GET")
@click.option("--output", "-o", help="Output file (Parquet format, streaming write)")
@click.option("--output-csv", help="Output file (CSV format, streaming write)")
@click.option("--limit", type=int, help="Limit output rows displayed")
@click.option("--stream/--no-stream", default=False,
              help="Stream output to console (for large result sets)")
@click.pass_context
def query(ctx, table, columns, filters, page_size, method, output, output_csv, limit, stream):
    """Execute a query and return Arrow Table
    
    For large result sets, use --stream to avoid loading entire table into memory.
    Use --output or --output-csv for streaming writes to disk.
    """
    client = ctx.obj["client"]

    col_list = columns.split(",") if columns else None

    def _parse_value(val: str):
        try:
            if "." in val or "e" in val.lower():
                return float(val)
            return int(val)
        except ValueError:
            if val.lower() == "true":
                return True
            elif val.lower() == "false":
                return False
            return val.strip('"\'')

    filter_dict = {}
    for f in filters:
        if "=" in f and not any(op in f for op in [">=", "<=", "!=", ">", "<"]):
            col, val = f.split("=", 1)
            filter_dict[col] = _parse_value(val)
        elif ">=" in f:
            col, val = f.split(">=", 1)
            filter_dict[col] = {">=": _parse_value(val)}
        elif "<=" in f:
            col, val = f.split("<=", 1)
            filter_dict[col] = {"<=": _parse_value(val)}
        elif "!=" in f:
            col, val = f.split("!=", 1)
            filter_dict[col] = {"!=": _parse_value(val)}
        elif ">" in f:
            col, val = f.split(">", 1)
            filter_dict[col] = {">": _parse_value(val)}
        elif "<" in f:
            col, val = f.split("<", 1)
            filter_dict[col] = {"<": _parse_value(val)}

    actual_filters = filter_dict if filter_dict else None

    if output or output_csv or stream:
        import pyarrow.parquet as pq
        writer = None
        first_batch = True
        schema = None
        total_displayed = 0

        for i, df in enumerate(client.query_to_pandas_stream(
            table=table,
            columns=col_list,
            filters=actual_filters,
            page_size=page_size,
            method=method
        )):
            if output:
                if writer is None:
                    table_pq = pa.Table.from_pandas(df, preserve_index=False)
                    schema = table_pq.schema
                    writer = pq.ParquetWriter(output, schema)
                table_pq = pa.Table.from_pandas(df, schema=schema, preserve_index=False)
                writer.write_table(table_pq)
                del table_pq

            if output_csv:
                mode = 'w' if first_batch else 'a'
                df.to_csv(output_csv, mode=mode, header=first_batch, index=False)

            if stream and (limit is None or total_displayed < limit):
                if first_batch:
                    click.echo("\nStreaming Arrow Table (Pandas DataFrame chunks):")
                display_limit = min(len(df), limit - total_displayed) if limit else len(df)
                click.echo(f"\n--- Chunk {i+1}: {len(df)} rows ---")
                click.echo(df.head(display_limit).to_string(index=False))
                total_displayed += display_limit

            first_batch = False
            del df

        if writer:
            writer.close()
            click.echo(f"\nTable written to {output}")
        if output_csv:
            click.echo(f"\nCSV written to {output_csv}")

    else:
        table_result = client.query(
            table=table,
            columns=col_list,
            filters=actual_filters,
            page_size=page_size,
            method=method
        )

        display_table = table_result.slice(0, limit) if limit else table_result
        click.echo("\nArrow Table:")
        click.echo(display_table.to_pandas(split_blocks=True, zero_copy_only=True).to_string(index=False))


@cli.command(name="sql")
@click.argument("sql_query")
@click.option("--page-size", "-p", type=int, help="Rows per page (default: 10000)")
@click.option("--output", "-o", help="Output file (Parquet format)")
@click.option("--output-csv", help="Output file (CSV format)")
@click.option("--limit", type=int, help="Limit output rows displayed")
@click.option("--stream/--no-stream", default=False, help="Stream output")
@click.pass_context
def sql_query(ctx, sql_query, page_size, output, output_csv, limit, stream):
    """Execute a SQL-like query
    
    Supports: SELECT columns FROM table [WHERE conditions] [JOIN table2 ON key=key]
    
    Examples:
      SELECT temp, humidity FROM sensor_data WHERE sensor_id=5
      SELECT s.temp, s.humidity, m.calibration 
      FROM sensor_data s JOIN sensor_meta m ON s.sensor_id=m.id
      WHERE s.sensor_id=5
    """
    client = ctx.obj["client"]
    
    click.echo(f"Executing SQL: {sql_query}")

    if output or output_csv or stream:
        import pyarrow.parquet as pq
        writer = None
        first_batch = True
        schema = None
        total_displayed = 0

        for i, df in enumerate(client.query_to_pandas_stream(
            sql=sql_query,
            page_size=page_size
        )):
            if output:
                if writer is None:
                    table_pq = pa.Table.from_pandas(df, preserve_index=False)
                    schema = table_pq.schema
                    writer = pq.ParquetWriter(output, schema)
                table_pq = pa.Table.from_pandas(df, schema=schema, preserve_index=False)
                writer.write_table(table_pq)
                del table_pq

            if output_csv:
                mode = 'w' if first_batch else 'a'
                df.to_csv(output_csv, mode=mode, header=first_batch, index=False)

            if stream and (limit is None or total_displayed < limit):
                if first_batch:
                    click.echo("\nQuery Results (Pandas DataFrame chunks):")
                display_limit = min(len(df), limit - total_displayed) if limit else len(df)
                click.echo(f"\n--- Chunk {i+1}: {len(df)} rows ---")
                click.echo(df.head(display_limit).to_string(index=False))
                total_displayed += display_limit

            first_batch = False
            del df

        if writer:
            writer.close()
            click.echo(f"\nTable written to {output}")
        if output_csv:
            click.echo(f"\nCSV written to {output_csv}")
    else:
        table_result = client.query(sql=sql_query, page_size=page_size)
        display_table = table_result.slice(0, limit) if limit else table_result
        click.echo("\nArrow Table:")
        click.echo(display_table.to_pandas(split_blocks=True).to_string(index=False))


if __name__ == "__main__":
    cli(obj={})
