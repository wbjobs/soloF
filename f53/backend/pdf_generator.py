from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, red, green, grey, black
from reportlab.lib.units import inch, cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    ListFlowable, ListItem, KeepTogether
)
from reportlab.pdfgen import canvas
from reportlab.lib.enums import TA_LEFT, TA_JUSTIFY
from typing import List, Dict, Optional
import io
from datetime import datetime

class RedlinePDFGenerator:
    def __init__(self):
        self.styles = getSampleStyleSheet()
        self._init_custom_styles()
    
    def _init_custom_styles(self):
        self.title_style = ParagraphStyle(
            'RedlineTitle',
            parent=self.styles['Heading1'],
            fontSize=18,
            textColor=black,
            spaceAfter=20,
            alignment=TA_LEFT
        )
        
        self.subtitle_style = ParagraphStyle(
            'RedlineSubtitle',
            parent=self.styles['Normal'],
            fontSize=10,
            textColor=grey,
            spaceAfter=15
        )
        
        self.normal_style = ParagraphStyle(
            'RedlineNormal',
            parent=self.styles['Normal'],
            fontSize=11,
            leading=16,
            alignment=TA_JUSTIFY,
            spaceAfter=8
        )
        
        self.insert_style = ParagraphStyle(
            'RedlineInsert',
            parent=self.styles['Normal'],
            fontSize=11,
            leading=16,
            textColor=HexColor('#006400'),
            backColor=HexColor('#e6f9e6'),
            alignment=TA_JUSTIFY,
            spaceAfter=8
        )
        
        self.delete_style = ParagraphStyle(
            'RedlineDelete',
            parent=self.styles['Normal'],
            fontSize=11,
            leading=16,
            textColor=HexColor('#8B0000'),
            backColor=HexColor('#ffe6e6'),
            strike=True,
            alignment=TA_JUSTIFY,
            spaceAfter=8
        )
        
        self.heading1_style = ParagraphStyle(
            'RedlineH1',
            parent=self.styles['Heading1'],
            fontSize=16,
            textColor=black,
            spaceBefore=15,
            spaceAfter=10
        )
        
        self.heading2_style = ParagraphStyle(
            'RedlineH2',
            parent=self.styles['Heading2'],
            fontSize=14,
            textColor=black,
            spaceBefore=12,
            spaceAfter=8
        )
        
        self.heading3_style = ParagraphStyle(
            'RedlineH3',
            parent=self.styles['Heading3'],
            fontSize=12,
            textColor=black,
            spaceBefore=10,
            spaceAfter=6
        )
        
        self.comment_style = ParagraphStyle(
            'CommentStyle',
            parent=self.styles['Normal'],
            fontSize=9,
            textColor=HexColor('#666666'),
            leftIndent=20,
            rightIndent=20,
            spaceAfter=6,
            backColor=HexColor('#fffbe6'),
            borderPadding=6
        )
    
    def _add_page_header(self, canvas_obj, doc):
        canvas_obj.saveState()
        
        canvas_obj.setFont('Helvetica-Bold', 10)
        canvas_obj.drawString(1 * inch, A4[1] - 0.5 * inch, "法律合同 - 修订模式")
        
        canvas_obj.setFont('Helvetica', 8)
        canvas_obj.setFillColor(grey)
        canvas_obj.drawRightString(A4[0] - 1 * inch, A4[1] - 0.5 * inch, 
                                 f"生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        canvas_obj.setStrokeColor(HexColor('#cccccc'))
        canvas_obj.setLineWidth(0.5)
        canvas_obj.line(1 * inch, A4[1] - 0.6 * inch, A4[0] - 1 * inch, A4[1] - 0.6 * inch)
        
        canvas_obj.restoreState()
    
    def _add_page_footer(self, canvas_obj, doc):
        canvas_obj.saveState()
        
        canvas_obj.setFont('Helvetica', 8)
        canvas_obj.setFillColor(grey)
        canvas_obj.drawString(1 * inch, 0.5 * inch, "机密文档 - 仅供授权人员查阅")
        
        page_num = canvas_obj.getPageNumber()
        canvas_obj.drawRightString(A4[0] - 1 * inch, 0.5 * inch, f"第 {page_num} 页")
        
        canvas_obj.restoreState()
    
    def generate_redline_pdf(self, document_title: str, 
                            line_changes: List[Dict],
                            summary: Dict,
                            comments: Optional[List[Dict]] = None,
                            old_version: Optional[str] = None,
                            new_version: Optional[str] = None) -> bytes:
        buffer = io.BytesIO()
        
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            leftMargin=1 * inch,
            rightMargin=1 * inch,
            topMargin=0.8 * inch,
            bottomMargin=0.8 * inch,
            title=f"{document_title} - 修订版本",
            author="法律合同协同编辑平台"
        )
        
        story = []
        
        story.append(Paragraph("法律合同修订对比", self.title_style))
        story.append(Paragraph(f"文档名称: {document_title}", self.subtitle_style))
        if old_version and new_version:
            story.append(Paragraph(f"对比版本: 版本 {old_version} → 版本 {new_version}", self.subtitle_style))
        
        story.append(self._create_summary_table(summary))
        story.append(Spacer(1, 20))
        
        story.append(Paragraph("修订详情", self.heading2_style))
        story.append(Spacer(1, 10))
        
        for line_change in line_changes:
            paragraph = self._process_line_change(line_change)
            if paragraph:
                story.append(paragraph)
        
        if comments:
            story.append(PageBreak())
            story.append(Paragraph("评论列表", self.heading2_style))
            story.append(Spacer(1, 10))
            for comment in comments:
                story.append(self._create_comment_item(comment))
                story.append(Spacer(1, 6))
        
        doc.build(story, onFirstPage=self._add_page_header, onLaterPages=self._add_page_header)
        
        return buffer.getvalue()
    
    def _create_summary_table(self, summary: Dict) -> Table:
        data = [
            ['修订摘要', '', ''],
            ['总变更数', str(summary.get('total_changes', 0)), '处'],
            ['新增内容', str(summary.get('insertions', 0)), '处'],
            ['删除内容', str(summary.get('deletions', 0)), '处'],
            ['新增字符', str(summary.get('inserted_chars', 0)), '字'],
            ['删除字符', str(summary.get('deleted_chars', 0)), '字']
        ]
        
        table = Table(data, colWidths=[2 * inch, 1.5 * inch, 1 * inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), HexColor('#f0f0f0')),
            ('SPAN', (0, 0), (-1, 0)),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 12),
            ('ALIGN', (0, 0), (-1, 0), 'LEFT'),
            ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#cccccc')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [HexColor('#fafafa'), HexColor('#ffffff')]),
            ('FONTSIZE', (0, 1), (-1, -1), 10),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('RIGHTPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6)
        ]))
        
        return table
    
    def _process_line_change(self, line_change: Dict) -> Optional[Paragraph]:
        line_type = line_change.get('type')
        content = line_change.get('content', '')
        line_number = line_change.get('line_number', 0)
        
        if not content.strip():
            return Paragraph(f"<font color='#999999'>[行 {line_number}] 空行</font>", self.normal_style)
        
        escaped_content = self._escape_html(content)
        
        if line_type == 'insert':
            prefix = f"<font color='#006400'>[行 {line_number}] [新增]</font> "
            return Paragraph(f"{prefix}<font color='#006400' backcolor='#e6f9e6'>{escaped_content}</font>", self.normal_style)
        elif line_type == 'delete':
            prefix = f"<font color='#8B0000'>[行 {line_number}] [删除]</font> "
            return Paragraph(f"{prefix}<strike><font color='#8B0000' backcolor='#ffe6e6'>{escaped_content}</font></strike>", self.normal_style)
        else:
            prefix = f"<font color='#999999'>[行 {line_number}]</font> "
            return Paragraph(f"{prefix}{escaped_content}", self.normal_style)
    
    def _create_comment_item(self, comment: Dict) -> Paragraph:
        author = comment.get('author', '未知')
        content = comment.get('content', '')
        created_at = comment.get('created_at', '')
        
        header = f"<b>{author}</b> <font color='#999999'>{created_at}</font>"
        return Paragraph(f"{header}<br/>{self._escape_html(content)}", self.comment_style)
    
    def _escape_html(self, text: str) -> str:
        return (text.replace('&', '&amp;')
                    .replace('<', '&lt;')
                    .replace('>', '&gt;'))
    
    def generate_simple_pdf(self, title: str, content: str) -> bytes:
        buffer = io.BytesIO()
        
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            leftMargin=1 * inch,
            rightMargin=1 * inch,
            topMargin=0.8 * inch,
            bottomMargin=0.8 * inch
        )
        
        story = []
        story.append(Paragraph(title, self.title_style))
        story.append(Spacer(1, 20))
        
        for line in content.split('\n'):
            if line.strip():
                story.append(Paragraph(self._escape_html(line), self.normal_style))
            else:
                story.append(Spacer(1, 12))
        
        doc.build(story, onFirstPage=self._add_page_header, onLaterPages=self._add_page_header)
        
        return buffer.getvalue()