import os
import time
import json
import threading
import numpy as np
from PIL import Image, ExifTags
import tensorflow as tf
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

MODEL_PATH = os.path.join(os.path.dirname(__file__), 'plant_disease.tflite')
ADVICE_PATH = os.path.join(os.path.dirname(__file__), 'disease_advice.json')
LABELS = [
    '番茄早疫病', '番茄晚疫病', '番茄叶霉病', '番茄斑枯病',
    '番茄溃疡病', '番茄黄萎病', '番茄花叶病毒病', '番茄健康',
    '苹果黑星病', '苹果白粉病', '苹果锈病', '苹果健康'
]

def load_disease_advice():
    if os.path.exists(ADVICE_PATH):
        with open(ADVICE_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

DISEASE_ADVICE = load_disease_advice()

class ModelManager:
    def __init__(self, model_path, check_interval=5):
        self.model_path = model_path
        self.check_interval = check_interval
        self.interpreter = None
        self.input_details = None
        self.output_details = None
        self.last_modified_time = 0
        self.lock = threading.Lock()
        self._load_model()
        self._start_watcher()
    
    def _release_model(self):
        if self.interpreter is not None:
            try:
                if hasattr(self.interpreter, '_interpreter'):
                    del self.interpreter._interpreter
                del self.interpreter
                self.interpreter = None
                self.input_details = None
                self.output_details = None
                import gc
                gc.collect()
                print("Old model resources released")
            except Exception as e:
                print(f"Warning during model release: {e}")
    
    def _load_model(self):
        with self.lock:
            if os.path.exists(self.model_path):
                self._release_model()
                self.interpreter = tf.lite.Interpreter(model_path=self.model_path)
                self.interpreter.allocate_tensors()
                self.input_details = self.interpreter.get_input_details()
                self.output_details = self.interpreter.get_output_details()
                self.last_modified_time = os.path.getmtime(self.model_path)
                print(f"Model loaded: {self.model_path}")
            else:
                print(f"Model file not found: {self.model_path}")
    
    def _check_and_reload(self):
        if os.path.exists(self.model_path):
            current_mtime = os.path.getmtime(self.model_path)
            if current_mtime > self.last_modified_time:
                print("Model updated, reloading...")
                self._load_model()
    
    def _start_watcher(self):
        def watcher():
            while True:
                self._check_and_reload()
                time.sleep(self.check_interval)
        thread = threading.Thread(target=watcher, daemon=True)
        thread.start()
    
    def predict(self, image_array):
        with self.lock:
            if self.interpreter is None:
                raise Exception("Model not loaded")
            
            self.interpreter.set_tensor(self.input_details[0]['index'], image_array)
            self.interpreter.invoke()
            output_data = self.interpreter.get_tensor(self.output_details[0]['index'])
            return output_data[0]

model_manager = ModelManager(MODEL_PATH)

def _apply_exif_orientation(image):
    try:
        for orientation in ExifTags.TAGS.keys():
            if ExifTags.TAGS[orientation] == 'Orientation':
                break
        
        exif = image._getexif()
        if exif is not None:
            orientation = exif.get(orientation, 1)
            
            if orientation == 2:
                image = image.transpose(Image.FLIP_LEFT_RIGHT)
            elif orientation == 3:
                image = image.transpose(Image.ROTATE_180)
            elif orientation == 4:
                image = image.transpose(Image.FLIP_TOP_BOTTOM)
            elif orientation == 5:
                image = image.transpose(Image.FLIP_LEFT_RIGHT).transpose(Image.ROTATE_90)
            elif orientation == 6:
                image = image.transpose(Image.ROTATE_270)
            elif orientation == 7:
                image = image.transpose(Image.FLIP_LEFT_RIGHT).transpose(Image.ROTATE_270)
            elif orientation == 8:
                image = image.transpose(Image.ROTATE_90)
    except Exception as e:
        print(f"Warning during EXIF processing: {e}")
    return image

def preprocess_image(image_file, target_size=(224, 224)):
    image = Image.open(image_file)
    image = _apply_exif_orientation(image)
    image = image.convert('RGB')
    image = image.resize(target_size, Image.Resampling.LANCZOS)
    image_array = np.array(image, dtype=np.float32)
    image_array = image_array / 255.0
    image_array = np.expand_dims(image_array, axis=0)
    return image_array

@app.route('/predict', methods=['POST'])
def predict():
    try:
        if 'image' not in request.files:
            return jsonify({'error': 'No image file provided'}), 400
        
        image_file = request.files['image']
        if image_file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        image_array = preprocess_image(image_file)
        predictions = model_manager.predict(image_array)
        
        predicted_index = np.argmax(predictions)
        confidence = float(predictions[predicted_index])
        disease_name = LABELS[predicted_index] if predicted_index < len(LABELS) else f"Unknown_{predicted_index}"
        
        advice_info = DISEASE_ADVICE.get(disease_name, {
            'symptom': '暂无症状描述',
            'advice': ['暂无防治建议']
        })
        
        return jsonify({
            'disease': disease_name,
            'confidence': confidence,
            'symptom': advice_info.get('symptom', '暂无症状描述'),
            'advice': advice_info.get('advice', ['暂无防治建议']),
            'success': True
        })
    
    except Exception as e:
        return jsonify({'error': str(e), 'success': False}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'model_loaded': model_manager.interpreter is not None})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
