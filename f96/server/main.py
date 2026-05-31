import io
import json
import logging
from typing import List, Optional, Dict, Any
from datetime import timedelta

import pyarrow as pa
import pyarrow.ipc as ipc
from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import settings
from auth import create_access_token, verify_token
from parquet_engine import ParquetQueryEngine, QueryMetrics

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Parquet Query Service", version="2.0.0")

query_engine: Optional[ParquetQueryEngine] = None

class TokenRequest(BaseModel):
    username: str
    password: str

class QueryRequest(BaseModel):
    columns: Optional[List[str]] = None
    filters: Optional[Dict[str, Any]] = None
    page_size: Optional[int] = None
    table: Optional[str] = None

class SQLQueryRequest(BaseModel):
    sql: str
    page_size: Optional[int] = None

@app.on_event("startup")
async def startup_event():
    global query_engine
    try:
        parquet_path = settings.parquet_file_path
        logger.info(f"Loading Parquet files from: {parquet_path}")
        query_engine = ParquetQueryEngine(parquet_path)
        tables = query_engine.list_tables()
        logger.info(f"Loaded {len(tables)} tables: {tables}")
    except Exception as e:
        logger.error(f"Failed to load Parquet files: {e}")
        raise

@app.post("/token")
async def login(request: TokenRequest):
    if request.username == "admin" and request.password == "password":
        access_token = create_access_token(
            data={"sub": request.username},
            expires_delta=timedelta(minutes=settings.jwt_expire_minutes)
        )
        return {"access_token": access_token, "token_type": "bearer"}
    raise HTTPException(status_code=401, detail="Invalid username or password")

@app.get("/tables")
async def list_tables(payload: dict = Depends(verify_token)):
    tables = query_engine.list_tables()
    result = []
    for table_name in tables:
        result.append({
            "name": table_name,
            "columns": query_engine.get_table_columns(table_name)
        })
    return {"tables": result}

@app.get("/columns")
async def get_columns(
    table: Optional[str] = Query(None, description="Table name"),
    payload: dict = Depends(verify_token)
):
    if table:
        return {"columns": query_engine.get_table_columns(table)}
    tables = query_engine.list_tables()
    if tables:
        return {"columns": query_engine.get_table_columns(tables[0])}
    return {"columns": []}

def _serialize_batch(batch: pa.RecordBatch) -> bytes:
    sink = io.BytesIO()
    writer = ipc.new_stream(sink, batch.schema)
    writer.write_batch(batch)
    writer.close()
    return sink.getvalue()

def _create_header(batch: pa.RecordBatch, total_rows: int, page_size: int, 
                   first_batch: bool, metrics: Optional[QueryMetrics] = None) -> bytes:
    schema_fields = []
    for field in batch.schema:
        schema_fields.append({
            "name": field.name,
            "type": str(field.type),
            "nullable": field.nullable
        })
    header_dict = {
        "first": first_batch,
        "schema": schema_fields,
        "num_rows": batch.num_rows,
        "total_rows": total_rows,
        "page_size": page_size
    }
    if metrics:
        header_dict["metrics"] = metrics.to_dict()
    return json.dumps(header_dict).encode("utf-8")

def _stream_response(batch_iter, total_rows: int, page_size: int, 
                     metrics: Optional[QueryMetrics] = None) -> StreamingResponse:
    def generate():
        first_batch = True
        for batch in batch_iter:
            data = _serialize_batch(batch)
            header = _create_header(batch, total_rows, page_size, first_batch, metrics)
            header_len = len(header).to_bytes(4, "big")
            data_len = len(data).to_bytes(4, "big")
            yield header_len + header + data_len + data
            first_batch = False

    return StreamingResponse(
        generate(),
        media_type="application/vnd.apache.arrow.stream",
        headers={
            "X-Total-Rows": str(total_rows),
            "X-Page-Size": str(page_size)
        }
    )

