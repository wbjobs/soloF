from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

app = FastAPI(title="FFT Image Processor", description="基于WebAssembly的频域图像处理工具")

static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
async def read_root():
    return FileResponse(os.path.join(static_dir, "index.html"))


@app.get("/pkg/{filename:path}")
async def serve_wasm(filename: str):
    pkg_path = os.path.join(static_dir, "pkg", filename)
    if os.path.exists(pkg_path):
        if filename.endswith(".wasm"):
            return FileResponse(pkg_path, media_type="application/wasm")
        elif filename.endswith(".js"):
            return FileResponse(pkg_path, media_type="application/javascript")
        return FileResponse(pkg_path)
    return {"error": "File not found"}, 404


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
