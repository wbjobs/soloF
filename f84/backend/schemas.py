from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class ImportSpecifier(BaseModel):
    type: str
    local: Optional[str] = None
    imported: Optional[str] = None


class ImportDeclaration(BaseModel):
    source: str
    specifiers: list[ImportSpecifier] = []
    isRequire: bool = False


class ExportSpecifier(BaseModel):
    name: str
    type: str


class ExportDeclaration(BaseModel):
    specifiers: list[ExportSpecifier] = []
    default: bool = False


class ReExportDeclaration(BaseModel):
    source: str
    specifiers: list[dict] = []
    all: bool = False


class ParseResult(BaseModel):
    file: str
    imports: list[ImportDeclaration] = []
    exports: list[ExportDeclaration] = []
    reexports: list[ReExportDeclaration] = []
    dynamicImports: list[dict] = []
    error: Optional[str] = None


class DependencyEdge(BaseModel):
    source_file: str
    target_file: str
    dependency_type: str = "import"
    specifiers: list[dict] = []
    resolved_path: Optional[str] = None
    is_external: bool = False
    package_name: Optional[str] = None


class FileNode(BaseModel):
    path: str
    is_external: bool = False
    package_name: Optional[str] = None
    exports: list[dict] = []


class ReferenceResponse(BaseModel):
    file: str
    references: list[dict]
    total: int


class CycleCheckResponse(BaseModel):
    file_a: str
    file_b: str
    has_cycle: bool
    cycle_path: list[str] = []


class ImpactResponse(BaseModel):
    deleted_file: str
    directly_impacted: list[dict]
    transitively_impacted: list[dict]
    total_impacted: int


class WebhookPayload(BaseModel):
    repository: dict
    ref: str = ""
    before: str = ""
    after: str = ""
    commits: list[dict] = []
    pusher: Optional[dict] = None


class BuildRequest(BaseModel):
    repo_path: str
    branch: str = "main"


class GraphStats(BaseModel):
    total_files: int = 0
    total_dependencies: int = 0
    external_packages: int = 0


class TaskStatus(str):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskProgress(BaseModel):
    current_file: int = 0
    total_files: int = 0
    current_filename: Optional[str] = None
    nodes_created: int = 0
    edges_created: int = 0
    errors_count: int = 0
    phase: str = "scanning"
    message: str = ""


class TaskInfo(BaseModel):
    task_id: str
    status: str = "pending"
    repo_path: str
    branch: str = "main"
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    progress: TaskProgress = Field(default_factory=TaskProgress)
    result: Optional[dict] = None
    error: Optional[str] = None


class TaskListResponse(BaseModel):
    tasks: list[TaskInfo]
    total: int


class BuildResponse(BaseModel):
    task_id: str
    status: str
    message: str


class ProgressUpdate(BaseModel):
    task_id: str
    type: str = "progress"
    status: str
    progress: TaskProgress
    message: Optional[str] = None


class CoChangePattern(BaseModel):
    file_a: str
    file_b: str
    co_change_count: int
    total_commits: int
    confidence: float


class PredictionItem(BaseModel):
    file: str
    probability: float
    confidence: float
    co_change_count: int
    reason: str


class PredictionResponse(BaseModel):
    modified_file: str
    predictions: list[PredictionItem]
    total_commits_analyzed: int
    model_trained: bool


class TrainingResult(BaseModel):
    repo_path: str
    total_commits: int
    total_files: int
    co_change_patterns: int
    status: str
    message: str


class TrainRequest(BaseModel):
    repo_path: str
    branch: str = "main"
    max_commits: int = 500
