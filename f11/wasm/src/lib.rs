use wasm_bindgen::prelude::*;
use nalgebra::{Matrix4, Vector4};
use serde::{Serialize, Deserialize};

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[derive(Serialize, Deserialize)]
pub struct MatrixResult {
    pub success: bool,
    pub data: Vec<f64>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct EigenResult {
    pub success: bool,
    pub eigenvalues: Vec<f64>,
    pub eigenvectors: Vec<Vec<f64>>,
    pub error: Option<String>,
}

#[wasm_bindgen]
pub fn matrix_multiply(a: &[f64], b: &[f64]) -> JsValue {
    if a.len() != 16 || b.len() != 16 {
        return JsValue::from_serde(&MatrixResult {
            success: false,
            data: vec![],
            error: Some("矩阵必须是4x4的".to_string()),
        }).unwrap();
    }

    let mat_a = Matrix4::from_row_slice(a);
    let mat_b = Matrix4::from_row_slice(b);
    let result = mat_a * mat_b;

    JsValue::from_serde(&MatrixResult {
        success: true,
        data: result.iter().cloned().collect(),
        error: None,
    }).unwrap()
}

#[wasm_bindgen]
pub fn matrix_inverse(matrix: &[f64]) -> JsValue {
    if matrix.len() != 16 {
        return JsValue::from_serde(&MatrixResult {
            success: false,
            data: vec![],
            error: Some("矩阵必须是4x4的".to_string()),
        }).unwrap();
    }

    let mat = Matrix4::from_row_slice(matrix);
    
    match mat.try_inverse() {
        Some(inv) => JsValue::from_serde(&MatrixResult {
            success: true,
            data: inv.iter().cloned().collect(),
            error: None,
        }).unwrap(),
        None => JsValue::from_serde(&MatrixResult {
            success: false,
            data: vec![],
            error: Some("矩阵不可逆".to_string()),
        }).unwrap(),
    }
}

#[wasm_bindgen]
pub fn matrix_eigen(matrix: &[f64]) -> JsValue {
    if matrix.len() != 16 {
        return JsValue::from_serde(&EigenResult {
            success: false,
            eigenvalues: vec![],
            eigenvectors: vec![],
            error: Some("矩阵必须是4x4的".to_string()),
        }).unwrap();
    }

    let mat = Matrix4::from_row_slice(matrix);
    
    let eigenvalues = mat.eigenvalues();
    
    match eigenvalues {
        Some(vals) => {
            let mut eigenvectors = Vec::new();
            
            for i in 0..4 {
                let eigenval = vals[i];
                let shifted = mat - Matrix4::from_diagonal_element(eigenval);
                let null_space = shifted.null_space(1e-10);
                
                if let Some(ns) = null_space {
                    let v: Vec<f64> = ns.iter().cloned().collect();
                    eigenvectors.push(v);
                }
            }

            JsValue::from_serde(&EigenResult {
                success: true,
                eigenvalues: vals.iter().cloned().collect(),
                eigenvectors,
                error: None,
            }).unwrap()
        },
        None => JsValue::from_serde(&EigenResult {
            success: false,
            eigenvalues: vec![],
            eigenvectors: vec![],
            error: Some("无法计算特征值".to_string()),
        }).unwrap(),
    }
}

#[wasm_bindgen]
pub fn identity_matrix() -> Vec<f64> {
    Matrix4::identity().iter().cloned().collect()
}

#[wasm_bindgen]
pub fn translation_matrix(x: f64, y: f64, z: f64) -> Vec<f64> {
    Matrix4::new_translation(&nalgebra::Vector3::new(x, y, z)).iter().cloned().collect()
}

#[wasm_bindgen]
pub fn rotation_matrix(angle: f64, axis_x: f64, axis_y: f64, axis_z: f64) -> Vec<f64> {
    let axis = nalgebra::Unit::new_normalize(nalgebra::Vector3::new(axis_x, axis_y, axis_z));
    Matrix4::from_axis_angle(&axis, angle).iter().cloned().collect()
}

#[wasm_bindgen]
pub fn scale_matrix(x: f64, y: f64, z: f64) -> Vec<f64> {
    Matrix4::new_nonuniform_scaling(&nalgebra::Vector3::new(x, y, z)).iter().cloned().collect()
}

#[wasm_bindgen]
pub fn transform_point(matrix: &[f64], x: f64, y: f64, z: f64) -> Vec<f64> {
    let mat = Matrix4::from_row_slice(matrix);
    let point = Vector4::new(x, y, z, 1.0);
    let result = mat * point;
    vec![result.x, result.y, result.z]
}
