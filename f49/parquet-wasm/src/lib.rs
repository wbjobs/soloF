use wasm_bindgen::prelude::*;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use parquet::file::reader::{FileReader, SerializedFileReader};
use arrow::array::*;
use arrow::datatypes::{DataType, Field};
use std::io::{Cursor, Seek, Read};
use serde::{Serialize, Deserialize};
use serde_json::{Value, json};

#[derive(Serialize, Deserialize, Clone)]
pub struct ColumnStats {
    pub column_name: String,
    pub null_count: Option<i64>,
    pub distinct_count: Option<i64>,
    pub max_value: Option<String>,
    pub min_value: Option<String>,
    pub data_type: String,
}

#[derive(Serialize, Deserialize)]
pub struct ParquetData {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub row_count: usize,
    pub column_count: usize,
    pub warnings: Vec<String>,
    pub column_stats: Vec<ColumnStats>,
}

#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

fn flatten_struct(
    array: &Arc<dyn Array>,
    parent_path: &str,
    row_idx: usize,
) -> Vec<(String, Value)> {
    let mut result = Vec::new();
    
    if let Some(struct_array) = array.as_any().downcast_ref::<StructArray>() {
        for (field_idx, field) in struct_array.fields().iter().enumerate() {
            let field_array = struct_array.column(field_idx);
            let field_name = if parent_path.is_empty() {
                field.name().clone()
            } else {
                format!("{}.{}", parent_path, field.name())
            };
            
            if field_array.is_valid(row_idx) {
                let values = extract_value(field_array, &field_name, row_idx);
                result.extend(values);
            } else {
                match field.data_type() {
                    DataType::Struct(_) => {
                        result.push((field_name.clone(), Value::Null));
                    }
                    DataType::List(_) | DataType::LargeList(_) => {
                        result.push((field_name.clone(), Value::Null));
                    }
                    _ => {
                        result.push((field_name, Value::Null));
                    }
                }
            }
        }
    }
    
    result
}

fn extract_list_value(
    array: &Arc<dyn Array>,
    field_name: &str,
    row_idx: usize,
) -> Vec<(String, Value)> {
    let mut result = Vec::new();
    
    if let Some(list_array) = array.as_any().downcast_ref::<ListArray>() {
        if list_array.is_valid(row_idx) {
            let offsets = list_array.value_offsets();
            let start = offsets[row_idx] as usize;
            let end = offsets[row_idx + 1] as usize;
            let values = list_array.values();
            
            let mut json_array = Vec::new();
            for i in start..end {
                let sub_values = extract_value(values, "", i);
                if !sub_values.is_empty() {
                    if sub_values.len() == 1 {
                        json_array.push(sub_values[0].1.clone());
                    } else {
                        let obj: serde_json::Map<String, Value> = sub_values
                            .into_iter()
                            .map(|(k, v)| (k, v))
                            .collect();
                        json_array.push(Value::Object(obj));
                    }
                }
            }
            result.push((field_name.to_string(), Value::Array(json_array)));
        } else {
            result.push((field_name.to_string(), Value::Null));
        }
    } else if let Some(large_list_array) = array.as_any().downcast_ref::<LargeListArray>() {
        if large_list_array.is_valid(row_idx) {
            let offsets = large_list_array.value_offsets();
            let start = offsets[row_idx] as usize;
            let end = offsets[row_idx + 1] as usize;
            let values = large_list_array.values();
            
            let mut json_array = Vec::new();
            for i in start..end {
                let sub_values = extract_value(values, "", i);
                if !sub_values.is_empty() {
                    if sub_values.len() == 1 {
                        json_array.push(sub_values[0].1.clone());
                    } else {
                        let obj: serde_json::Map<String, Value> = sub_values
                            .into_iter()
                            .map(|(k, v)| (k, v))
                            .collect();
                        json_array.push(Value::Object(obj));
                    }
                }
            }
            result.push((field_name.to_string(), Value::Array(json_array)));
        } else {
            result.push((field_name.to_string(), Value::Null));
        }
    }
    
    result
}

