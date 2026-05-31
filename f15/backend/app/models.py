from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.database import Base
from datetime import datetime

class Workflow(Base):
    __tablename__ = "workflows"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    dag_config = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    schedule = Column(String(100))
    is_active = Column(Integer, default=1)
    
    executions = relationship("WorkflowExecution", back_populates="workflow")

class WorkflowExecution(Base):
    __tablename__ = "workflow_executions"
    
    id = Column(Integer, primary_key=True, index=True)
    workflow_id = Column(Integer, ForeignKey("workflows.id"))
    execution_id = Column(String(50), unique=True, nullable=False)
    status = Column(String(20), default='PENDING')
    start_time = Column(DateTime)
    end_time = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    workflow = relationship("Workflow", back_populates="executions")
    tasks = relationship("TaskExecution", back_populates="workflow_execution")

class TaskExecution(Base):
    __tablename__ = "task_executions"
    
    id = Column(Integer, primary_key=True, index=True)
    workflow_execution_id = Column(Integer, ForeignKey("workflow_executions.id"))
    node_id = Column(String(50), nullable=False)
    task_id = Column(String(50), unique=True, nullable=False)
    task_name = Column(String(100))
    task_type = Column(String(20))
    status = Column(String(20), default='PENDING')
    result = Column(Text)
    start_time = Column(DateTime)
    end_time = Column(DateTime)
    retry_count = Column(Integer, default=0)
    
    workflow_execution = relationship("WorkflowExecution", back_populates="tasks")