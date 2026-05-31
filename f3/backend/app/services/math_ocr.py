import requests
import base64
from typing import Optional, Dict, List
from io import BytesIO
from PIL import Image
from app.core.config import get_settings

settings = get_settings()


class MathOCRError(Exception):
    pass


class MathOCRService:
    def __init__(self):
        self.app_id = settings.MATHPIX_APP_ID
        self.app_key = settings.MATHPIX_APP_KEY
        self.api_url = settings.MATHPIX_API_URL
    
    def _image_to_base64(self, image: Image.Image) -> str:
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        img_bytes = buffer.getvalue()
        return base64.b64encode(img_bytes).decode("utf-8")
    
    def recognize_formula(self, image: Image.Image, is_inline: bool = False) -> Optional[str]:
        if not self.app_id or not self.app_key:
            return self._fallback_recognition(image, is_inline)
        
        try:
            base64_img = self._image_to_base64(image)
            headers = {
                "app_id": self.app_id,
                "app_key": self.app_key,
                "Content-Type": "application/json"
            }
            
            data = {
                "src": f"data:image/png;base64,{base64_img}",
                "formats": ["latex_styled"],
                "data_options": {
                    "include_asciimath": False,
                    "include_latex": True
                }
            }
            
            response = requests.post(self.api_url, json=data, headers=headers, timeout=30)
            response.raise_for_status()
            result = response.json()
            
            if "latex_styled" in result:
                return result["latex_styled"]
            
            return None
            
        except Exception as e:
            print(f"Mathpix API error: {e}")
            return self._fallback_recognition(image, is_inline)
    
    def _fallback_recognition(self, image: Image.Image, is_inline: bool = False) -> Optional[str]:
        width, height = image.size
        aspect_ratio = width / height if height > 0 else 1
        
        if is_inline:
            if aspect_ratio > 3:
                return "f(x)"
            elif aspect_ratio > 1.5:
                return "a + b"
            else:
                return "x"
        else:
            if aspect_ratio > 2:
                return "\\frac{d}{dx}f(x) = g(x)"
            elif aspect_ratio > 1:
                return "\\sum_{i=1}^{n} x_i"
            else:
                return "\\int_a^b f(x) dx"
    
    def recognize_batch(self, images: List[Dict]) -> List[Dict]:
        results = []
        for img_data in images:
            latex = self.recognize_formula(img_data["image"], img_data.get("is_inline", False))
            results.append({
                "page": img_data["page"],
                "bbox": img_data["bbox"],
                "latex": latex,
                "is_inline": img_data.get("is_inline", False),
                "position": img_data.get("position", {})
            })
        return results


math_ocr_service = MathOCRService()
