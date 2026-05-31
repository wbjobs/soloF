from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
import json
import os
import shutil
from datetime import datetime

app = FastAPI(title="RPG Mod API - 版本管理版", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODS_FOLDER = "../Mods"
VERSIONS_FOLDER = "../Mods/_versions"
CURRENT_VERSION_FILE = "../Mods/_current_version.json"

os.makedirs(MODS_FOLDER, exist_ok=True)
os.makedirs(VERSIONS_FOLDER, exist_ok=True)

mods_cache = {}

class PositionData(BaseModel):
    x: float = 0.0
    y: float = 0.0

class ModNPCData(BaseModel):
    id: str = ""
    name: str = "未知NPC"
    dialogueLines: List[str] = []
    position: PositionData = None

class ModItemData(BaseModel):
    id: str = ""
    name: str = "未知物品"
    description: str = ""
    type: str = "普通"
    value: int = 0
    attackBonus: int = 0
    defenseBonus: int = 0
    damage: int = 0

class ModConfig(BaseModel):
    modId: str = ""
    modName: str = "未命名Mod"
    version: str = "1.0.0"
    author: str = "未知"
    npcs: Optional[List[ModNPCData]] = []
    items: Optional[List[ModItemData]] = []
    createdAt: str = ""
    description: str = ""

class VersionInfo(BaseModel):
    version: str
    timestamp: str
    description: str = ""
    modCount: int = 0

class RollbackRequest(BaseModel):
    version: str

def get_current_version_info():
    if os.path.exists(CURRENT_VERSION_FILE):
        with open(CURRENT_VERSION_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"current_version": "1.0.0", "versions": []}

def save_current_version_info(info):
    with open(CURRENT_VERSION_FILE, 'w', encoding='utf-8') as f:
        json.dump(info, f, ensure_ascii=False, indent=2)

def load_mods():
    mods_cache.clear()
    if not os.path.exists(MODS_FOLDER):
        return
    
    for filename in os.listdir(MODS_FOLDER):
        if filename.endswith(".json") and not filename.startswith("_"):
            filepath = os.path.join(MODS_FOLDER, filename)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    mod_data = json.load(f)
                    mod_id = mod_data.get("modId")
                    if mod_id:
                        mods_cache[mod_id] = mod_data
            except Exception as e:
                print(f"加载Mod失败 {filename}: {e}")

def create_version_snapshot(version: str, description: str = ""):
    timestamp = datetime.now().isoformat()
    version_folder = os.path.join(VERSIONS_FOLDER, version)
    
    if os.path.exists(version_folder):
        raise HTTPException(status_code=400, detail=f"版本 {version} 已存在")
    
    os.makedirs(version_folder, exist_ok=True)
    
    mod_count = 0
    for filename in os.listdir(MODS_FOLDER):
        if filename.endswith(".json") and not filename.startswith("_"):
            src_path = os.path.join(MODS_FOLDER, filename)
            dst_path = os.path.join(version_folder, filename)
            shutil.copy2(src_path, dst_path)
            mod_count += 1
    
    version_info = VersionInfo(
        version=version,
        timestamp=timestamp,
        description=description,
        modCount=mod_count
    )
    
    info = get_current_version_info()
    if "versions" not in info:
        info["versions"] = []
    info["versions"].append(version_info.dict())
    info["current_version"] = version
    save_current_version_info(info)
    
    return version_info

def rollback_to_version(version: str):
    version_folder = os.path.join(VERSIONS_FOLDER, version)
    if not os.path.exists(version_folder):
        raise HTTPException(status_code=404, detail=f"版本 {version} 不存在")
    
    for filename in os.listdir(MODS_FOLDER):
        if filename.endswith(".json") and not filename.startswith("_"):
            os.remove(os.path.join(MODS_FOLDER, filename))
    
    for filename in os.listdir(version_folder):
        if filename.endswith(".json"):
            src_path = os.path.join(version_folder, filename)
            dst_path = os.path.join(MODS_FOLDER, filename)
            shutil.copy2(src_path, dst_path)
    
    info = get_current_version_info()
    info["current_version"] = version
    save_current_version_info(info)
    
    load_mods()
    return True

@app.on_event("startup")
async def startup_event():
    load_mods()

@app.get("/")
async def root():
    return {"message": "RPG Mod API 运行中", "version": "2.0.0", "features": ["多版本管理", "热重载", "版本回滚"]}

@app.get("/api/mods", response_model=List[ModConfig])
async def get_all_mods():
    load_mods()
    return list(mods_cache.values())

@app.get("/api/mods/{mod_id}", response_model=ModConfig)
async def get_mod(mod_id: str):
    load_mods()
    if mod_id not in mods_cache:
        raise HTTPException(status_code=404, detail=f"Mod '{mod_id}' 未找到")
    return mods_cache[mod_id]

@app.post("/api/mods", response_model=ModConfig)
async def create_mod(mod_config: ModConfig):
    mod_id = mod_config.modId
    if not mod_id:
        raise HTTPException(status_code=400, detail="modId 不能为空")
    
    filepath = os.path.join(MODS_FOLDER, f"{mod_id}.json")
    
    if os.path.exists(filepath):
        raise HTTPException(status_code=400, detail=f"Mod '{mod_id}' 已存在，使用 PUT 更新")
    
    mod_data = mod_config.dict()
    mod_data["createdAt"] = datetime.now().isoformat()
    
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(mod_data, f, ensure_ascii=False, indent=2)
    
    mods_cache[mod_id] = mod_data
    return mod_config

@app.put("/api/mods/{mod_id}", response_model=ModConfig)
async def update_mod(mod_id: str, mod_config: ModConfig):
    if mod_id != mod_config.modId:
        raise HTTPException(status_code=400, detail="URL中的modId与请求体不匹配")
    
    filepath = os.path.join(MODS_FOLDER, f"{mod_id}.json")
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail=f"Mod '{mod_id}' 未找到")
    
    mod_data = mod_config.dict()
    mod_data["updatedAt"] = datetime.now().isoformat()
    
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(mod_data, f, ensure_ascii=False, indent=2)
    
    mods_cache[mod_id] = mod_data
    return mod_config

