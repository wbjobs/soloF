from app.celery_app import celery
from celery.utils.log import get_task_logger

logger = get_task_logger(__name__)

class BaseTask(celery.Task):
    autoretry_for = (Exception,)
    retry_kwargs = {'max_retries': 3, 'countdown': 5}
    retry_backoff = True
    time_limit = 600
    soft_time_limit = 540
    
    def on_failure(self, exc, task_id, args, kwargs, einfo):
        logger.error(f'Task {task_id} failed: {exc}')
        super().on_failure(exc, task_id, args, kwargs, einfo)
    
    def on_success(self, retval, task_id, args, kwargs):
        logger.info(f'Task {task_id} succeeded')
        super().on_success(retval, task_id, args, kwargs)