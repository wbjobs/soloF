import sqlite3
import json
from datetime import datetime
from typing import Optional, List, Dict

class VersionManager:
    def __init__(self, db_path: str = 'legal_contract.db'):
        self.db_path = db_path
        self._init_version_table()
    
    def _init_version_table(self):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
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
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_doc_version 
            ON document_versions(document_id, version_number DESC)
        ''')
        
        conn.commit()
        conn.close()
    
    def create_version(self, document_id: str, content: str, ydoc_state: bytes, 
                       created_by: str, comment: str = '') -> str:
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute(
            "SELECT COALESCE(MAX(version_number), 0) FROM document_versions WHERE document_id = ?",
            (document_id,)
        )
        next_version = (cursor.fetchone()[0] or 0) + 1
        
        import uuid
        version_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        
        cursor.execute('''
            INSERT INTO document_versions 
            (id, document_id, version_number, content, ydoc_state, created_by, created_at, comment)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (version_id, document_id, next_version, content, ydoc_state, created_by, now, comment))
        
        conn.commit()
        conn.close()
        
        return version_id
    
    def get_version(self, version_id: str) -> Optional[Dict]:
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, document_id, version_number, content, created_by, created_at, comment
            FROM document_versions WHERE id = ?
        ''', (version_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return {
                'id': row[0],
                'document_id': row[1],
                'version_number': row[2],
                'content': row[3],
                'created_by': row[4],
                'created_at': row[5],
                'comment': row[6]
            }
        return None
    
    def get_latest_version(self, document_id: str) -> Optional[Dict]:
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, document_id, version_number, content, created_by, created_at, comment
            FROM document_versions 
            WHERE document_id = ?
            ORDER BY version_number DESC
            LIMIT 1
        ''', (document_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return {
                'id': row[0],
                'document_id': row[1],
                'version_number': row[2],
                'content': row[3],
                'created_by': row[4],
                'created_at': row[5],
                'comment': row[6]
            }
        return None
    
    def get_document_versions(self, document_id: str) -> List[Dict]:
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, document_id, version_number, content, created_by, created_at, comment
            FROM document_versions 
            WHERE document_id = ?
            ORDER BY version_number DESC
        ''', (document_id,))
        
        rows = cursor.fetchall()
        conn.close()
        
        return [{
            'id': row[0],
            'document_id': row[1],
            'version_number': row[2],
            'content': row[3],
            'created_by': row[4],
            'created_at': row[5],
            'comment': row[6]
        } for row in rows]
    
    def get_version_by_number(self, document_id: str, version_number: int) -> Optional[Dict]:
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, document_id, version_number, content, created_by, created_at, comment
            FROM document_versions 
            WHERE document_id = ? AND version_number = ?
        ''', (document_id, version_number))
        
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return {
                'id': row[0],
                'document_id': row[1],
                'version_number': row[2],
                'content': row[3],
                'created_by': row[4],
                'created_at': row[5],
                'comment': row[6]
            }
        return None