@app.delete("/api/mods/{mod_id}")
async def delete_mod(mod_id: str):
    filepath = os.path.join(MODS_FOLDER, f"{mod_id}.json")
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail=f"Mod '{mod_id}' 未找到")
    
    os.remove(filepath)
    if mod_id in mods_cache:
        del mods_cache[mod_id]
    
    return {"message": f"Mod '{mod_id}' 已删除", "success": True}

@app.post("/api/reload")
async def reload_mods():
    load_mods()
    return {"message": "Mod配置已重新加载", "mods_count": len(mods_cache), "success": True}

@app.post("/api/versions/create", response_model=VersionInfo)
async def create_version(version: str, description: str = ""):
    try:
        return create_version_snapshot(version, description)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"创建版本失败: {str(e)}")

@app.get("/api/versions", response_model=Dict[str, List[VersionInfo] | str])
async def get_all_versions():
    info = get_current_version_info()
    return {
        "current_version": info.get("current_version", "1.0.0"),
        "versions": info.get("versions", [])
    }

@app.get("/api/versions/{version}")
async def get_version_details(version: str):
    version_folder = os.path.join(VERSIONS_FOLDER, version)
    if not os.path.exists(version_folder):
        raise HTTPException(status_code=404, detail=f"版本 {version} 不存在")
    
    mods = []
    for filename in os.listdir(version_folder):
        if filename.endswith(".json"):
            filepath = os.path.join(version_folder, filename)
            with open(filepath, "r", encoding="utf-8") as f:
                mods.append(json.load(f))
    
    return {
        "version": version,
        "mods": mods,
        "modCount": len(mods)
    }

@app.post("/api/versions/rollback")
async def rollback_version(request: RollbackRequest):
    try:
        rollback_to_version(request.version)
        return {
            "message": f"已成功回滚到版本 {request.version}",
            "current_version": request.version,
            "success": True
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"回滚失败: {str(e)}")

@app.delete("/api/versions/{version}")
async def delete_version(version: str):
    version_folder = os.path.join(VERSIONS_FOLDER, version)
    if not os.path.exists(version_folder):
        raise HTTPException(status_code=404, detail=f"版本 {version} 不存在")
    
    info = get_current_version_info()
    if info.get("current_version") == version:
        raise HTTPException(status_code=400, detail="不能删除当前使用的版本")
    
    shutil.rmtree(version_folder)
    
    if "versions" in info:
        info["versions"] = [v for v in info["versions"] if v["version"] != version]
        save_current_version_info(info)
    
    return {"message": f"版本 {version} 已删除", "success": True}

@app.get("/api/versions/{version}/mods/{mod_id}")
async def get_version_mod(version: str, mod_id: str):
    version_folder = os.path.join(VERSIONS_FOLDER, version)
    if not os.path.exists(version_folder):
        raise HTTPException(status_code=404, detail=f"版本 {version} 不存在")
    
    filepath = os.path.join(version_folder, f"{mod_id}.json")
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail=f"Mod '{mod_id}' 在该版本中不存在")
    
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
