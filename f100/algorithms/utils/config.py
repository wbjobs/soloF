import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    DGRAPH_ALPHA_HOST = os.getenv('DGRAPH_ALPHA_HOST', 'localhost')
    DGRAPH_ALPHA_PORT = int(os.getenv('DGRAPH_ALPHA_PORT', '9080'))
    DGRAPH_GRAPHQL_URL = os.getenv('DGRAPH_GRAPHQL_URL', 'http://localhost:8080/graphql')

    GRPC_HOST = os.getenv('GRPC_HOST', '0.0.0.0')
    GRPC_PORT = int(os.getenv('GRPC_PORT', '50051'))

    REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
    REDIS_PORT = int(os.getenv('REDIS_PORT', '6379'))
    REDIS_DB = int(os.getenv('REDIS_DB', '0'))

    CELERY_BROKER_URL = os.getenv('CELERY_BROKER_URL', f'redis://{REDIS_HOST}:{REDIS_PORT}/0')
    CELERY_RESULT_BACKEND = os.getenv('CELERY_RESULT_BACKEND', f'redis://{REDIS_HOST}:{REDIS_PORT}/0')

    SANDBOX_TIMEOUT = int(os.getenv('SANDBOX_TIMEOUT', '30'))
    SANDBOX_MEMORY_LIMIT = os.getenv('SANDBOX_MEMORY_LIMIT', '256m')
    SANDBOX_CPU_LIMIT = float(os.getenv('SANDBOX_CPU_LIMIT', '1.0'))

    LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')

    TASK_STATUS_PENDING = 'PENDING'
    TASK_STATUS_RUNNING = 'RUNNING'
    TASK_STATUS_SUCCESS = 'SUCCESS'
    TASK_STATUS_FAILED = 'FAILED'
    TASK_STATUS_CANCELLED = 'CANCELLED'
    TASK_STATUS_TIMEOUT = 'TIMEOUT'

    ALGORITHM_TYPE_BUILTIN = 'builtin'
    ALGORITHM_TYPE_CUSTOM = 'custom'


config = Config()
