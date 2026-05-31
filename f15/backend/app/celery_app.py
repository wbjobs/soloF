from celery import Celery
from celery.signals import task_postrun, task_prerun
import redis
import json
from datetime import datetime

celery = Celery(
    'task_scheduler',
    broker='pyamqp://guest:guest@localhost:5672//',
    backend='redis://localhost:6379/0'
)

celery.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='Asia/Shanghai',
    enable_utc=True,
    task_track_started=True,
    task_time_limit=600,
    task_soft_time_limit=540,
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=1000,
)

redis_client = redis.Redis(host='localhost', port=6379, db=1, decode_responses=True)

@task_prerun.connect
def task_prerun_handler(sender=None, task_id=None, task=None, args=None, kwargs=None, **other_kwargs):
    from app.models import TaskExecution
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        execution = db.query(TaskExecution).filter(TaskExecution.task_id == task_id).first()
        if execution:
            execution.status = 'STARTED'
            execution.start_time = datetime.utcnow()
            db.commit()
    finally:
        db.close()

@task_postrun.connect
def task_postrun_handler(sender=None, task_id=None, task=None, args=None, kwargs=None, retval=None, state=None, **other_kwargs):
    from app.models import TaskExecution
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        execution = db.query(TaskExecution).filter(TaskExecution.task_id == task_id).first()
        if execution:
            execution.status = state
            execution.result = json.dumps(retval) if retval else None
            execution.end_time = datetime.utcnow()
            db.commit()
    finally:
        db.close()