import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { v4 as uuidv4 } from 'uuid';

const TOOLS = {
  PEN: 'pen',
  RECTANGLE: 'rectangle',
  CIRCLE: 'circle',
  TEXT: 'text',
  SELECT: 'select',
  AI_SELECT: 'ai_select'
};

const Whiteboard = forwardRef(({ 
  shapes, 
  onDraw, 
  onMove,
  onAISelection,
  tool = TOOLS.PEN, 
  color = '#000000', 
  strokeWidth = 2,
  isViewMode = false,
  aiSelection
}, ref) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [previewShape, setPreviewShape] = useState(null);
  const [textInput, setTextInput] = useState({ show: false, x: 0, y: 0, value: '' });
  
  const [selectedShapeId, setSelectedShapeId] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  
  const [aiSelectionRect, setAiSelectionRect] = useState(null);
  const [isAiSelecting, setIsAiSelecting] = useState(false);
  const [imageCache, setImageCache] = useState({});

  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
    captureRegion: (x, y, width, height) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(canvas, x, y, width, height, 0, 0, width, height);
      return tempCanvas.toDataURL('image/png');
    }
  }));

  const getCoords = useCallback((e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }, []);

  const hitTest = useCallback((x, y, shape) => {
    const { type, data } = shape;
    const tolerance = 10;

    switch (type) {
      case 'rectangle': {
        const minX = Math.min(data.x1, data.x2) - tolerance;
        const maxX = Math.max(data.x1, data.x2) + tolerance;
        const minY = Math.min(data.y1, data.y2) - tolerance;
        const maxY = Math.max(data.y1, data.y2) + tolerance;
        return x >= minX && x <= maxX && y >= minY && y <= maxY;
      }
      case 'circle': {
        const centerX = (data.x1 + data.x2) / 2;
        const centerY = (data.y1 + data.y2) / 2;
        const radiusX = Math.abs(data.x2 - data.x1) / 2 + tolerance;
        const radiusY = Math.abs(data.y2 - data.y1) / 2 + tolerance;
        const normalizedX = (x - centerX) / radiusX;
        const normalizedY = (y - centerY) / radiusY;
        return (normalizedX * normalizedX + normalizedY * normalizedY) <= 1;
      }
      case 'pen': {
        if (!data.points) return false;
        for (let i = 0; i < data.points.length; i++) {
          const pt = data.points[i];
          const dist = Math.sqrt((x - pt.x) ** 2 + (y - pt.y) ** 2);
          if (dist < tolerance + data.strokeWidth) return true;
        }
        return false;
      }
      case 'text': {
        const textWidth = data.text ? data.text.length * 10 : 50;
        const textHeight = data.fontSize || 16;
        return x >= data.x - tolerance && 
               x <= data.x + textWidth + tolerance &&
               y >= data.y - textHeight - tolerance && 
               y <= data.y + tolerance;
      }
      case 'image': {
        return x >= data.x && x <= data.x + data.width &&
               y >= data.y && y <= data.y + data.height;
      }
      default:
        return false;
    }
  }, []);

  const getShapeAtPosition = useCallback((x, y) => {
    for (let i = shapes.length - 1; i >= 0; i--) {
      if (hitTest(x, y, shapes[i])) {
        return shapes[i];
      }
    }
    return null;
  }, [shapes, hitTest]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    shapes.forEach(shape => {
      drawOperation(ctx, shape, shape.data.shapeId === selectedShapeId);
    });
    
    if (previewShape) {
      drawPreview(ctx, previewShape);
    }

    if (isDragging && selectedShapeId) {
      const shape = shapes.find(s => s.data.shapeId === selectedShapeId);
      if (shape) {
        const deltaX = startPos.x - dragStartPos.x;
        const deltaY = startPos.y - dragStartPos.y;
        ctx.save();
        ctx.globalAlpha = 0.5;
        drawDraggingPreview(ctx, shape, deltaX, deltaY);
        ctx.restore();
      }
    }

    if (aiSelectionRect || aiSelection) {
      const rect = aiSelectionRect || aiSelection;
      if (rect) {
        ctx.save();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 4]);
        ctx.strokeRect(
          Math.min(rect.x1, rect.x2),
          Math.min(rect.y1, rect.y2),
          Math.abs(rect.x2 - rect.x1),
          Math.abs(rect.y2 - rect.y1)
        );
        
        ctx.fillStyle = 'rgba(16, 185, 129, 0.1)';
        ctx.fillRect(
          Math.min(rect.x1, rect.x2),
          Math.min(rect.y1, rect.y2),
          Math.abs(rect.x2 - rect.x1),
          Math.abs(rect.y2 - rect.y1)
        );
        
        const centerX = (rect.x1 + rect.x2) / 2;
        const centerY = Math.min(rect.y1, rect.y2) - 15;
        ctx.setLineDash([]);
        ctx.fillStyle = '#10b981';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('🤖 AI 区域', centerX, centerY);
        ctx.restore();
      }
    }
  }, [shapes, previewShape, selectedShapeId, isDragging, startPos, dragStartPos, aiSelectionRect, aiSelection]);

  const drawOperation = async (ctx, shape, isSelected = false) => {
    const { type, data } = shape;
    
    if (type === 'image') {
      if (imageCache[data.src]) {
        const img = imageCache[data.src];
        ctx.drawImage(img, data.x, data.y, data.width, data.height);
      } else {
        const img = new Image();
        img.onload = () => {
          setImageCache(prev => ({ ...prev, [data.src]: img }));
        };
        img.src = data.src;
      }
      
      if (isSelected) {
        drawImageSelectionHandles(ctx, data);
      }
      return;
    }

    ctx.strokeStyle = data.color;
    ctx.fillStyle = data.color;
    ctx.lineWidth = data.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (type) {
      case 'pen':
        if (data.points && data.points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(data.points[0].x, data.points[0].y);
          for (let i = 1; i < data.points.length; i++) {
            ctx.lineTo(data.points[i].x, data.points[i].y);
          }
          ctx.stroke();
        }
        break;
        
      case 'rectangle':
        ctx.beginPath();
        ctx.strokeRect(
          Math.min(data.x1, data.x2),
          Math.min(data.y1, data.y2),
          Math.abs(data.x2 - data.x1),
          Math.abs(data.y2 - data.y1)
        );
        break;
        
      case 'circle':
        const centerX = (data.x1 + data.x2) / 2;
        const centerY = (data.y1 + data.y2) / 2;
        const radiusX = Math.abs(data.x2 - data.x1) / 2;
        const radiusY = Math.abs(data.y2 - data.y1) / 2;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
        ctx.stroke();
        break;
        
      case 'text':
        ctx.font = `${data.fontSize || 16}px Arial`;
        ctx.fillText(data.text, data.x, data.y);
        break;
    }

    if (isSelected) {
      drawSelectionHandles(ctx, shape);
    }
  };

  const drawImageSelectionHandles = (ctx, data) => {
    ctx.strokeStyle = '#4a90d9';
    ctx.fillStyle = '#4a90d9';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(data.x - 3, data.y - 3, data.width + 6, data.height + 6);
    ctx.setLineDash([]);
    
    const handleSize = 8;
    const corners = [
      { x: data.x - 3, y: data.y - 3 },
      { x: data.x + data.width + 3, y: data.y - 3 },
      { x: data.x - 3, y: data.y + data.height + 3 },
      { x: data.x + data.width + 3, y: data.y + data.height + 3 }
    ];
    corners.forEach(corner => {
      ctx.fillRect(corner.x - handleSize / 2, corner.y - handleSize / 2, handleSize, handleSize);
    });
  };

  const drawSelectionHandles = (ctx, shape) => {
    const { type, data } = shape;
    ctx.strokeStyle = '#4a90d9';
    ctx.fillStyle = '#4a90d9';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);

    let bounds;
    switch (type) {
      case 'rectangle':
      case 'circle':
        bounds = {
          x: Math.min(data.x1, data.x2),
          y: Math.min(data.y1, data.y2),
          width: Math.abs(data.x2 - data.x1),
          height: Math.abs(data.y2 - data.y1)
        };
        break;
      case 'pen':
        if (data.points && data.points.length > 0) {
          const xs = data.points.map(p => p.x);
          const ys = data.points.map(p => p.y);
          bounds = {
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys)
          };
        }
        break;
      case 'text':
        bounds = {
          x: data.x,
          y: data.y - (data.fontSize || 16),
          width: (data.text?.length || 5) * 10,
          height: data.fontSize || 16
        };
        break;
    }

    if (bounds) {
      ctx.strokeRect(bounds.x - 5, bounds.y - 5, bounds.width + 10, bounds.height + 10);
      ctx.setLineDash([]);
      
      const handleSize = 8;
      const corners = [
        { x: bounds.x - 5, y: bounds.y - 5 },
        { x: bounds.x + bounds.width + 5, y: bounds.y - 5 },
        { x: bounds.x - 5, y: bounds.y + bounds.height + 5 },
        { x: bounds.x + bounds.width + 5, y: bounds.y + bounds.height + 5 }
      ];
      corners.forEach(corner => {
        ctx.fillRect(corner.x - handleSize / 2, corner.y - handleSize / 2, handleSize, handleSize);
      });
    }
    ctx.setLineDash([]);
  };

  const drawDraggingPreview = (ctx, shape, deltaX, deltaY) => {
    const { type, data } = shape;
    
    if (type === 'image') {
      if (imageCache[data.src]) {
        ctx.drawImage(imageCache[data.src], data.x + deltaX, data.y + deltaY, data.width, data.height);
      }
      return;
    }

    ctx.strokeStyle = '#4a90d9';
    ctx.fillStyle = '#4a90d9';
    ctx.lineWidth = data.strokeWidth;

    switch (type) {
      case 'pen':
        if (data.points && data.points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(data.points[0].x + deltaX, data.points[0].y + deltaY);
          for (let i = 1; i < data.points.length; i++) {
            ctx.lineTo(data.points[i].x + deltaX, data.points[i].y + deltaY);
          }
          ctx.stroke();
        }
        break;
        
      case 'rectangle':
        ctx.beginPath();
        ctx.strokeRect(
          Math.min(data.x1, data.x2) + deltaX,
          Math.min(data.y1, data.y2) + deltaY,
          Math.abs(data.x2 - data.x1),
          Math.abs(data.y2 - data.y1)
        );
        break;
        
      case 'circle':
        const centerX = (data.x1 + data.x2) / 2 + deltaX;
        const centerY = (data.y1 + data.y2) / 2 + deltaY;
        const radiusX = Math.abs(data.x2 - data.x1) / 2;
        const radiusY = Math.abs(data.y2 - data.y1) / 2;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
        ctx.stroke();
        break;
        
      case 'text':
        ctx.font = `${data.fontSize || 16}px Arial`;
        ctx.fillText(data.text, data.x + deltaX, data.y + deltaY);
        break;
    }
  };

  const drawPreview = (ctx, shape) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth;
    ctx.setLineDash([5, 5]);

    switch (shape.type) {
      case TOOLS.RECTANGLE:
      case TOOLS.AI_SELECT:
        ctx.beginPath();
        ctx.strokeRect(
          Math.min(shape.x1, shape.x2),
          Math.min(shape.y1, shape.y2),
          Math.abs(shape.x2 - shape.x1),
          Math.abs(shape.y2 - shape.y1)
        );
        break;
        
      case TOOLS.CIRCLE:
        const centerX = (shape.x1 + shape.x2) / 2;
        const centerY = (shape.y1 + shape.y2) / 2;
        const radiusX = Math.abs(shape.x2 - shape.x1) / 2;
        const radiusY = Math.abs(shape.y2 - shape.y1) / 2;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
        ctx.stroke();
        break;
    }
    
    ctx.setLineDash([]);
  };

  const handleMouseDown = (e) => {
    if (isViewMode) return;
    
    const { x, y } = getCoords(e);
    setStartPos({ x, y });

    if (tool === TOOLS.AI_SELECT) {
      setIsAiSelecting(true);
      setAiSelectionRect({ x1: x, y1: y, x2: x, y2: y });
      return;
    }

    if (tool === TOOLS.SELECT) {
      const hitShape = getShapeAtPosition(x, y);
      if (hitShape) {
        setSelectedShapeId(hitShape.data.shapeId);
        setIsDragging(true);
        setDragStartPos({ x, y });
        
        const { type, data } = hitShape;
        let shapeX, shapeY;
        switch (type) {
          case 'rectangle':
          case 'circle':
            shapeX = Math.min(data.x1, data.x2);
            shapeY = Math.min(data.y1, data.y2);
            break;
          case 'pen':
            shapeX = data.points[0].x;
            shapeY = data.points[0].y;
            break;
          case 'text':
            shapeX = data.x;
            shapeY = data.y;
            break;
          case 'image':
            shapeX = data.x;
            shapeY = data.y;
            break;
          default:
            shapeX = x;
            shapeY = y;
        }
        setDragOffset({ x: x - shapeX, y: y - shapeY });
      } else {
        setSelectedShapeId(null);
      }
      return;
    }

    setIsDrawing(true);
    
    if (tool === TOOLS.PEN) {
      setPreviewShape({
        type: TOOLS.PEN,
        points: [{ x, y }]
      });
    } else if (tool === TOOLS.TEXT) {
      setTextInput({ show: true, x, y, value: '' });
      setIsDrawing(false);
    }
  };

  const handleMouseMove = (e) => {
    const { x, y } = getCoords(e);
    
    if (isAiSelecting && tool === TOOLS.AI_SELECT) {
      setAiSelectionRect(prev => prev ? { ...prev, x2: x, y2: y } : null);
      return;
    }
    
    if (isDragging && selectedShapeId) {
      setStartPos({ x, y });
      return;
    }

    if (!isDrawing || isViewMode) return;
    
    if (tool === TOOLS.PEN && previewShape) {
      setPreviewShape({
        ...previewShape,
        points: [...previewShape.points, { x, y }]
      });
    } else if (tool === TOOLS.RECTANGLE || tool === TOOLS.CIRCLE) {
      setPreviewShape({
        type: tool,
        x1: startPos.x,
        y1: startPos.y,
        x2: x,
        y2: y
      });
    }
  };

  const handleMouseUp = (e) => {
    const { x, y } = getCoords(e);
    
    if (isAiSelecting && tool === TOOLS.AI_SELECT) {
      setIsAiSelecting(false);
      const rect = {
        x1: startPos.x,
        y1: startPos.y,
        x2: x,
        y2: y
      };
      if (Math.abs(rect.x2 - rect.x1) > 10 && Math.abs(rect.y2 - rect.y1) > 10) {
        if (onAISelection) {
          onAISelection(rect);
        }
      } else {
        setAiSelectionRect(null);
      }
      return;
    }
    
    if (isDragging && selectedShapeId) {
      const deltaX = x - dragStartPos.x;
      const deltaY = y - dragStartPos.y;
      
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        const shape = shapes.find(s => s.data.shapeId === selectedShapeId);
        if (shape && onMove) {
          onMove(shape, deltaX, deltaY);
        }
      }
      
      setIsDragging(false);
      return;
    }

    if (!isDrawing || isViewMode) return;
    
    if (tool === TOOLS.PEN && previewShape) {
      onDraw('pen', {
        points: [...previewShape.points, { x, y }],
        color,
        strokeWidth
      });
    } else if ((tool === TOOLS.RECTANGLE || tool === TOOLS.CIRCLE) && previewShape) {
      onDraw(tool, {
        x1: startPos.x,
        y1: startPos.y,
        x2: x,
        y2: y,
        color,
        strokeWidth
      });
    }
    
    setIsDrawing(false);
    setPreviewShape(null);
  };

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (textInput.value.trim()) {
      onDraw('text', {
        text: textInput.value,
        x: textInput.x,
        y: textInput.y,
        color,
        fontSize: 16
      });
    }
    setTextInput({ show: false, x: 0, y: 0, value: '' });
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <canvas
        ref={canvasRef}
        width={1200}
        height={700}
        style={{
          border: '2px solid #ddd',
          borderRadius: '8px',
          cursor: tool === TOOLS.TEXT ? 'text' : 
                  tool === TOOLS.SELECT ? 'default' :
                  tool === TOOLS.AI_SELECT ? 'crosshair' : 'crosshair'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          setIsDrawing(false);
          setPreviewShape(null);
          setIsDragging(false);
        }}
      />
      
      {textInput.show && (
        <form
          onSubmit={handleTextSubmit}
          style={{
            position: 'absolute',
            left: textInput.x,
            top: textInput.y - 20,
            zIndex: 100
          }}
        >
          <input
            type="text"
            autoFocus
            value={textInput.value}
            onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
            onBlur={() => setTextInput({ show: false, x: 0, y: 0, value: '' })}
            style={{
              border: `2px solid ${color}`,
              outline: 'none',
              padding: '4px 8px',
              fontSize: '16px',
              fontFamily: 'Arial',
              color: color,
              background: 'white',
              borderRadius: '4px'
            }}
          />
        </form>
      )}
    </div>
  );
});

export { Whiteboard, TOOLS };
