from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.responses import Response
from jose import JWTError, jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from pydantic import BaseModel
import sqlite3
import json
import asyncio
from dotenv import load_dotenv
import os
from bs4 import BeautifulSoup

from version_manager import VersionManager
from diff_engine import RedlineDiff
from pdf_generator import RedlinePDFGenerator

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-here-change-in-production")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 1440))

app = FastAPI(title="法律合同协同编辑平台 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

version_manager = VersionManager()
redline_diff = RedlineDiff()
pdf_generator = RedlinePDFGenerator()

class User(BaseModel):
    username: str
    role: str
    full_name: Optional[str] = None

class UserInDB(User):
    hashed_password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    user: User

class TokenData(BaseModel):
    username: Optional[str] = None

class Document(BaseModel):
    id: str
    title: str
    content: Optional[str] = None
    created_at: str
    updated_at: str
    owner: str

class Comment(BaseModel):
    id: str
    document_id: str
    content: str
    author: str
    position: Optional[Dict] = None
    created_at: str

class CreateVersionRequest(BaseModel):
    content: str
    comment: Optional[str] = ""

class ExportRedlineRequest(BaseModel):
    from_version: Optional[int] = None
    to_version: Optional[int] = None

def init_db():
    conn = sqlite3.connect('legal_contract.db')
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            full_name TEXT,
            hashed_password TEXT,
            role TEXT NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            ydoc_state BLOB,
            created_at TEXT,
            updated_at TEXT,
            owner TEXT,
            FOREIGN KEY (owner) REFERENCES users(username)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            document_id TEXT,
            content TEXT,
            author TEXT,
            position TEXT,
            created_at TEXT,
            FOREIGN KEY (document_id) REFERENCES documents(id),
            FOREIGN KEY (author) REFERENCES users(username)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS document_permissions (
            document_id TEXT,
            username TEXT,
            permission TEXT,
            PRIMARY KEY (document_id, username),
            FOREIGN KEY (document_id) REFERENCES documents(id),
            FOREIGN KEY (username) REFERENCES users(username)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS document_versions (
            id TEXT PRIMARY KEY,
            document_id TEXT,
            version_number INTEGER,
            content TEXT,
            ydoc_state BLOB,
            created_by TEXT,
            created_at TEXT,
            comment TEXT,
            FOREIGN KEY (document_id) REFERENCES documents(id)
        )
    ''')
    
    cursor.execute("SELECT username FROM users WHERE username = 'admin'")
    if not cursor.fetchone():
        hashed = pwd_context.hash("admin123")
        cursor.execute(
            "INSERT INTO users (username, full_name, hashed_password, role) VALUES (?, ?, ?, ?)",
            ("admin", "系统管理员", hashed, "admin")
        )
    
    cursor.execute("SELECT username FROM users WHERE username = 'lawyer1'")
    if not cursor.fetchone():
        hashed = pwd_context.hash("lawyer123")
        cursor.execute(
            "INSERT INTO users (username, full_name, hashed_password, role) VALUES (?, ?, ?, ?)",
            ("lawyer1", "张律师", hashed, "lawyer")
        )
    
    cursor.execute("SELECT username FROM users WHERE username = 'client1'")
    if not cursor.fetchone():
        hashed = pwd_context.hash("client123")
        cursor.execute(
            "INSERT INTO users (username, full_name, hashed_password, role) VALUES (?, ?, ?, ?)",
            ("client1", "李客户", hashed, "client")
        )
    
    conn.commit()
    conn.close()

init_db()

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def get_user(username: str):
    conn = sqlite3.connect('legal_contract.db')
    cursor = conn.cursor()
    cursor.execute("SELECT username, full_name, hashed_password, role FROM users WHERE username = ?", (username,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return UserInDB(username=row[0], full_name=row[1], hashed_password=row[2], role=row[3])
    return None

def authenticate_user(username: str, password: str):
    user = get_user(username)
    if not user:
        return False
    if not verify_password(password, user.hashed_password):
        return False
    return user

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无法验证凭据",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception
    user = get_user(username=token_data.username)
    if user is None:
        raise credentials_exception
    return user

def extract_text_from_html(html_content: str) -> str:
    if not html_content:
        return ""
    try:
        soup = BeautifulSoup(html_content, 'lxml')
        return soup.get_text(separator='\n', strip=True)
    except:
        return html_content

@app.post("/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "user": User(username=user.username, role=user.role, full_name=user.full_name)}

@app.get("/users/me", response_model=User)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user

@app.get("/documents")
async def get_documents(current_user: User = Depends(get_current_user)):
    conn = sqlite3.connect('legal_contract.db')
    cursor = conn.cursor()
    cursor.execute("""
        SELECT d.id, d.title, d.created_at, d.updated_at, d.owner
        FROM documents d
        LEFT JOIN document_permissions dp ON d.id = dp.document_id
        WHERE d.owner = ? OR dp.username = ?
        GROUP BY d.id
    """, (current_user.username, current_user.username))
    docs = cursor.fetchall()
    conn.close()
    return [{"id": d[0], "title": d[1], "created_at": d[2], "updated_at": d[3], "owner": d[4]} for d in docs]

@app.post("/documents")
async def create_document(doc: Dict, current_user: User = Depends(get_current_user)):
    if current_user.role not in ["admin", "lawyer"]:
        raise HTTPException(status_code=403, detail="无权创建文档")
    
    import uuid
    doc_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    
    conn = sqlite3.connect('legal_contract.db')
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO documents (id, title, created_at, updated_at, owner) VALUES (?, ?, ?, ?, ?)",
        (doc_id, doc.get("title", "未命名合同"), now, now, current_user.username)
    )
    conn.commit()
    conn.close()
    
    return {"id": doc_id, "title": doc.get("title", "未命名合同"), "created_at": now, "updated_at": now, "owner": current_user.username}

@app.get("/documents/{doc_id}")
async def get_document(doc_id: str, current_user: User = Depends(get_current_user)):
    conn = sqlite3.connect('legal_contract.db')
    cursor = conn.cursor()
    cursor.execute("SELECT id, title, ydoc_state, created_at, updated_at, owner FROM documents WHERE id = ?", (doc_id,))
    doc = cursor.fetchone()
    conn.close()
    
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    
    return {
        "id": doc[0],
        "title": doc[1],
        "has_ydoc": doc[2] is not None,
        "created_at": doc[3],
        "updated_at": doc[4],
        "owner": doc[5],
        "user_role": current_user.role
    }

@app.get("/documents/{doc_id}/comments")
async def get_comments(doc_id: str, current_user: User = Depends(get_current_user)):
    conn = sqlite3.connect('legal_contract.db')
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, content, author, position, created_at
        FROM comments WHERE document_id = ?
        ORDER BY created_at DESC
    """, (doc_id,))
    comments = cursor.fetchall()
    conn.close()
    
    return [{
        "id": c[0],
        "content": c[1],
        "author": c[2],
        "position": json.loads(c[3]) if c[3] else None,
        "created_at": c[4]
    } for c in comments]

@app.post("/documents/{doc_id}/comments")
async def add_comment(doc_id: str, comment: Dict, current_user: User = Depends(get_current_user)):
    import uuid
    comment_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    
    conn = sqlite3.connect('legal_contract.db')
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO comments (id, document_id, content, author, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (comment_id, doc_id, comment.get("content", ""), current_user.username, 
         json.dumps(comment.get("position")) if comment.get("position") else None, now)
    )
    conn.commit()
    conn.close()
    
    return {"id": comment_id, "content": comment.get("content", ""), "author": current_user.username, "created_at": now}

@app.post("/documents/{doc_id}/versions")
async def create_version(doc_id: str, request: CreateVersionRequest, current_user: User = Depends(get_current_user)):
    plain_text = extract_text_from_html(request.content)
    
    conn = sqlite3.connect('legal_contract.db')
    cursor = conn.cursor()
    cursor.execute("SELECT id, ydoc_state FROM documents WHERE id = ?", (doc_id,))
    doc = cursor.fetchone()
    conn.close()
    
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    
    ydoc_state = doc[1]
    
    version_id = version_manager.create_version(
        doc_id, plain_text, ydoc_state, current_user.username, request.comment
    )
    
    return {"version_id": version_id, "message": "版本创建成功"}

@app.get("/documents/{doc_id}/versions")
async def get_document_versions(doc_id: str, current_user: User = Depends(get_current_user)):
    versions = version_manager.get_document_versions(doc_id)
    return versions

@app.get("/documents/{doc_id}/versions/{version_number}")
async def get_specific_version(doc_id: str, version_number: int, current_user: User = Depends(get_current_user)):
    version = version_manager.get_version_by_number(doc_id, version_number)
    if not version:
        raise HTTPException(status_code=404, detail="版本不存在")
    return version

@app.post("/documents/{doc_id}/compare")
async def compare_versions(doc_id: str, request: ExportRedlineRequest, current_user: User = Depends(get_current_user)):
    from_version_num = request.from_version
    to_version_num = request.to_version
    
    if to_version_num is None:
        latest = version_manager.get_latest_version(doc_id)
        if not latest:
            raise HTTPException(status_code=400, detail="没有可用的版本进行对比")
        to_version_num = latest['version_number']
    
    if from_version_num is None:
        from_version_num = to_version_num - 1
    
    if from_version_num < 1:
        from_version = {"content": ""}
    else:
        from_version = version_manager.get_version_by_number(doc_id, from_version_num)
        if not from_version:
            raise HTTPException(status_code=404, detail=f"版本 {from_version_num} 不存在")
    
    to_version = version_manager.get_version_by_number(doc_id, to_version_num)
    if not to_version:
        raise HTTPException(status_code=404, detail=f"版本 {to_version_num} 不存在")
    
    old_text = from_version.get('content', '')
    new_text = to_version.get('content', '')
    
    changes = redline_diff.compute_diff(old_text, new_text)
    line_changes = redline_diff.group_changes_by_line(changes, old_text, new_text)
    summary = redline_diff.get_change_summary(changes)
    
    return {
        "from_version": from_version_num,
        "to_version": to_version_num,
        "summary": summary,
        "line_changes": line_changes,
        "old_text": old_text,
        "new_text": new_text
    }

@app.post("/documents/{doc_id}/export/redline")
async def export_redline_pdf(doc_id: str, request: ExportRedlineRequest, current_user: User = Depends(get_current_user)):
    conn = sqlite3.connect('legal_contract.db')
    cursor = conn.cursor()
    cursor.execute("SELECT title FROM documents WHERE id = ?", (doc_id,))
    doc = cursor.fetchone()
    conn.close()
    
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    
    document_title = doc[0]
    
    from_version_num = request.from_version
    to_version_num = request.to_version
    
    if to_version_num is None:
        latest = version_manager.get_latest_version(doc_id)
        if not latest:
            raise HTTPException(status_code=400, detail="没有可用的版本进行导出")
        to_version_num = latest['version_number']
    
    if from_version_num is None:
        from_version_num = to_version_num - 1
    
    if from_version_num < 1:
        from_version = {"content": "", "version_number": 0}
    else:
        from_version = version_manager.get_version_by_number(doc_id, from_version_num)
        if not from_version:
            raise HTTPException(status_code=404, detail=f"版本 {from_version_num} 不存在")
    
    to_version = version_manager.get_version_by_number(doc_id, to_version_num)
    if not to_version:
        raise HTTPException(status_code=404, detail=f"版本 {to_version_num} 不存在")
    
    old_text = from_version.get('content', '')
    new_text = to_version.get('content', '')
    
    changes = redline_diff.compute_diff(old_text, new_text)
    line_changes = redline_diff.group_changes_by_line(changes, old_text, new_text)
    summary = redline_diff.get_change_summary(changes)
    
    conn = sqlite3.connect('legal_contract.db')
    cursor = conn.cursor()
    cursor.execute("""
        SELECT content, author, created_at FROM comments WHERE document_id = ?
        ORDER BY created_at DESC
    """, (doc_id,))
    comments_data = cursor.fetchall()
    conn.close()
    
    comments = [{"content": c[0], "author": c[1], "created_at": c[2]} for c in comments_data]
    
    pdf_bytes = pdf_generator.generate_redline_pdf(
        document_title=document_title,
        line_changes=line_changes,
        summary=summary,
        comments=comments,
        old_version=str(from_version_num),
        new_version=str(to_version_num)
    )
    
    filename = f"{document_title}_修订模式_v{from_version_num}-v{to_version_num}.pdf"
    
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{filename.encode('utf-8').decode('latin-1')}"
        }
    )

@app.post("/documents/{doc_id}/export/pdf")
async def export_pdf(doc_id: str, current_user: User = Depends(get_current_user)):
    conn = sqlite3.connect('legal_contract.db')
    cursor = conn.cursor()
    cursor.execute("SELECT title FROM documents WHERE id = ?", (doc_id,))
    doc = cursor.fetchone()
    conn.close()
    
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    
    document_title = doc[0]
    
    latest_version = version_manager.get_latest_version(doc_id)
    if latest_version:
        content = latest_version.get('content', '')
    else:
        content = "暂无内容"
    
    pdf_bytes = pdf_generator.generate_simple_pdf(document_title, content)
    filename = f"{document_title}.pdf"
    
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{filename.encode('utf-8').decode('latin-1')}"
        }
    )

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
    
    async def connect(self, websocket: WebSocket, doc_id: str):
        await websocket.accept()
        if doc_id not in self.active_connections:
            self.active_connections[doc_id] = []
        self.active_connections[doc_id].append(websocket)
    
    def disconnect(self, websocket: WebSocket, doc_id: str):
        if doc_id in self.active_connections:
            self.active_connections[doc_id].remove(websocket)
            if not self.active_connections[doc_id]:
                del self.active_connections[doc_id]
    
    async def broadcast(self, message: bytes, doc_id: str, sender: WebSocket):
        if doc_id in self.active_connections:
            for connection in self.active_connections[doc_id]:
                if connection != sender:
                    await connection.send_bytes(message)

manager = ConnectionManager()

@app.websocket("/ws/{doc_id}")
async def websocket_endpoint(websocket: WebSocket, doc_id: str):
    await manager.connect(websocket, doc_id)
    try:
        while True:
            data = await websocket.receive_bytes()
            await manager.broadcast(data, doc_id, websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket, doc_id)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)