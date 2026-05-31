from minio import Minio
from minio.error import S3Error
from io import BytesIO
import json
from app.core.config import get_settings

settings = get_settings()


class StorageService:
    def __init__(self):
        self.client = Minio(
            settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE
        )
        self.bucket = settings.MINIO_BUCKET
        self._ensure_bucket()
    
    def _ensure_bucket(self):
        if not self.client.bucket_exists(self.bucket):
            self.client.make_bucket(self.bucket)
    
    def upload_pdf(self, file_id: str, file_content: bytes, filename: str) -> str:
        object_name = f"pdfs/{file_id}/{filename}"
        self.client.put_object(
            self.bucket,
            object_name,
            BytesIO(file_content),
            length=len(file_content),
            content_type="application/pdf"
        )
        return object_name
    
    def upload_markdown(self, file_id: str, content: str, filename: str) -> str:
        object_name = f"markdowns/{file_id}/{filename}"
        content_bytes = content.encode("utf-8")
        self.client.put_object(
            self.bucket,
            object_name,
            BytesIO(content_bytes),
            length=len(content_bytes),
            content_type="text/markdown"
        )
        return object_name
    
    def upload_formula_images(self, file_id: str, images: list) -> list:
        image_urls = []
        for idx, img_data in enumerate(images):
            object_name = f"formulas/{file_id}/formula_{idx}.png"
            self.client.put_object(
                self.bucket,
                object_name,
                BytesIO(img_data["content"]),
                length=len(img_data["content"]),
                content_type="image/png"
            )
            image_urls.append({
                "url": object_name,
                "page": img_data["page"],
                "bbox": img_data["bbox"]
            })
        return image_urls
    
    def get_markdown(self, object_name: str) -> str:
        response = self.client.get_object(self.bucket, object_name)
        return response.read().decode("utf-8")
    
    def get_file_url(self, object_name: str, expires: int = 3600) -> str:
        return self.client.presigned_get_object(self.bucket, object_name, expires=expires)
    
    def save_conversion_result(self, file_id: str, result: dict):
        object_name = f"results/{file_id}.json"
        content = json.dumps(result, ensure_ascii=False).encode("utf-8")
        self.client.put_object(
            self.bucket,
            object_name,
            BytesIO(content),
            length=len(content),
            content_type="application/json"
        )
    
    def get_conversion_result(self, file_id: str) -> dict:
        object_name = f"results/{file_id}.json"
        try:
            response = self.client.get_object(self.bucket, object_name)
            return json.loads(response.read().decode("utf-8"))
        except S3Error:
            return None


storage_service = StorageService()
