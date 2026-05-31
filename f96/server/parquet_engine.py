import pyarrow.parquet as pq
import pyarrow as pa
import pyarrow.compute as pc
from typing import List, Dict, Any, Optional, Iterator, Tuple
from contextlib import contextmanager
import logging
import time
import tracemalloc
import os
import glob

logger = logging.getLogger(__name__)


class QueryMetrics:
    def __init__(self):
        self.start_time = time.time()
        self.scanned_rows = 0
        self.filtered_rows = 0
        self.result_rows = 0
        self.row_groups_scanned = 0
        self.row_groups_skipped = 0
        self.join_matches = 0
        self._peak_memory = 0
        self._memory_tracking = False

    def start_memory_tracking(self):
        tracemalloc.start()
        self._memory_tracking = True

    def get_elapsed_time(self) -> float:
        return time.time() - self.start_time

    def get_peak_memory(self) -> int:
        if self._memory_tracking:
            _, peak = tracemalloc.get_traced_memory()
            return peak
        return 0

    def stop_memory_tracking(self):
        if self._memory_tracking:
            tracemalloc.stop()
            self._memory_tracking = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "elapsed_time_ms": round(self.get_elapsed_time() * 1000, 2),
            "scanned_rows": self.scanned_rows,
            "filtered_rows": self.filtered_rows,
            "result_rows": self.result_rows,
            "row_groups_scanned": self.row_groups_scanned,
            "row_groups_skipped": self.row_groups_skipped,
            "join_matches": self.join_matches,
            "peak_memory_mb": round(self.get_peak_memory() / (1024 * 1024), 2)
        }


class ParquetFileHandler:
    def __init__(self, file_path: str):
        self.file_path = file_path
        self.parquet_file = None
        self.schema = None
        self.row_group_stats = {}
        self._load_metadata()

    def _load_metadata(self) -> None:
        logger.info(f"Loading Parquet metadata from {self.file_path}")
        self.parquet_file = pq.ParquetFile(self.file_path)
        self.schema = self.parquet_file.schema.to_arrow_schema()
        self._preload_row_group_stats()
        logger.info(f"Loaded metadata: {self.parquet_file.num_row_groups} row groups, "
                   f"{self.parquet_file.metadata.num_rows} total rows, "
                   f"{len(self.schema)} columns")

    def _preload_row_group_stats(self) -> None:
        for rg_idx in range(self.parquet_file.num_row_groups):
            rg_meta = self.parquet_file.metadata.row_group(rg_idx)
            self.row_group_stats[rg_idx] = {
                'num_rows': rg_meta.num_rows,
                'columns': {}
            }
            for col_idx in range(rg_meta.num_columns):
                col_meta = rg_meta.column(col_idx)
                col_name = col_meta.path_in_schema
                stats = {
                    'has_min_max': col_meta.statistics is not None and col_meta.statistics.has_min_max,
                }
                if stats['has_min_max']:
                    stats['min'] = col_meta.statistics.min
                    stats['max'] = col_meta.statistics.max
                self.row_group_stats[rg_idx]['columns'][col_name] = stats

    def get_columns(self) -> List[str]:
        return [field.name for field in self.schema]

    def get_file_name(self) -> str:
        return os.path.splitext(os.path.basename(self.file_path))[0]


