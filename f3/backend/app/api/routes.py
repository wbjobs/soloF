import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from app.core.config import get_settings
from app.services.storage import storage_service
from app.services.redis_service import redis_service
from app.tasks.conversion import convert_pdf_to_markdown

router = APIRouter()
settings = get_settings()


@router.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="只支持PDF文件")
    
    content = await file.read()
    
    if len(content) > settings.MAX_PDF_SIZE:
        raise HTTPException(status_code=400, detail=f"文件大小超过限制 ({settings.MAX_PDF_SIZE//1024//1024}MB)")
    
    file_id = str(uuid.uuid4())
    
    pdf_object_name = storage_service.upload_pdf(
        file_id,
        content,
        file.filename
    )
    
    task = convert_pdf_to_markdown.delay(
        file_id,
        file.filename,
        pdf_object_name
    )
    
    return JSONResponse({
        "file_id": file_id,
        "task_id": task.id,
        "filename": file.filename,
        "message": "文件上传成功，转换任务已开始"
    })


@router.get("/task/{task_id}")
async def get_task_status(task_id: str):
    task_data = redis_service.get_task_status(task_id)
    
    if not task_data:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    return JSONResponse(task_data)


@router.get("/result/{file_id}")
async def get_conversion_result(file_id: str):
    result = storage_service.get_conversion_result(file_id)
    
    if not result:
        raise HTTPException(status_code=404, detail="结果不存在")
    
    return JSONResponse({
        "file_id": file_id,
        "filename": result.get("filename"),
        "md_filename": result.get("md_filename"),
        "pages_count": result.get("pages_count"),
        "formulas_count": len(result.get("formulas", [])),
        "markdown": result.get("markdown"),
        "formulas": result.get("formulas", [])
    })


@router.get("/download/{file_id}")
async def download_markdown(file_id: str):
    result = storage_service.get_conversion_result(file_id)
    
    if not result:
        raise HTTPException(status_code=404, detail="结果不存在")
    
    md_object_name = result.get("md_object_name")
    
    if not md_object_name:
        raise HTTPException(status_code=404, detail="Markdown文件不存在")
    
    download_url = storage_service.get_file_url(md_object_name)
    
    return JSONResponse({
        "download_url": download_url,
        "filename": result.get("md_filename")
    })


@router.put("/result/{file_id}")
async def update_markdown(file_id: str, markdown: str):
    result = storage_service.get_conversion_result(file_id)
    
    if not result:
        raise HTTPException(status_code=404, detail="结果不存在")
    
    result["markdown"] = markdown
    
    md_filename = result.get("md_filename", f"{file_id}.md")
    md_object_name = storage_service.upload_markdown(
        file_id,
        markdown,
        md_filename
    )
    
    result["md_object_name"] = md_object_name
    storage_service.save_conversion_result(file_id, result)
    
    return JSONResponse({
        "message": "保存成功",
        "file_id": file_id
    })
