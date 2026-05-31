import os
import tempfile
from celery import Task
from app.core.celery_app import celery
from app.services.redis_service import redis_service
from app.services.storage import storage_service
from app.services.pdf_processor import pdf_processor


class ConversionTask(Task):
    def on_success(self, retval, task_id, args, kwargs):
        redis_service.set_task_status(
            task_id,
            "SUCCESS",
            progress=100,
            message="转换完成！",
            data=retval
        )
    
    def on_failure(self, exc, task_id, args, kwargs, einfo):
        redis_service.set_task_status(
            task_id,
            "FAILURE",
            progress=0,
            message=f"转换失败: {str(exc)}"
        )


@celery.task(base=ConversionTask, bind=True, name="convert_pdf_to_markdown")
def convert_pdf_to_markdown(self, file_id: str, filename: str, pdf_object_name: str):
    redis_service.set_task_status(
        self.request.id,
        "STARTED",
        progress=5,
        message="任务已启动，正在准备处理..."
    )
    
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temp_pdf:
        pdf_url = storage_service.get_file_url(pdf_object_name)
        
        import requests
        response = requests.get(pdf_url)
        temp_pdf.write(response.content)
        temp_pdf_path = temp_pdf.name
    
    try:
        def update_progress(progress, message):
            redis_service.update_task_progress(self.request.id, progress, message)
        
        result = pdf_processor.process_pdf(
            temp_pdf_path,
            self.request.id,
            update_progress=update_progress
        )
        
        md_filename = f"{os.path.splitext(filename)[0]}.md"
        md_object_name = storage_service.upload_markdown(
            file_id,
            result["markdown"],
            md_filename
        )
        
        result.update({
            "file_id": file_id,
            "filename": filename,
            "md_filename": md_filename,
            "md_object_name": md_object_name,
            "pdf_object_name": pdf_object_name
        })
        
        storage_service.save_conversion_result(file_id, result)
        
        return result
    
    finally:
        if os.path.exists(temp_pdf_path):
            os.unlink(temp_pdf_path)
