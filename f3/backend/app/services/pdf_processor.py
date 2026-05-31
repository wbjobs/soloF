import os
import tempfile
import numpy as np
import cv2
from typing import List, Dict, Tuple, Optional
from pdf2image import convert_from_path
from PIL import Image
from pypdf import PdfReader
import re
from app.services.math_ocr import math_ocr_service
from app.services.citation_processor import citation_processor


class PageLayout:
    SINGLE_COLUMN = 1
    TWO_COLUMN = 2


class PDFProcessor:
    def __init__(self):
        pass
    
    def process_pdf(self, pdf_path: str, task_id: str, update_progress=None) -> Dict:
        if update_progress:
            update_progress(10, "正在读取PDF文件...")
        
        pages = convert_from_path(pdf_path, dpi=200)
        reader = PdfReader(pdf_path)
        
        if update_progress:
            update_progress(20, f"检测到 {len(pages)} 页，开始处理...")
        
        all_text = []
        all_formulas = []
        full_text = ""
        
        for page_idx, (page_image, page_text) in enumerate(zip(pages, reader.pages)):
            if update_progress:
                progress = 20 + int((page_idx / len(pages)) * 40)
                update_progress(progress, f"正在处理第 {page_idx + 1}/{len(pages)} 页...")
            
            layout = self._detect_page_layout(page_image)
            
            text_with_lines = self._extract_text_with_positions(page_text, page_image)
            
            page_content = page_text.extract_text()
            full_text += page_content + "\n\n"
            
            formulas = self._detect_formulas(page_image, page_idx + 1, layout)
            
            if formulas:
                formula_images = []
                for formula in formulas:
                    x1, y1, x2, y2 = formula["bbox"]
                    formula_img = page_image.crop((x1, y1, x2, y2))
                    formula_images.append({
                        "image": formula_img,
                        "page": page_idx + 1,
                        "bbox": formula["bbox"],
                        "is_inline": formula["is_inline"],
                        "position": formula["position"],
                        "column": formula["column"]
                    })
                
                recognized_formulas = math_ocr_service.recognize_batch(formula_images)
                all_formulas.extend(recognized_formulas)
            
            all_text.append({
                "page": page_idx + 1,
                "content": page_content,
                "text_lines": text_with_lines,
                "layout": layout
            })
        
        if update_progress:
            update_progress(65, "正在生成Markdown...")
        
        markdown = self._generate_markdown(all_text, all_formulas)
        
        if update_progress:
            update_progress(75, "正在解析参考文献...")
        
        citation_result = citation_processor.process_text(full_text)
        references_section = citation_processor.generate_references_section(
            citation_result["all_citations"]
        )
        markdown += references_section
        
        citations_data = [
            {
                "raw_text": c.raw_text,
                "type": c.citation_type,
                "ref_number": c.ref_number,
                "author": c.author,
                "year": c.year,
                "doi": c.doi,
                "title": c.title,
                "authors": c.authors,
                "journal": c.journal,
                "bibtex": c.bibtex
            }
            for c in citation_result["all_citations"]
        ]
        
        if update_progress:
            update_progress(90, "正在保存结果...")
        
        return {
            "markdown": markdown,
            "formulas": all_formulas,
            "citations": citations_data,
            "citation_count": citation_result["count"],
            "citation_with_doi": citation_result["with_doi"],
            "pages_count": len(pages),
            "text_blocks": all_text
        }
    
    def _detect_page_layout(self, image: Image.Image) -> Dict:
        img_array = np.array(image)
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
        height, width = gray.shape
        
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        
        vertical_profile = np.sum(binary, axis=0)
        
        smoothed_profile = self._smooth_profile(vertical_profile, window_size=20)
        
        mid_point = width // 2
        search_range = width // 4
        left_search_start = max(0, mid_point - search_range)
        left_search_end = min(width, mid_point + search_range)
        
        min_valley = float('inf')
        valley_pos = mid_point
        
        for x in range(left_search_start, left_search_end):
            if smoothed_profile[x] < min_valley:
                min_valley = smoothed_profile[x]
                valley_pos = x
        
        left_half_sum = np.sum(smoothed_profile[:width//2])
        right_half_sum = np.sum(smoothed_profile[width//2:])
        
        avg_text_height = height * 0.05
        
        is_two_column = (
            min_valley < avg_text_height and
            abs(left_half_sum - right_half_sum) / max(left_half_sum, right_half_sum, 1) < 0.3
        )
        
        if is_two_column:
            return {
                "type": PageLayout.TWO_COLUMN,
                "column_boundary": valley_pos / width,
                "columns": [
                    {"left": 0, "right": valley_pos / width},
                    {"left": valley_pos / width, "right": 1.0}
                ]
            }
        else:
            return {
                "type": PageLayout.SINGLE_COLUMN,
                "column_boundary": None,
                "columns": [{"left": 0, "right": 1.0}]
            }
    
    def _smooth_profile(self, profile: np.ndarray, window_size: int = 5) -> np.ndarray:
        kernel = np.ones(window_size) / window_size
        return np.convolve(profile, kernel, mode='same')
    
    def _extract_text_with_positions(self, page_text, page_image: Image.Image) -> List[Dict]:
        lines = []
        width, height = page_image.size
        
        def visitor_body(text, cm, tm, font_dict, font_size):
            if text.strip():
                x = tm[4]
                y = tm[5]
                lines.append({
                    "text": text,
                    "x": x / width,
                    "y": 1 - (y / height),
                    "width": len(text) * font_size * 0.5 / width if font_size else 0,
                    "height": font_size / height if font_size else 0
                })
        
        try:
            page_text.extract_text(visitor_text=visitor_body)
        except:
            pass
        
        lines.sort(key=lambda l: (l["y"], l["x"]))
        return lines
    
    def _detect_formulas(self, image: Image.Image, page_num: int, layout: Dict) -> List[Dict]:
        img_array = np.array(image)
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
        height, width = gray.shape
        
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        
        kernel = np.ones((3, 3), np.uint8)
        dilated = cv2.dilate(binary, kernel, iterations=2)
        
        contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        formulas = []
        
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            
            aspect_ratio = w / h
            area = w * h
            fill_ratio = cv2.countNonZero(binary[y:y+h, x:x+w]) / area if area > 0 else 0
            
            is_formula = False
            is_inline = False
            
            if (100 < area < 50000 and 
                0.1 < aspect_ratio < 10 and
                0.1 < fill_ratio < 0.6):
                
                if h < 50 and aspect_ratio > 0.5:
                    is_inline = True
                    is_formula = True
                elif h >= 50:
                    is_formula = True
            
            if is_formula:
                center_x = (x + w / 2) / width
                column = self._get_column_index(center_x, layout)
                
                formulas.append({
                    "bbox": [x, y, x + w, y + h],
                    "is_inline": is_inline,
                    "position": {
                        "top": y / height,
                        "left": x / width,
                        "center_x": center_x,
                        "width": w / width,
                        "height": h / height
                    },
                    "column": column,
                    "page": page_num
                })
        
        formulas.sort(key=lambda f: (f["column"], f["position"]["top"], f["position"]["left"]))
        return formulas
    
    def _get_column_index(self, center_x: float, layout: Dict) -> int:
        if layout["type"] == PageLayout.SINGLE_COLUMN:
            return 0
        
        columns = layout["columns"]
        for i, col in enumerate(columns):
            if col["left"] <= center_x < col["right"]:
                return i
        
        return 0
    
    def _generate_markdown(self, text_blocks: List[Dict], formulas: List[Dict]) -> str:
        markdown_parts = []
        
        for text_block in text_blocks:
            content = text_block["content"]
            page_num = text_block["page"]
            layout = text_block["layout"]
            
            page_formulas = [f for f in formulas if f["page"] == page_num]
            
            if page_formulas:
                content = self._inject_formulas_by_column(
                    content, 
                    page_formulas, 
                    layout,
                    text_block.get("text_lines", [])
                )
            
            lines = content.split('\n')
            formatted_lines = []
            
            for line in lines:
                stripped = line.strip()
                if stripped:
                    if len(stripped) < 100 and stripped.isupper():
                        formatted_lines.append(f"## {stripped}")
                    elif stripped.startswith(('1.', '2.', '3.', '•', '-')):
                        formatted_lines.append(stripped)
                    else:
                        formatted_lines.append(stripped)
                else:
                    formatted_lines.append('')
            
            markdown_parts.append('\n'.join(formatted_lines))
        
        return '\n\n'.join(markdown_parts)
    
    def _inject_formulas_by_column(self, content: str, formulas: List[Dict], layout: Dict, text_lines: List[Dict]) -> str:
        if layout["type"] == PageLayout.SINGLE_COLUMN:
            return self._inject_formulas_single_column(content, formulas)
        else:
            return self._inject_formulas_two_columns(content, formulas, layout)
    
    def _inject_formulas_single_column(self, content: str, formulas: List[Dict]) -> str:
        formulas_sorted = sorted(formulas, key=lambda f: (f["position"]["top"], f["position"]["left"]))
        
        lines = content.split('\n')
        result_lines = []
        
        formula_idx = 0
        total_lines = len(lines)
        
        for i, line in enumerate(lines):
            line_pos = i / max(total_lines, 1)
            
            formulas_in_line = []
            while (formula_idx < len(formulas_sorted) and
                   abs(formulas_sorted[formula_idx]["position"]["top"] - line_pos) < 0.08):
                formulas_in_line.append(formulas_sorted[formula_idx])
                formula_idx += 1
            
            if formulas_in_line:
                new_line = line
                for formula in formulas_in_line:
                    latex = formula["latex"] or "formula"
                    if formula["is_inline"]:
                        new_line += f" ${latex}$"
                    else:
                        new_line += f"\n\n$$\n{latex}\n$$\n\n"
                result_lines.append(new_line)
            else:
                result_lines.append(line)
        
        return '\n'.join(result_lines)
    
    def _inject_formulas_two_columns(self, content: str, formulas: List[Dict], layout: Dict) -> str:
        boundary = layout["column_boundary"]
        
        left_formulas = [f for f in formulas if f["column"] == 0]
        right_formulas = [f for f in formulas if f["column"] == 1]
        
        lines = content.split('\n')
        total_lines = len(lines)
        
        left_formulas_sorted = sorted(left_formulas, key=lambda f: (f["position"]["top"], f["position"]["left"]))
        right_formulas_sorted = sorted(right_formulas, key=lambda f: (f["position"]["top"], f["position"]["left"]))
        
        result_lines = []
        left_formula_idx = 0
        right_formula_idx = 0
        
        for i, line in enumerate(lines):
            line_pos = i / max(total_lines, 1)
            
            formulas_in_line = []
            
            while (left_formula_idx < len(left_formulas_sorted) and
                   abs(left_formulas_sorted[left_formula_idx]["position"]["top"] - line_pos) < 0.08):
                formulas_in_line.append(left_formulas_sorted[left_formula_idx])
                left_formula_idx += 1
            
            while (right_formula_idx < len(right_formulas_sorted) and
                   abs(right_formulas_sorted[right_formula_idx]["position"]["top"] - line_pos) < 0.08):
                formulas_in_line.append(right_formulas_sorted[right_formula_idx])
                right_formula_idx += 1
            
            if formulas_in_line:
                new_line = line
                
                inline_formulas = [f for f in formulas_in_line if f["is_inline"]]
                block_formulas = [f for f in formulas_in_line if not f["is_inline"]]
                
                if inline_formulas:
                    inline_text = " ".join([f"${f['latex']}$" for f in inline_formulas])
                    if inline_formulas[0]["column"] == 0:
                        new_line = f"[左栏公式] {inline_text} {new_line}"
                    else:
                        new_line = f"{new_line} [右栏公式] {inline_text}"
                
                for formula in block_formulas:
                    col_note = "<!-- 左栏公式 -->" if formula["column"] == 0 else "<!-- 右栏公式 -->"
                    new_line += f"\n\n{col_note}\n$$\n{formula['latex']}\n$$\n\n"
                
                result_lines.append(new_line)
            else:
                result_lines.append(line)
        
        return '\n'.join(result_lines)


pdf_processor = PDFProcessor()