class ParquetQueryEngine:
    def __init__(self, parquet_paths: str | List[str]):
        self.file_handlers: Dict[str, ParquetFileHandler] = {}
        self._load_files(parquet_paths)

    def _load_files(self, parquet_paths: str | List[str]) -> None:
        paths = []
        
        if isinstance(parquet_paths, str):
            if os.path.isdir(parquet_paths):
                paths = glob.glob(os.path.join(parquet_paths, "*.parquet"))
            elif os.path.isfile(parquet_paths):
                paths = [parquet_paths]
            else:
                paths = glob.glob(parquet_paths)
        else:
            paths = parquet_paths

        for path in paths:
            if os.path.isfile(path):
                handler = ParquetFileHandler(path)
                self.file_handlers[handler.get_file_name()] = handler
                logger.info(f"Mounted table: {handler.get_file_name()} -> {path}")

    def list_tables(self) -> List[str]:
        return list(self.file_handlers.keys())

    def get_table_columns(self, table_name: str) -> List[str]:
        if table_name not in self.file_handlers:
            raise ValueError(f"Table '{table_name}' not found. Available: {self.list_tables()}")
        return self.file_handlers[table_name].get_columns()

    def _check_value_in_range(self, min_val: Any, max_val: Any, op: str, value: Any) -> bool:
        try:
            if op == "=":
                return min_val <= value <= max_val
            elif op == "!=":
                return True
            elif op == ">":
                return max_val > value
            elif op == ">=":
                return max_val >= value
            elif op == "<":
                return min_val < value
            elif op == "<=":
                return min_val <= value
        except (TypeError, ValueError):
            return True
        return True

    def _filter_row_groups_by_stats(self, handler: ParquetFileHandler, filters: Optional[Dict[str, Any]]) -> List[int]:
        if not filters:
            return list(range(handler.parquet_file.num_row_groups))

        selected_row_groups = []
        for rg_idx in range(handler.parquet_file.num_row_groups):
            rg_keep = True
            rg_stats = handler.row_group_stats[rg_idx]

            for column, condition in filters.items():
                if column not in rg_stats['columns']:
                    continue

                col_stats = rg_stats['columns'][column]
                if not col_stats['has_min_max']:
                    continue

                if isinstance(condition, dict):
                    for op, value in condition.items():
                        if not self._check_value_in_range(col_stats['min'], col_stats['max'], op, value):
                            rg_keep = False
                            break
                else:
                    if not self._check_value_in_range(col_stats['min'], col_stats['max'], "=", condition):
                        rg_keep = False
                        break

                if not rg_keep:
                    break

            if rg_keep:
                selected_row_groups.append(rg_idx)

        return selected_row_groups

    def _evaluate_filter_on_table(self, table: pa.Table, filters_dict: Dict[str, Any]) -> pa.ChunkedArray:
        mask = pa.chunked_array([pa.array([True] * table.num_rows, type=pa.bool_())])

        for column, condition in filters_dict.items():
            if column not in table.column_names:
                continue

            col_data = table.column(column)

            if isinstance(condition, dict):
                for op, value in condition.items():
                    if op == "=":
                        col_mask = pc.equal(col_data, value)
                    elif op == "!=":
                        col_mask = pc.not_equal(col_data, value)
                    elif op == ">":
                        col_mask = pc.greater(col_data, value)
                    elif op == ">=":
                        col_mask = pc.greater_equal(col_data, value)
                    elif op == "<":
                        col_mask = pc.less(col_data, value)
                    elif op == "<=":
                        col_mask = pc.less_equal(col_data, value)
                    else:
                        continue
                    mask = pc.and_(mask, col_mask)
            else:
                col_mask = pc.equal(col_data, condition)
                mask = pc.and_(mask, col_mask)

        return mask

    @contextmanager
    def scan_table(
        self,
        table_name: str,
        columns: Optional[List[str]] = None,
        filters: Optional[Dict[str, Any]] = None,
        page_size: int = 10000,
        metrics: Optional[QueryMetrics] = None
    ) -> Iterator[Iterator[pa.RecordBatch]]:
        if table_name not in self.file_handlers:
            raise ValueError(f"Table '{table_name}' not found. Available: {self.list_tables()}")

        handler = self.file_handlers[table_name]

        if columns:
            available = handler.get_columns()
            invalid = [col for col in columns if col not in available]
            if invalid:
                raise ValueError(f"Invalid columns in '{table_name}': {invalid}. Available: {available}")

        selected_row_groups = self._filter_row_groups_by_stats(handler, filters)
        total_row_groups = handler.parquet_file.num_row_groups
        
        if metrics:
            metrics.row_groups_scanned = len(selected_row_groups)
            metrics.row_groups_skipped = total_row_groups - len(selected_row_groups)

        logger.info(f"Scanning table '{table_name}': {len(selected_row_groups)}/{total_row_groups} row groups")

        try:
            def batch_iterator():
                for rg_idx in selected_row_groups:
                    rg_table = handler.parquet_file.read_row_group(
                        rg_idx,
                        columns=columns,
                        use_threads=True
                    )

                    if metrics:
                        metrics.scanned_rows += rg_table.num_rows

                    if filters is not None:
                        mask = self._evaluate_filter_on_table(rg_table, filters)
                        rg_table = rg_table.filter(mask)

                    if metrics:
                        metrics.filtered_rows += rg_table.num_rows

                    if rg_table.num_rows == 0:
                        del rg_table
                        continue

                    for batch in rg_table.to_batches(max_chunksize=page_size):
                        if batch.num_rows > 0:
                            yield batch

                    del rg_table

            yield batch_iterator()
        except Exception as e:
            logger.error(f"Scan failed for table '{table_name}': {e}")
            raise

    def hash_join_tables(
        self,
        left_table: str,
        right_table: str,
        left_key: str,
        right_key: str,
        left_columns: Optional[List[str]] = None,
        right_columns: Optional[List[str]] = None,
        filters: Optional[Dict[str, Any]] = None,
        right_filters: Optional[Dict[str, Any]] = None,
        page_size: int = 10000,
        metrics: Optional[QueryMetrics] = None
    ) -> Iterator[pa.RecordBatch]:
        left_handler = self.file_handlers[left_table]
        right_handler = self.file_handlers[right_table]

        left_cols = left_columns if left_columns else left_handler.get_columns()
        right_cols = right_columns if right_columns else right_handler.get_columns()

        if left_key not in left_cols:
            left_cols = [left_key] + left_cols
        if right_key not in right_cols:
            right_cols = [right_key] + right_cols

        right_cols_no_key = [c for c in right_cols if c != right_key]

        left_filters = filters if filters else {}
        actual_right_filters = right_filters if right_filters else {}

        logger.info(f"Building hash table for right table '{right_table}' on '{right_key}'")
        
        hash_table = {}
        right_batches_data = {}
        
        with self.scan_table(right_table, right_cols, actual_right_filters, page_size, metrics) as right_iter:
            for batch_idx, batch in enumerate(right_iter):
                key_arr = batch.column(right_key)
                right_batches_data[batch_idx] = batch
                for i in range(batch.num_rows):
                    key_val = key_arr[i].as_py()
                    if key_val not in hash_table:
                        hash_table[key_val] = []
                    hash_table[key_val].append((batch_idx, i))

        logger.info(f"Hash table built with {len(hash_table)} unique keys")

        with self.scan_table(left_table, left_cols, left_filters, page_size, metrics) as left_iter:
            for left_batch in left_iter:
                left_key_arr = left_batch.column(left_key)
                
                matched_rows = []
                
                for i in range(left_batch.num_rows):
                    key_val = left_key_arr[i].as_py()
                    if key_val in hash_table:
                        for batch_idx, right_idx in hash_table[key_val]:
                            matched_rows.append((i, batch_idx, right_idx))

                if metrics:
                    metrics.join_matches += len(matched_rows)

                if not matched_rows:
                    continue

                left_indices = [r[0] for r in matched_rows]
                left_result = left_batch.take(pa.array(left_indices, type=pa.int64()))
                
                result_arrays = []
                result_fields = []
                
                for field_idx in range(len(left_result.schema)):
                    field = left_result.schema.field(field_idx)
                    result_fields.append(pa.field(f"{left_table}.{field.name}", field.type))
                    result_arrays.append(left_result.column(field_idx))

                for col_name in right_cols_no_key:
                    right_values = []
                    for left_idx, batch_idx, right_idx in matched_rows:
                        right_batch = right_batches_data[batch_idx]
                        col_idx = right_batch.schema.get_field_index(col_name)
                        if col_idx >= 0:
                            right_values.append(right_batch.column(col_idx)[right_idx].as_py())
                        else:
                            right_values.append(None)
                    
                    result_fields.append(pa.field(f"{right_table}.{col_name}", pa.string()))
                    result_arrays.append(pa.array(right_values, type=pa.string()))

                schema = pa.schema(result_fields)
                result_batch = pa.record_batch(result_arrays, schema=schema)
                metrics.result_rows += result_batch.num_rows
                yield result_batch

    @staticmethod
    def _parse_value(val: str) -> Any:
        val = val.strip().strip("'").strip('"')
        try:
            return int(val)
        except ValueError:
            pass
        try:
            return float(val)
        except ValueError:
            pass
        if val.lower() == 'true':
            return True
        elif val.lower() == 'false':
            return False
        return val

    @staticmethod
    def _strip_table_prefix(col_name: str) -> str:
        if '.' in col_name:
            return col_name.split('.')[-1].strip()
        return col_name.strip()

    def parse_simple_sql(self, sql: str) -> Dict[str, Any]:
        sql = sql.strip().rstrip(';').strip()
        
        select_match = sql.split('SELECT')[1].split('FROM')[0].strip() if 'SELECT' in sql.upper() else '*'
        from_match = sql.split('FROM')[1].split('WHERE')[0].split('JOIN')[0].strip() if 'FROM' in sql.upper() else ''
        
        columns = []
        left_columns = []
        right_columns = []
        if select_match != '*':
            for c in select_match.split(','):
                c = c.strip()
                columns.append(c)
                if '.' in c:
                    table_prefix = c.split('.')[0].strip()
                    col_name = c.split('.')[-1].strip()
                    if table_prefix == from_match:
                        left_columns.append(col_name)
                    else:
                        right_columns.append(col_name)
                else:
                    left_columns.append(c)

        tables = [from_match]
        join_table = None
        join_on = None
        left_key = None
        right_key = None
        
        if 'JOIN' in sql.upper():
            join_part = sql.split('JOIN')[1]
            join_table = join_part.split('ON')[0].strip()
            join_on = join_part.split('ON')[1].split('WHERE')[0].strip()
            tables.append(join_table)
            
            if '=' in join_on:
                left_part, right_part = join_on.split('=', 1)
                left_key = self._strip_table_prefix(left_part)
                right_key = self._strip_table_prefix(right_part)

        filters = {}
        left_filters = {}
        right_filters = {}
        if 'WHERE' in sql.upper():
            where_part = sql.split('WHERE')[1]
            conditions = where_part.split('AND')
            for cond in conditions:
                cond = cond.strip()
                col = None
                val = None
                op = '='
                
                if '>=' in cond:
                    col, val = cond.split('>=', 1)
                    op = '>='
                elif '<=' in cond:
                    col, val = cond.split('<=', 1)
                    op = '<='
                elif '!=' in cond:
                    col, val = cond.split('!=', 1)
                    op = '!='
                elif '>' in cond:
                    col, val = cond.split('>', 1)
                    op = '>'
                elif '<' in cond:
                    col, val = cond.split('<', 1)
                    op = '<'
                elif '=' in cond:
                    col, val = cond.split('=', 1)
                    op = '='
                
                if col and val:
                    col = col.strip()
                    val = self._parse_value(val)
                    col_no_prefix = self._strip_table_prefix(col)
                    
                    if op == '=':
                        filters[col_no_prefix] = val
                    else:
                        filters[col_no_prefix] = {op: val}
                    
                    if join_table:
                        if '.' in col:
                            table_prefix = col.split('.')[0].strip()
                            if table_prefix == from_match:
                                left_filters[col_no_prefix] = filters[col_no_prefix]
                            elif table_prefix == join_table:
                                right_filters[col_no_prefix] = filters[col_no_prefix]
                        else:
                            left_filters[col_no_prefix] = filters[col_no_prefix]

        result = {
            'columns': columns if columns else None,
            'left_columns': left_columns if left_columns else None,
            'right_columns': right_columns if right_columns else None,
            'tables': tables,
            'filters': filters if filters else None,
            'left_filters': left_filters if left_filters else None,
            'right_filters': right_filters if right_filters else None,
            'join_table': join_table,
            'join_on': join_on,
            'left_key': left_key,
            'right_key': right_key
        }
        
        return result

    def get_total_rows_for_table(
        self,
        table_name: str,
        filters: Optional[Dict[str, Any]] = None
    ) -> int:
        if table_name not in self.file_handlers:
            raise ValueError(f"Table '{table_name}' not found")

        handler = self.file_handlers[table_name]
        count_col = handler.get_columns()[0]
        selected_row_groups = self._filter_row_groups_by_stats(handler, filters)

        total = 0
        for rg_idx in selected_row_groups:
            rg_table = handler.parquet_file.read_row_group(
                rg_idx,
                columns=[count_col],
                use_threads=True
            )

            if filters is not None:
                mask = self._evaluate_filter_on_table(rg_table, filters)
                total += pc.sum(mask).as_py()
            else:
                total += rg_table.num_rows

            del rg_table

        return total