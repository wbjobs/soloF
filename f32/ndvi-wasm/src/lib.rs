use wasm_bindgen::prelude::*;
use std::sync::atomic::{AtomicBool, Ordering};

static CANCEL_FLAG: AtomicBool = AtomicBool::new(false);

#[wasm_bindgen]
pub fn calculate_ndvi(red: &[f32], nir: &[f32]) -> Vec<f32> {
    let len = red.len().min(nir.len());
    let mut ndvi = Vec::with_capacity(len);

    unsafe {
        ndvi.set_len(len);
    }

    let batch_size = 65536;

    for chunk_start in (0..len).step_by(batch_size) {
        if CANCEL_FLAG.load(Ordering::Relaxed) {
            break;
        }

        let chunk_end = (chunk_start + batch_size).min(len);

        for i in chunk_start..chunk_end {
            let r = red[i];
            let n = nir[i];
            let sum = r + n;

            ndvi[i] = if sum == 0.0 {
                0.0
            } else {
                (n - r) / sum
            };
        }
    }

    ndvi
}

#[wasm_bindgen]
pub fn calculate_ndvi_fast(red_ptr: *const f32, nir_ptr: *const f32, len: usize) -> *mut f32 {
    use std::alloc::{alloc, Layout};

    let layout = Layout::array::<f32>(len).unwrap();
    let result_ptr = unsafe { alloc(layout) } as *mut f32;

    if result_ptr.is_null() {
        return std::ptr::null_mut();
    }

    let batch_size = 65536;

    for chunk_start in (0..len).step_by(batch_size) {
        if CANCEL_FLAG.load(Ordering::Relaxed) {
            break;
        }

        let chunk_end = (chunk_start + batch_size).min(len);

        for i in chunk_start..chunk_end {
            unsafe {
                let r = *red_ptr.add(i);
                let n = *nir_ptr.add(i);
                let sum = r + n;

                *result_ptr.add(i) = if sum == 0.0 {
                    0.0
                } else {
                    (n - r) / sum
                };
            }
        }
    }

    result_ptr
}

#[wasm_bindgen]
pub fn free_ndvi_result(ptr: *mut f32, len: usize) {
    use std::alloc::{dealloc, Layout};

    if !ptr.is_null() {
        let layout = Layout::array::<f32>(len).unwrap();
        unsafe {
            dealloc(ptr as *mut u8, layout);
        }
    }
}

#[wasm_bindgen]
pub fn set_cancel_flag(cancel: bool) {
    CANCEL_FLAG.store(cancel, Ordering::Relaxed);
}

#[wasm_bindgen]
pub fn calculate_ndvi_parallel(red: &[f32], nir: &[f32]) -> Vec<f32> {
    calculate_ndvi(red, nir)
}
