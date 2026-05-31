class PDFRenderer {
  constructor() {
    this.canvas = document.getElementById('pdfCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.statusEl = document.getElementById('status');
    this.pageInfoEl = document.getElementById('pageInfo');
    this.currentPage = 0;
    this.totalPages = 0;
    this.zoom = 1.0;
    this.pdfData = null;
    this.wasmModule = null;
    this.pageCache = new LRUCache(10);
    this.initEvents();
    this.loadWASM();
  }

  initEvents() {
    document.getElementById('openBtn').addEventListener('click', () => this.openFile());
    document.getElementById('prevBtn').addEventListener('click', () => this.prevPage());
    document.getElementById('nextBtn').addEventListener('click', () => this.nextPage());
    document.getElementById('zoomIn').addEventListener('click', () => this.zoomIn());
    document.getElementById('zoomOut').addEventListener('click', () => this.zoomOut());
    document.getElementById('extractTextBtn').addEventListener('click', () => this.extractText());
  }

  async loadWASM() {
    this.updateStatus('加载WASM模块...');
    try {
      const script = document.createElement('script');
      script.src = 'src/cpp/build/pdf_renderer.js';
      script.onload = async () => {
        if (typeof Module !== 'undefined') {
          this.wasmModule = await Module();
          this.updateStatus('WASM模块加载完成');
        } else {
          this.updateStatus('WASM模块加载失败 - Module未定义');
        }
      };
      script.onerror = () => {
        this.updateStatus('WASM模块加载失败，请先运行 npm run build:wasm');
      };
      document.body.appendChild(script);
    } catch (e) {
      this.updateStatus('WASM加载失败: ' + e.message);
    }
  }

  async openFile() {
    const result = await window.electronAPI.openFile();
    if (result.success) {
      this.loadPDF(result.data, result.fileName);
    }
  }

  loadPDF(dataArray, fileName) {
    this.pdfData = new Uint8Array(dataArray);
    this.fileName = fileName;
    this.pageCache.clear();
    
    const dataPtr = this.wasmModule._malloc(this.pdfData.length);
    this.wasmModule.HEAPU8.set(this.pdfData, dataPtr);
    
    const parserPtr = this.wasmModule._create_pdf_parser(dataPtr, this.pdfData.length);
    this.wasmModule._free(dataPtr);
    
    if (parserPtr === 0) {
      this.updateStatus('PDF解析失败');
      return;
    }
    
    this.parserPtr = parserPtr;
    this.totalPages = this.wasmModule._get_page_count(parserPtr);
    this.currentPage = 0;
    
    this.updatePageInfo();
    this.updateControls();
    this.renderPage(this.currentPage);
    this.updateStatus(`已加载: ${fileName} (${this.totalPages}页)`);
  }

  renderPage(pageIndex) {
    if (this.pageCache.has(pageIndex)) {
      const cached = this.pageCache.get(pageIndex);
      this.drawCachedPage(cached);
      return;
    }

    this.updateStatus(`渲染第 ${pageIndex + 1} 页...`);
    
    const pagePtr = this.wasmModule._get_page(this.parserPtr, pageIndex);
    if (pagePtr === 0) {
      this.updateStatus('页面加载失败');
      return;
    }

    const width = this.wasmModule._get_page_width(pagePtr);
    const height = this.wasmModule._get_page_height(pagePtr);
    
    this.canvas.width = width * this.zoom;
    this.canvas.height = height * this.zoom;
    
    this.ctx.fillStyle = 'white';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    this.renderPaths(pagePtr);
    this.renderText(pagePtr);
    
    this.pageCache.put(pageIndex, {
      width: this.canvas.width,
      height: this.canvas.height,
      imageData: this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)
    });

    this.wasmModule._free_page(pagePtr);
    this.updateStatus(`第 ${pageIndex + 1} 页渲染完成`);
  }

  renderPaths(pagePtr) {
    const pathCount = this.wasmModule._get_path_count(pagePtr);
    
    for (let i = 0; i < pathCount; i++) {
      const pathPtr = this.wasmModule._get_path(pagePtr, i);
      if (pathPtr === 0) continue;

      this.ctx.save();
      this.ctx.scale(this.zoom, this.zoom);
      
      const fillType = this.wasmModule._get_path_fill_type(pathPtr);
      
      if (fillType === 1) {
        const color = this.wasmModule._get_path_fill_color(pathPtr);
        const r = (color >> 16) & 0xff;
        const g = (color >> 8) & 0xff;
        const b = color & 0xff;
        this.ctx.fillStyle = `rgb(${r},${g},${b})`;
      } else if (fillType === 2) {
        const gradPtr = this.wasmModule._get_path_gradient(pathPtr);
        if (gradPtr !== 0) {
          this.ctx.fillStyle = this.createGradient(gradPtr);
        }
      }
      
      this.ctx.strokeStyle = 'black';
      this.ctx.lineWidth = this.wasmModule._get_path_line_width(pathPtr);
      
      this.buildPath(pathPtr);
      
      const pathMode = this.wasmModule._get_path_mode(pathPtr);
      if (pathMode === 0) {
        this.ctx.fill();
      } else if (pathMode === 1) {
        this.ctx.stroke();
      } else if (pathMode === 2) {
        this.ctx.fill();
        this.ctx.stroke();
      }
      
      this.wasmModule._free_path(pathPtr);
      this.ctx.restore();
    }
  }

  buildPath(pathPtr) {
    const pointCount = this.wasmModule._get_path_point_count(pathPtr);
    this.ctx.beginPath();
    
    for (let i = 0; i < pointCount; i++) {
      const type = this.wasmModule._get_path_point_type(pathPtr, i);
      
      if (type === 0) {
        const x = this.wasmModule._get_path_point_x(pathPtr, i);
        const y = this.wasmModule._get_path_point_y(pathPtr, i);
        this.ctx.moveTo(x, y);
      } else if (type === 1) {
        const x = this.wasmModule._get_path_point_x(pathPtr, i);
        const y = this.wasmModule._get_path_point_y(pathPtr, i);
        this.ctx.lineTo(x, y);
      } else if (type === 2) {
        const cp1x = this.wasmModule._get_bezier_cp1x(pathPtr, i);
        const cp1y = this.wasmModule._get_bezier_cp1y(pathPtr, i);
        const cp2x = this.wasmModule._get_bezier_cp2x(pathPtr, i);
        const cp2y = this.wasmModule._get_bezier_cp2y(pathPtr, i);
        const x = this.wasmModule._get_path_point_x(pathPtr, i);
        const y = this.wasmModule._get_path_point_y(pathPtr, i);
        this.ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
      } else if (type === 3) {
        this.ctx.closePath();
      }
    }
  }

  createGradient(gradPtr) {
    const type = this.wasmModule._get_gradient_type(gradPtr);
    const x1 = this.wasmModule._get_gradient_x1(gradPtr);
    const y1 = this.wasmModule._get_gradient_y1(gradPtr);
    const x2 = this.wasmModule._get_gradient_x2(gradPtr);
    const y2 = this.wasmModule._get_gradient_y2(gradPtr);
    
    let gradient;
    if (type === 0) {
      gradient = this.ctx.createLinearGradient(x1, y1, x2, y2);
    } else {
      const r1 = this.wasmModule._get_gradient_r1(gradPtr);
      const r2 = this.wasmModule._get_gradient_r2(gradPtr);
      gradient = this.ctx.createRadialGradient(x1, y1, r1, x2, y2, r2);
    }
    
    const stopCount = this.wasmModule._get_gradient_stop_count(gradPtr);
    for (let i = 0; i < stopCount; i++) {
      const offset = this.wasmModule._get_gradient_stop_offset(gradPtr, i);
      const color = this.wasmModule._get_gradient_stop_color(gradPtr, i);
      const r = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const b = color & 0xff;
      const a = ((color >> 24) & 0xff) / 255;
      gradient.addColorStop(offset, `rgba(${r},${g},${b},${a})`);
    }
    
    return gradient;
  }

  renderText(pagePtr) {
    const textCount = this.wasmModule._get_text_count(pagePtr);
    
    for (let i = 0; i < textCount; i++) {
      const textPtr = this.wasmModule._get_text_item(pagePtr, i);
      if (textPtr === 0) continue;

      this.ctx.save();
      this.ctx.scale(this.zoom, this.zoom);
      
      const textStrPtr = this.wasmModule._get_text_content(textPtr);
      const text = this.wasmModule.UTF8ToString(textStrPtr);
      
      const x = this.wasmModule._get_text_x(textPtr);
      const y = this.wasmModule._get_text_y(textPtr);
      const fontSize = this.wasmModule._get_text_font_size(textPtr);
      const color = this.wasmModule._get_text_color(textPtr);
      
      const r = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const b = color & 0xff;
      
      this.ctx.fillStyle = `rgb(${r},${g},${b})`;
      this.ctx.font = `${fontSize}px Arial`;
      this.ctx.textBaseline = 'alphabetic';
      this.ctx.letterSpacing = '0px';
      this.ctx.textRendering = 'geometricPrecision';
      
      this.ctx.fillText(text, x, y);
      
      this.wasmModule._free_text_item(textPtr);
      this.ctx.restore();
    }
  }

  extractText() {
    let allText = '';
    for (let i = 0; i < this.totalPages; i++) {
      const pagePtr = this.wasmModule._get_page(this.parserPtr, i);
      if (pagePtr === 0) continue;
      
      const textCount = this.wasmModule._get_text_count(pagePtr);
      for (let j = 0; j < textCount; j++) {
        const textPtr = this.wasmModule._get_text_item(pagePtr, j);
        if (textPtr === 0) continue;
        
        const textStrPtr = this.wasmModule._get_text_content(textPtr);
        const text = this.wasmModule.UTF8ToString(textStrPtr);
        allText += text + ' ';
        
        this.wasmModule._free_text_item(textPtr);
      }
      allText += '\n\n';
      this.wasmModule._free_page(pagePtr);
    }
    
    const baseName = this.fileName.replace('.pdf', '');
    window.electronAPI.saveText(allText, baseName + '_text.txt');
    this.updateStatus('文本提取完成');
  }

  drawCachedPage(cached) {
    this.canvas.width = cached.width;
    this.canvas.height = cached.height;
    this.ctx.putImageData(cached.imageData, 0, 0);
  }

  prevPage() {
    if (this.currentPage > 0) {
      this.currentPage--;
      this.renderPage(this.currentPage);
      this.updatePageInfo();
    }
  }

  nextPage() {
    if (this.currentPage < this.totalPages - 1) {
      this.currentPage++;
      this.renderPage(this.currentPage);
      this.updatePageInfo();
    }
  }

  zoomIn() {
    if (this.zoom < 3.0) {
      this.zoom += 0.25;
      this.pageCache.clear();
      this.renderPage(this.currentPage);
      this.updateZoom();
    }
  }

  zoomOut() {
    if (this.zoom > 0.25) {
      this.zoom -= 0.25;
      this.pageCache.clear();
      this.renderPage(this.currentPage);
      this.updateZoom();
    }
  }

  updatePageInfo() {
    this.pageInfoEl.textContent = `${this.currentPage + 1} / ${this.totalPages}`;
  }

  updateZoom() {
    document.getElementById('zoomLevel').value = Math.round(this.zoom * 100);
  }

  updateControls() {
    document.getElementById('prevBtn').disabled = this.totalPages === 0;
    document.getElementById('nextBtn').disabled = this.totalPages === 0;
    document.getElementById('extractTextBtn').disabled = this.totalPages === 0;
  }

  updateStatus(text) {
    this.statusEl.textContent = text;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PDFRenderer();
});
