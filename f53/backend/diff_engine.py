from diff_match_patch import diff_match_patch
from typing import List, Tuple, Dict, Optional
import re

class DiffChange:
    INSERT = 'insert'
    DELETE = 'delete'
    EQUAL = 'equal'
    
    def __init__(self, change_type: str, text: str, start_pos: int, end_pos: int):
        self.change_type = change_type
        self.text = text
        self.start_pos = start_pos
        self.end_pos = end_pos

class RedlineDiff:
    def __init__(self):
        self.dmp = diff_match_patch()
    
    def compute_diff(self, old_text: str, new_text: str) -> List[DiffChange]:
        patches = self.dmp.diff_main(old_text, new_text)
        self.dmp.diff_cleanupSemantic(patches)
        
        changes = []
        old_pos = 0
        new_pos = 0
        
        for op, text in patches:
            if op == self.dmp.DIFF_EQUAL:
                changes.append(DiffChange(DiffChange.EQUAL, text, old_pos, old_pos + len(text)))
                old_pos += len(text)
                new_pos += len(text)
            elif op == self.dmp.DIFF_DELETE:
                changes.append(DiffChange(DiffChange.DELETE, text, old_pos, old_pos + len(text)))
                old_pos += len(text)
            elif op == self.dmp.DIFF_INSERT:
                changes.append(DiffChange(DiffChange.INSERT, text, new_pos, new_pos + len(text)))
                new_pos += len(text)
        
        return changes
    
    def group_changes_by_line(self, changes: List[DiffChange], old_text: str, new_text: str) -> List[Dict]:
        old_lines = old_text.split('\n')
        new_lines = new_text.split('\n')
        
        line_changes = []
        old_line_idx = 0
        new_line_idx = 0
        old_char_count = 0
        new_char_count = 0
        
        i = 0
        while i < len(changes):
            change = changes[i]
            
            if change.change_type == DiffChange.EQUAL:
                lines_in_change = change.text.count('\n')
                for _ in range(lines_in_change):
                    if old_line_idx < len(old_lines):
                        line_changes.append({
                            'type': 'equal',
                            'line_number': old_line_idx + 1,
                            'content': old_lines[old_line_idx],
                            'changes': []
                        })
                        old_line_idx += 1
                        new_line_idx += 1
                
                old_char_count += len(change.text)
                new_char_count += len(change.text)
                
            elif change.change_type == DiffChange.DELETE:
                delete_lines = change.text.split('\n')
                for j, line_content in enumerate(delete_lines):
                    if line_content or j < len(delete_lines) - 1:
                        line_changes.append({
                            'type': 'delete',
                            'line_number': old_line_idx + 1,
                            'content': line_content,
                            'changes': [{'type': 'delete', 'text': line_content}]
                        })
                        old_line_idx += 1
                old_char_count += len(change.text)
                
            elif change.change_type == DiffChange.INSERT:
                insert_lines = change.text.split('\n')
                for j, line_content in enumerate(insert_lines):
                    if line_content or j < len(insert_lines) - 1:
                        line_changes.append({
                            'type': 'insert',
                            'line_number': new_line_idx + 1,
                            'content': line_content,
                            'changes': [{'type': 'insert', 'text': line_content}]
                        })
                        new_line_idx += 1
                new_char_count += len(change.text)
            
            i += 1
        
        while old_line_idx < len(old_lines):
            line_changes.append({
                'type': 'equal',
                'line_number': old_line_idx + 1,
                'content': old_lines[old_line_idx],
                'changes': []
            })
            old_line_idx += 1
        
        while new_line_idx < len(new_lines):
            line_changes.append({
                'type': 'insert',
                'line_number': new_line_idx + 1,
                'content': new_lines[new_line_idx],
                'changes': [{'type': 'insert', 'text': new_lines[new_line_idx]}]
            })
            new_line_idx += 1
        
        return line_changes
    
    def get_change_summary(self, changes: List[DiffChange]) -> Dict:
        insert_count = sum(1 for c in changes if c.change_type == DiffChange.INSERT)
        delete_count = sum(1 for c in changes if c.change_type == DiffChange.DELETE)
        insert_chars = sum(len(c.text) for c in changes if c.change_type == DiffChange.INSERT)
        delete_chars = sum(len(c.text) for c in changes if c.change_type == DiffChange.DELETE)
        
        return {
            'total_changes': insert_count + delete_count,
            'insertions': insert_count,
            'deletions': delete_count,
            'inserted_chars': insert_chars,
            'deleted_chars': delete_chars
        }
    
    def generate_html_diff(self, old_text: str, new_text: str) -> str:
        changes = self.compute_diff(old_text, new_text)
        
        html_parts = []
        for change in changes:
            escaped_text = self._escape_html(change.text)
            
            if change.change_type == DiffChange.INSERT:
                html_parts.append(f'<ins class="redline-insert">{escaped_text}</ins>')
            elif change.change_type == DiffChange.DELETE:
                html_parts.append(f'<del class="redline-delete">{escaped_text}</del>')
            else:
                html_parts.append(escaped_text)
        
        return ''.join(html_parts)
    
    def _escape_html(self, text: str) -> str:
        return (text.replace('&', '&amp;')
                    .replace('<', '&lt;')
                    .replace('>', '&gt;')
                    .replace('\n', '<br/>'))
    
    def extract_text_from_html(self, html_content: str) -> str:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html_content, 'lxml')
        return soup.get_text(separator='\n', strip=True)