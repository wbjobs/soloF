use wasm_bindgen::prelude::*;
use rustfft::{FftPlanner, num_complex::Complex};

#[wasm_bindgen]
pub struct ImageProcessor {
    width: usize,
    height: usize,
    original_fft: Vec<Vec<Complex<f64>>>,
    magnitude: Vec<Vec<f64>>,
}

#[wasm_bindgen]
impl ImageProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        ImageProcessor {
            width: 0,
            height: 0,
            original_fft: Vec::new(),
            magnitude: Vec::new(),
        }
    }

    #[wasm_bindgen]
    pub fn load_image(&mut self, image_data: &[u8], width: u32, height: u32) -> Result<(), JsValue> {
        let w = width as usize;
        let h = height as usize;
        self.width = w;
        self.height = h;

        let expected_len = w * h;
        if image_data.len() < expected_len {
            return Err(JsValue::from_str(&format!(
                "Image data too short: expected {} bytes, got {} bytes",
                expected_len,
                image_data.len()
            )));
        }

        let fft_size = w.max(h).next_power_of_two();
        let mut planner = FftPlanner::<f64>::new();
        let fft = planner.plan_fft_forward(fft_size);

        let mut padded = vec![vec![Complex::new(0.0, 0.0); fft_size]; fft_size];
        for y in 0..h {
            for x in 0..w {
                let idx = y * w + x;
                if idx < image_data.len() {
                    padded[y][x] = Complex::new(image_data[idx] as f64, 0.0);
                }
            }
        }

        for row in padded.iter_mut() {
            fft.process(row);
        }

        let mut transposed = vec![vec![Complex::new(0.0, 0.0); fft_size]; fft_size];
        for i in 0..fft_size {
            for j in 0..fft_size {
                transposed[j][i] = padded[i][j];
            }
        }

        for col in transposed.iter_mut() {
            fft.process(col);
        }

        let mut result = vec![vec![Complex::new(0.0, 0.0); fft_size]; fft_size];
        for i in 0..fft_size {
            for j in 0..fft_size {
                result[j][i] = transposed[i][j];
            }
        }

        self.original_fft = self.fft_shift(&result);
        self.magnitude = self.compute_magnitude(&self.original_fft);

        Ok(())
    }

    #[wasm_bindgen]
    pub fn apply_filter(&self, cutoff: f64, is_highpass: bool) -> Vec<u8> {
        if self.original_fft.is_empty() {
            return vec![0u8; self.width * self.height];
        }

        let fft_size = self.original_fft.len();
        let mut filtered = self.original_fft.clone();

        let center_x = fft_size as f64 / 2.0;
        let center_y = fft_size as f64 / 2.0;
        let cutoff_radius = cutoff * fft_size as f64 / 2.0;

        for y in 0..fft_size {
            for x in 0..fft_size {
                let dx = x as f64 - center_x;
                let dy = y as f64 - center_y;
                let distance = (dx * dx + dy * dy).sqrt();

                let should_zero = if is_highpass {
                    distance < cutoff_radius
                } else {
                    distance > cutoff_radius
                };

                if should_zero {
                    filtered[y][x] = Complex::new(0.0, 0.0);
                }
            }
        }

        let reconstructed = self.inverse_fft(&self.ifft_shift(&filtered));
        self.complex_to_image(&reconstructed)
    }

    #[wasm_bindgen]
    pub fn get_magnitude_spectrum(&self) -> Vec<u8> {
        if self.magnitude.is_empty() {
            return Vec::new();
        }

        let fft_size = self.magnitude.len();
        let mut max_mag = 0.0;
        for row in &self.magnitude {
            for &mag in row {
                if mag > max_mag {
                    max_mag = mag;
                }
            }
        }

        let mut spectrum = vec![0u8; fft_size * fft_size];
        for y in 0..fft_size {
            for x in 0..fft_size {
                let log_mag = (1.0 + self.magnitude[y][x]).ln();
                let normalized = (log_mag / (1.0 + max_mag).ln() * 255.0) as u8;
                spectrum[y * fft_size + x] = normalized;
            }
        }
        spectrum
    }

    fn fft_shift(&self, data: &[Vec<Complex<f64>>]) -> Vec<Vec<Complex<f64>>> {
        let n = data.len();
        let half = n / 2;
        let mut shifted = vec![vec![Complex::new(0.0, 0.0); n]; n];

        for y in 0..n {
            for x in 0..n {
                let new_y = (y + half) % n;
                let new_x = (x + half) % n;
                shifted[new_y][new_x] = data[y][x];
            }
        }
        shifted
    }

    fn ifft_shift(&self, data: &[Vec<Complex<f64>>]) -> Vec<Vec<Complex<f64>>> {
        let n = data.len();
        let half = n / 2;
        let mut shifted = vec![vec![Complex::new(0.0, 0.0); n]; n];

        for y in 0..n {
            for x in 0..n {
                let new_y = (y + half) % n;
                let new_x = (x + half) % n;
                shifted[y][x] = data[new_y][new_x];
            }
        }
        shifted
    }

    fn inverse_fft(&self, data: &[Vec<Complex<f64>>]) -> Vec<Vec<Complex<f64>>> {
        let fft_size = data.len();
        let mut planner = FftPlanner::<f64>::new();
        let ifft = planner.plan_fft_inverse(fft_size);

        let mut result = data.to_vec();

        for row in result.iter_mut() {
            ifft.process(row);
        }

        let mut transposed = vec![vec![Complex::new(0.0, 0.0); fft_size]; fft_size];
        for i in 0..fft_size {
            for j in 0..fft_size {
                transposed[j][i] = result[i][j];
            }
        }

        for col in transposed.iter_mut() {
            ifft.process(col);
        }

        let mut final_result = vec![vec![Complex::new(0.0, 0.0); fft_size]; fft_size];
        let norm = (fft_size * fft_size) as f64;
        for i in 0..fft_size {
            for j in 0..fft_size {
                final_result[j][i] = transposed[i][j] / norm;
            }
        }

        final_result
    }

    fn compute_magnitude(&self, fft_data: &[Vec<Complex<f64>>]) -> Vec<Vec<f64>> {
        let n = fft_data.len();
        let mut magnitude = vec![vec![0.0; n]; n];
        for y in 0..n {
            for x in 0..n {
                magnitude[y][x] = fft_data[y][x].norm();
            }
        }
        magnitude
    }

    fn complex_to_image(&self, data: &[Vec<Complex<f64>>]) -> Vec<u8> {
        let fft_size = data.len();
        let w = self.width;
        let h = self.height;
        let mut output = vec![0u8; w * h];

        let mut min_val = f64::MAX;
        let mut max_val = f64::MIN;

        for y in 0..h {
            for x in 0..w {
                if x < fft_size && y < fft_size {
                    let val = data[y][x].re;
                    min_val = min_val.min(val);
                    max_val = max_val.max(val);
                }
            }
        }

        let range = max_val - min_val;
        let range = if range == 0.0 { 1.0 } else { range };

        for y in 0..h {
            for x in 0..w {
                let idx = y * w + x;
                if x < fft_size && y < fft_size {
                    let val = data[y][x].re;
                    let normalized = ((val - min_val) / range * 255.0).clamp(0.0, 255.0);
                    output[idx] = normalized as u8;
                } else {
                    output[idx] = 0;
                }
            }
        }
        output
    }
}