fn extract_primitive_value(
    array: &Arc<dyn Array>,
    field_name: &str,
    row_idx: usize,
) -> Option<(String, Value)> {
    let data_type = array.data_type();
    
    macro_rules! extract_primitive {
        ($array_type:ty, $cast_method:ident) => {{
            let arr = array.as_any().downcast_ref::<$array_type>().unwrap();
            if arr.is_valid(row_idx) {
                Some((field_name.to_string(), Value::from(arr.value(row_idx))))
            } else {
                Some((field_name.to_string(), Value::Null))
            }
        }};
    }
    
    macro_rules! extract_integer {
        ($array_type:ty, $cast_method:ident, $target_type:ty) => {{
            let arr = array.as_any().downcast_ref::<$array_type>().unwrap();
            if arr.is_valid(row_idx) {
                Some((field_name.to_string(), Value::from(arr.value(row_idx) as $target_type)))
            } else {
                Some((field_name.to_string(), Value::Null))
            }
        }};
    }
    
    match data_type {
        DataType::Int8 => extract_integer!(Int8Array, value, i64),
        DataType::Int16 => extract_integer!(Int16Array, value, i64),
        DataType::Int32 => extract_integer!(Int32Array, value, i64),
        DataType::Int64 => extract_primitive!(Int64Array, value),
        DataType::UInt8 => extract_integer!(UInt8Array, value, u64),
        DataType::UInt16 => extract_integer!(UInt16Array, value, u64),
        DataType::UInt32 => extract_integer!(UInt32Array, value, u64),
        DataType::UInt64 => extract_primitive!(UInt64Array, value),
        DataType::Float32 => extract_primitive!(Float32Array, value),
        DataType::Float64 => extract_primitive!(Float64Array, value),
        DataType::Utf8 => extract_primitive!(StringArray, value),
        DataType::LargeUtf8 => extract_primitive!(LargeStringArray, value),
        DataType::Boolean => extract_primitive!(BooleanArray, value),
        _ => None,
    }
}

fn extract_value(
    array: &Arc<dyn Array>,
    field_name: &str,
    row_idx: usize,
) -> Vec<(String, Value)> {
    let data_type = array.data_type();
    
    match data_type {
        DataType::Struct(_) => flatten_struct(array, field_name, row_idx),
        DataType::List(_) | DataType::LargeList(_) => extract_list_value(array, field_name, row_idx),
        _ => {
            if let Some(val) = extract_primitive_value(array, field_name, row_idx) {
                vec![val]
            } else {
                vec![(field_name.to_string(), json!(format!("<Unsupported: {:?}>", data_type)))]
            }
        }
    }
}

fn build_flat_columns(fields: &[Field], parent_path: &str) -> Vec<String> {
    let mut result = Vec::new();
    
    for field in fields {
        let field_name = if parent_path.is_empty() {
            field.name().clone()
        } else {
            format!("{}.{}", parent_path, field.name())
        };
        
        match field.data_type() {
            DataType::Struct(struct_fields) => {
                result.extend(build_flat_columns(struct_fields, &field_name));
            }
            DataType::List(item_field) | DataType::LargeList(item_field) => {
                match item_field.data_type() {
                    DataType::Struct(_) => {
                        result.push(field_name);
                    }
                    _ => {
                        result.push(field_name);
                    }
                }
            }
            _ => {
                result.push(field_name);
            }
        }
    }
    
    result
}

fn collect_warnings(fields: &[Field], parent_path: &str) -> Vec<String> {
    let mut warnings = Vec::new();
    
    for field in fields {
        let field_name = if parent_path.is_empty() {
            field.name().clone()
        } else {
            format!("{}.{}", parent_path, field.name())
        };
        
        match field.data_type() {
            DataType::Struct(_) => {
                warnings.push(format!("列 '{}' 是嵌套 Struct 类型，已扁平化处理", field_name));
                warnings.extend(collect_warnings(&[], &field_name));
            }
            DataType::List(item_field) | DataType::LargeList(item_field) => {
                warnings.push(format!("列 '{}' 是 List 类型，已转换为 JSON 数组格式", field_name));
                if let DataType::Struct(struct_fields) = item_field.data_type() {
                    warnings.extend(collect_warnings(struct_fields, &field_name));
                }
            }
            DataType::Map(_, _) => {
                warnings.push(format!("列 '{}' 是 Map 类型，暂不支持", field_name));
            }
            _ => {}
        }
    }
    
    warnings
}