@app.get("/DoGet")
async def do_get(
    table: Optional[str] = Query(None, description="Table name"),
    columns: Optional[str] = Query(None, description="Comma-separated list of columns"),
    filters: Optional[str] = Query(None, description="JSON string of filter conditions"),
    page_size: Optional[int] = Query(None, description="Number of rows per page"),
    payload: dict = Depends(verify_token)
):
    try:
        parsed_columns = columns.split(",") if columns else None
        parsed_filters = json.loads(filters) if filters else None
        actual_page_size = page_size if page_size else settings.page_size
        
        tables = query_engine.list_tables()
        target_table = table if table else (tables[0] if tables else None)
        
        if not target_table:
            raise HTTPException(status_code=400, detail="No tables available")

        metrics = QueryMetrics()
        metrics.start_memory_tracking()

        total_rows = query_engine.get_total_rows_for_table(target_table, parsed_filters)
        
        with query_engine.scan_table(
            target_table,
            columns=parsed_columns,
            filters=parsed_filters,
            page_size=actual_page_size,
            metrics=metrics
        ) as batch_iter:
            batches = list(batch_iter)
            metrics.result_rows = sum(b.num_rows for b in batches)
        
        metrics.stop_memory_tracking()
        
        logger.info(f"Query metrics: {metrics.to_dict()}")
        
        return _stream_response(iter(batches), total_rows, actual_page_size, metrics)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Query error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/DoGet")
async def do_get_post(
    request: QueryRequest,
    payload: dict = Depends(verify_token)
):
    tables = query_engine.list_tables()
    target_table = request.table if request.table else (tables[0] if tables else None)
    
    return await do_get(
        table=target_table,
        columns=",".join(request.columns) if request.columns else None,
        filters=json.dumps(request.filters) if request.filters else None,
        page_size=request.page_size,
        payload=payload
    )

@app.post("/DoQuery")
async def do_query(
    request: SQLQueryRequest,
    payload: dict = Depends(verify_token)
):
    try:
        sql = request.sql
        actual_page_size = request.page_size if request.page_size else settings.page_size
        
        parsed = query_engine.parse_simple_sql(sql)
        
        tables = parsed.get("tables", [])
        columns = parsed.get("columns")
        filters = parsed.get("filters")
        join_table = parsed.get("join_table")
        join_on = parsed.get("join_on")

        if not tables:
            raise HTTPException(status_code=400, detail="No tables specified in query")

        metrics = QueryMetrics()
        metrics.start_memory_tracking()

        if join_table and join_on:
            left_key = parsed.get("left_key")
            right_key = parsed.get("right_key")
            left_table = tables[0]
            right_table = join_table
            left_cols = parsed.get("left_columns")
            right_cols = parsed.get("right_columns")
            left_filts = parsed.get("left_filters")
            right_filts = parsed.get("right_filters")

            logger.info(f"Executing JOIN: {left_table}({left_key}) JOIN {right_table}({right_key})")
            
            total_rows = 0
            batches = []
            
            for batch in query_engine.hash_join_tables(
                left_table=left_table,
                right_table=right_table,
                left_key=left_key,
                right_key=right_key,
                left_columns=left_cols,
                right_columns=right_cols,
                filters=left_filts,
                right_filters=right_filts,
                page_size=actual_page_size,
                metrics=metrics
            ):
                total_rows += batch.num_rows
                batches.append(batch)
            
            metrics.result_rows = total_rows
            metrics.stop_memory_tracking()
            
            logger.info(f"Query metrics: {metrics.to_dict()}")
            
            return _stream_response(iter(batches), total_rows, actual_page_size, metrics)
        else:
            target_table = tables[0]
            
            total_rows = query_engine.get_total_rows_for_table(target_table, filters)
            
            with query_engine.scan_table(
                target_table,
                columns=columns,
                filters=filters,
                page_size=actual_page_size,
                metrics=metrics
            ) as batch_iter:
                batches = list(batch_iter)
                metrics.result_rows = sum(b.num_rows for b in batches)
            
            metrics.stop_memory_tracking()
            
            logger.info(f"Query metrics: {metrics.to_dict()}")
            
            return _stream_response(iter(batches), total_rows, actual_page_size, metrics)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Query error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.server_host,
        port=settings.server_port,
        reload=False
    )
