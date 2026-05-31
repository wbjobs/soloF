use num_complex::Complex;
use rustfft::{Fft, FftPlanner};
use std::sync::Arc;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct FftProcessor {
    fft_size: usize,
    window: Vec<f32>,
    fft_plan: Arc<dyn Fft<f32>>,
    input_buffer: Vec<Complex<f32>>,
    output_magnitudes: Vec<f32>,
    output_frequencies: Vec<f32>,
    scratch_buffer: Vec<f32>,
}

#[wasm_bindgen]
impl FftProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new(fft_size: usize) -> FftProcessor {
        let mut planner = FftPlanner::<f32>::new();
        let fft_plan = planner.plan_fft_forward(fft_size);
        let window = Self::hann_window(fft_size);

        let output_frequencies = (0..fft_size / 2)
            .map(|i| (i as f32 * 44100.0) / fft_size as f32)
            .collect();

        FftProcessor {
            fft_size,
            window,
            fft_plan,
            input_buffer: vec![Complex::new(0.0, 0.0); fft_size],
            output_magnitudes: vec![0.0; fft_size / 2],
            output_frequencies,
            scratch_buffer: vec![0.0; fft_size],
        }
    }

    #[wasm_bindgen]
    pub fn process(&mut self, samples: &[f32], sample_rate: f32) -> JsValue {
        let len = samples.len().min(self.fft_size);
        
        self.scratch_buffer[..len].copy_from_slice(&samples[..len]);
        for i in len..self.fft_size {
            self.scratch_buffer[i] = 0.0;
        }

        for i in 0..self.fft_size {
            self.input_buffer[i] = Complex::new(
                self.scratch_buffer[i] * self.window[i],
                0.0
            );
        }

        self.fft_plan.process(&mut self.input_buffer);

        for i in 0..self.fft_size / 2 {
            let c = self.input_buffer[i];
            self.output_magnitudes[i] = (c.re * c.re + c.im * c.im).sqrt();
            self.output_frequencies[i] = (i as f32 * sample_rate) / self.fft_size as f32;
        }

        let mut json = String::with_capacity(self.fft_size * 8);
        json.push_str("{\"magnitudes\":[");
        for (i, &m) in self.output_magnitudes.iter().enumerate() {
            if i > 0 {
                json.push(',');
            }
            let mut buf = ryu::Buffer::new();
            json.push_str(buf.format(m));
        }
        json.push_str("],\"frequencies\":[");
        for (i, &f) in self.output_frequencies.iter().enumerate() {
            if i > 0 {
                json.push(',');
            }
            let mut buf = ryu::Buffer::new();
            json.push_str(buf.format(f));
        }
        json.push_str("],\"sampleRate\":");
        let mut buf = ryu::Buffer::new();
        json.push_str(buf.format(sample_rate));
        json.push_str(",\"fftSize\":");
        json.push_str(itoa::Buffer::new().format(self.fft_size));
        json.push('}');

        JsValue::from_str(&json)
    }

    #[wasm_bindgen]
    pub fn set_fft_size(&mut self, fft_size: usize) {
        if fft_size == self.fft_size {
            return;
        }

        let mut planner = FftPlanner::<f32>::new();
        self.fft_plan = planner.plan_fft_forward(fft_size);
        self.window = Self::hann_window(fft_size);
        self.fft_size = fft_size;

        self.input_buffer.resize(fft_size, Complex::new(0.0, 0.0));
        self.output_magnitudes.resize(fft_size / 2, 0.0);
        self.output_frequencies.resize(fft_size / 2, 0.0);
        self.scratch_buffer.resize(fft_size, 0.0);
    }

    #[wasm_bindgen(getter)]
    pub fn fft_size(&self) -> usize {
        self.fft_size
    }

    #[wasm_bindgen]
    pub fn free(self) {
    }
}

impl FftProcessor {
    fn hann_window(size: usize) -> Vec<f32> {
        let mut window = Vec::with_capacity(size);
        for i in 0..size {
            let t = i as f32 / (size - 1) as f32;
            window.push(0.5 * (1.0 - (2.0 * std::f32::consts::PI * t).cos()));
        }
        window
    }
}

#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}