fn extract_column_stats<T: Read + Seek>(cursor: T) -> Result<Vec<ColumnStats>, String> {
    let reader = SerializedFileReader::new(cursor)
        .map_err(|e| format!("Failed to create parquet reader: {}", e))?;
    
    let file_metadata = reader.metadata();
    let schema = file_metadata.file_metadata().schema_descr();
    let num_columns = schema.num_columns();
    
    let mut column_stats_list: Vec<ColumnStats> = Vec::new();
    
    for col_idx in 0..num_columns {
        let column_desc = schema.column(col_idx);
        let column_name = column_desc.name().to_string();
        let data_type = format!("{:?}", column_desc.physical_type());
        
        let mut total_null_count: Option<i64> = None;
        let mut total_distinct_count: Option<i64> = None;
        let mut global_min: Option<String> = None;
        let mut global_max: Option<String> = None;
        
        for row_group in file_metadata.row_groups() {
            if let Some(col_chunk) = row_group.column(col_idx) {
                if let Some(stats) = col_chunk.statistics() {
                    if let Some(null_count) = stats.null_count_opt() {
                        total_null_count = Some(total_null_count.unwrap_or(0) + null_count);
                    }
                    
                    if let Some(distinct_count) = stats.distinct_count_opt() {
                        total_distinct_count = Some(total_distinct_count.unwrap_or(0) + distinct_count);
                    }
                    
                    if let Some(min) = stats.min_opt() {
                        let min_str = format!("{:?}", min);
                        if global_min.is_none() || min_str < global_min.clone().unwrap() {
                            global_min = Some(min_str);
                        }
                    }
                    
                    if let Some(max) = stats.max_opt() {
                        let max_str = format!("{:?}", max);
                        if global_max.is_none() || max_str > global_max.clone().unwrap() {
                            global_max = Some(max_str);
                        }
                    }
                }
            }
        }
        
        column_stats_list.push(ColumnStats {
            column_name,
            null_count: total_null_count,
            distinct_count: total_distinct_count,
            max_value: global_max,
            min_value: global_min,
            data_type,
        });
    }
    
    Ok(column_stats_list)
}

#[wasm_bindgen]
pub fn parse_parquet(data: &[u8]) -> Result<String, JsValue> {
    let cursor = Cursor::new(data);
    let builder = ParquetRecordBatchReaderBuilder::try_new(cursor)
        .map_err(|e| JsValue::from_str(&format!("Failed to create reader: {}", e)))?;
    
    let schema = builder.schema().clone();
    let mut reader = builder.build()
        .map_err(|e| JsValue::from_str(&format!("Failed to build reader: {}", e)))?;
    
    let columns = build_flat_columns(schema.fields(), "");
    
    let mut warnings = collect_warnings(schema.fields(), "");
    warnings.dedup();
    
    let mut all_rows: Vec<Vec<Value>> = Vec::new();
    
    while let Some(Ok(batch)) = reader.next() {
        let num_rows = batch.num_rows();
        
        for row_idx in 0..num_rows {
            let mut row_values = Vec::new();
            
            for col_idx in 0..batch.num_columns() {
                let array = batch.column(col_idx);
                let field_name = schema.field(col_idx).name();
                
                let values = extract_value(array, field_name, row_idx);
                for (_, value) in values {
                    row_values.push(value);
                }
            }
            
            all_rows.push(row_values);
        }
    }
    
    let cursor_for_stats = Cursor::new(data);
    let column_stats = extract_column_stats(cursor_for_stats)
        .unwrap_or_else(|_| Vec::new());
    
    let result = ParquetData {
        columns: columns.clone(),
        rows: all_rows,
        row_count: all_rows.len(),
        column_count: columns.len(),
        warnings,
        column_stats,
    };
    
    serde_json::to_string(&result)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize: {}", e)))
}
