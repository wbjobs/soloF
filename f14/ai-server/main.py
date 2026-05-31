from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
import io
import base64
import requests
import uuid
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="AI Whiteboard Service", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SD_API_URL = "http://127.0.0.1:7860/sdapi/v1/img2img"


class AIGenerateRequest(BaseModel):
    prompt: Optional[str] = "beautiful illustration, masterpiece, high quality, colorful"
    negative_prompt: Optional[str] = "blurry, low quality, ugly, distorted"
    denoising_strength: Optional[float] = 0.75
    cfg_scale: Optional[float] = 7.0
    width: Optional[int] = 512
    height: Optional[int] = 512


class AIGenerateResponse(BaseModel):
    success: bool
    image: Optional[str] = None
    error: Optional[str] = None


@app.get("/")
async def root():
    return {"message": "AI Whiteboard Service is running"}


@app.get("/health")
async def health_check():
    try:
        response = requests.get("http://127.0.0.1:7860/sdapi/v1/progress", timeout=2)
        if response.status_code == 200:
            return {"status": "healthy", "sd_available": True}
    except:
        pass
    return {"status": "healthy", "sd_available": False, "note": "Using demo mode - Stable Diffusion not available"}


@app.post("/api/ai/generate", response_model=AIGenerateResponse)
async def generate_image(
    image: UploadFile = File(...),
    prompt: str = "beautiful illustration, masterpiece, high quality, colorful",
    negative_prompt: str = "blurry, low quality, ugly, distorted",
    denoising_strength: float = 0.75,
    cfg_scale: float = 7.0
):
    try:
        image_bytes = await image.read()
        
        try:
            response = requests.get("http://127.0.0.1:7860/sdapi/v1/progress", timeout=2)
            sd_available = response.status_code == 200
        except:
            sd_available = False
        
        if sd_available:
            img = Image.open(io.BytesIO(image_bytes))
            img = img.convert("RGB")
            img_buffer = io.BytesIO()
            img.save(img_buffer, format="PNG")
            img_base64 = base64.b64encode(img_buffer.getvalue()).decode()
            
            payload = {
                "init_images": [f"data:image/png;base64,{img_base64}"],
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "denoising_strength": denoising_strength,
                "cfg_scale": cfg_scale,
                "width": min(512, img.width),
                "height": min(512, img.height),
                "steps": 20,
                "sampler_name": "Euler a"
            }
            
            try:
                sd_response = requests.post(SD_API_URL, json=payload, timeout=60)
                
                if sd_response.status_code == 200:
                    result = sd_response.json()
                    if "images" in result and len(result["images"]) > 0:
                        generated_img = result["images"][0]
                        if not generated_img.startswith("data:"):
                            generated_img = f"data:image/png;base64,{generated_img}"
                        return AIGenerateResponse(success=True, image=generated_img)
                
                raise Exception(f"Stable Diffusion API error: {sd_response.status_code}")
                
            except Exception as sd_error:
                print(f"Stable Diffusion error: {sd_error}")
                return AIGenerateResponse(success=False, error=f"Stable Diffusion error: {str(sd_error)}")
        else:
            return AIGenerateResponse(
                success=True, 
                image=f"data:image/svg+xml;base64,{generate_demo_image(prompt)}"
            )
    
    except Exception as e:
        print(f"Error generating image: {e}")
        return AIGenerateResponse(success=False, error=str(e))


def generate_demo_image(prompt: str) -> str:
    import math
    
    colors = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD"]
    
    width = 512
    height = 512
    
    svg_content = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">
        <rect width="100%" height="100%" fill="#f0f4f8"/>
        <rect x="50" y="50" width="412" height="412" rx="20" fill="white" stroke="#4a90d9" stroke-width="4"/>
        <rect x="70" y="70" width="100" height="100" rx="10" fill="#4ECDC4" opacity="0.8"/>
        <circle cx="350" cy="120" r="50" fill="#FF6B6B" opacity="0.8"/>
        <path d="M100 300 Q200 200 300 300 T500 300" stroke="#45B7D1" stroke-width="8" fill="none"/>
        <rect x="180" y="350" width="150" height="80" rx="5" fill="#96CEB4" opacity="0.8"/>
        <circle cx="400" cy="400" r="40" fill="#FFEAA7" opacity="0.8"/>
        <text x="256" y="270" text-anchor="middle" font-size="16" fill="#666" font-family="Arial">
            <tspan x="256" dy="0">🤖 AI Generated Demo</tspan>
            <tspan x="256" dy="24" font-size="12">Start Stable Diffusion for real images</tspan>
        </text>
        <rect x="80" y="200" width="352" height="40" rx="5" fill="white" stroke="#ddd"/>
        <text x="256" y="227" text-anchor="middle" font-size="14" fill="#999" font-family="Arial">
            {prompt[:40]}...
        </text>
    </svg>'''
    
    return base64.b64encode(svg_content.encode()).decode()


@app.post("/api/ai/text-to-image", response_model=AIGenerateResponse)
async def text_to_image(
    prompt: str = "beautiful landscape, masterpiece, high quality",
    negative_prompt: str = "blurry, low quality",
    width: int = 512,
    height: int = 512
):
    try:
        try:
            response = requests.get("http://127.0.0.1:7860/sdapi/v1/progress", timeout=2)
            sd_available = response.status_code == 200
        except:
            sd_available = False
        
        if sd_available:
            payload = {
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "width": width,
                "height": height,
                "steps": 20,
                "cfg_scale": 7.0
            }
            
            sd_response = requests.post(
                "http://127.0.0.1:7860/sdapi/v1/txt2img", 
                json=payload, 
                timeout=60
            )
            
            if sd_response.status_code == 200:
                result = sd_response.json()
                if "images" in result and len(result["images"]) > 0:
                    generated_img = result["images"][0]
                    if not generated_img.startswith("data:"):
                        generated_img = f"data:image/png;base64,{generated_img}"
                    return AIGenerateResponse(success=True, image=generated_img)
        
        return AIGenerateResponse(
            success=True, 
            image=f"data:image/svg+xml;base64,{generate_demo_image(prompt)}"
        )
            
    except Exception as e:
        return AIGenerateResponse(success=False, error=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
