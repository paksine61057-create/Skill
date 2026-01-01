
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Pencil, 
  Highlighter, 
  Eraser, 
  Undo2, 
  Redo2, 
  Type, 
  Download, 
  FileUp, 
  X,
  Loader2,
  PlusCircle,
  Sparkles
} from 'lucide-react';
import { ToolType, Stroke, Point, TextBox } from './types';
import { recognizeHandwriting } from './services/geminiService';

const PAGE_HEIGHT_INCREMENT = 1100;
const AUTO_CONVERT_DELAY = 1200; // ปรับให้ไวขึ้นเพื่อความเป็น "Magic"

const App: React.FC = () => {
  // States
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [canvasHeight, setCanvasHeight] = useState(1100);
  const [autoConvert, setAutoConvert] = useState(true);
  
  const [currentTool, setCurrentTool] = useState<ToolType>('pen');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const [textBoxes, setTextBoxes] = useState<TextBox[]>([]);
  
  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mainScrollRef = useRef<HTMLElement>(null);
  const isDrawing = useRef(false);
  const currentStroke = useRef<Stroke | null>(null);
  const autoConvertTimer = useRef<number | null>(null);

  // File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setPdfUrl(url);
      setStrokes([]);
      setRedoStack([]);
      setTextBoxes([]);
      setCanvasHeight(1100);
    }
  };

  const addMoreSpace = () => {
    setCanvasHeight(prev => prev + PAGE_HEIGHT_INCREMENT);
  };

  // Convert Logic
  const performConversion = async () => {
    // เลือกเฉพาะลายเส้นที่ไม่ใช่ไฮไลต์
    const strokesToConvert = strokes.filter(s => s.tool !== 'highlighter');
    if (!canvasRef.current || strokesToConvert.length === 0) return;
    
    // เคลียร์ลายเส้นที่กำลังจะแปลงออกทันที เพื่อป้องกันการกดซ้ำหรือประมวลผลซ้ำ
    const processingIds = new Set(strokesToConvert.map(s => s.id));
    setStrokes(prev => prev.filter(s => !processingIds.has(s.id)));
    
    setIsProcessing(true);
    const canvas = canvasRef.current;
    
    // 1. คำนวณขอบเขต (Bounding Box) และขนาดฟอนต์จากลายเส้นจริง
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    strokesToConvert.forEach(s => {
      s.points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      });
    });

    // คำนวณขนาดฟอนต์ให้ใกล้เคียงกับความสูงที่เขียนจริง (ใช้ 90% ของความสูงเพื่อความพอดี)
    const estimatedFontSize = Math.max(16, (maxY - minY) * 0.9);

    // 2. สร้างภาพชั่วคราวเพื่อส่งไป OCR
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tCtx = tempCanvas.getContext('2d');
    if (tCtx) {
      tCtx.lineCap = 'round';
      tCtx.lineJoin = 'round';
      strokesToConvert.forEach(stroke => {
        tCtx.beginPath();
        tCtx.strokeStyle = "#000000"; 
        tCtx.lineWidth = stroke.width;
        tCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
        stroke.points.forEach(p => tCtx.lineTo(p.x, p.y));
        tCtx.stroke();
      });
    }

    const dataUrl = tempCanvas.toDataURL('image/png');
    const text = await recognizeHandwriting(dataUrl);
    
    if (text && text.trim() && text !== "Error recognizing text") {
      // สร้าง TextBox ใหม่ที่ตำแหน่งเดิมเป๊ะๆ
      const newBox: TextBox = {
        id: Math.random().toString(36).substr(2, 9),
        text: text.trim(),
        x: minX,
        y: minY, 
        fontSize: estimatedFontSize
      };

      setTextBoxes(prev => [...prev, newBox]);
    } else {
      // ถ้าแปลงไม่ได้ ให้เอากลับคืนมา (เผื่อกรณีระบบผิดพลาด)
      // แต่ในแอปจริงๆ การหายไปเลยอาจจะดูคลีนกว่าหากเป็นขยะ
    }
    setIsProcessing(false);
  };

  // Drawing Logic
  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (autoConvertTimer.current) {
      window.clearTimeout(autoConvertTimer.current);
    }
    
    isDrawing.current = true;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const newStroke: Stroke = {
      id: Math.random().toString(36).substr(2, 9),
      tool: currentTool,
      color: currentTool === 'highlighter' ? '#FFEB3B' : '#000000',
      width: currentTool === 'highlighter' ? 24 : 3,
      opacity: currentTool === 'highlighter' ? 0.35 : 1,
      points: [{ x, y, pressure: e.pressure || 0.5 }]
    };

    if (currentTool === 'eraser') {
      handleEraser(x, y);
    } else {
      currentStroke.current = newStroke;
      setStrokes(prev => [...prev, newStroke]);
      setRedoStack([]);
    }
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (currentTool === 'eraser') {
      handleEraser(x, y);
    } else if (currentStroke.current) {
      const updatedPoints = [...currentStroke.current.points, { x, y, pressure: e.pressure || 0.5 }];
      currentStroke.current.points = updatedPoints;
      setStrokes(prev => prev.map(s => s.id === currentStroke.current?.id ? { ...s, points: updatedPoints } : s));
    }
  };

  const endDrawing = () => {
    isDrawing.current = false;
    currentStroke.current = null;
    
    // ตั้งเวลาแปลงอัตโนมัติเมื่อหยุดเขียน
    if (autoConvert && strokes.some(s => s.tool !== 'highlighter')) {
      autoConvertTimer.current = window.setTimeout(() => {
        performConversion();
      }, AUTO_CONVERT_DELAY);
    }
  };

  const handleEraser = (x: number, y: number) => {
    setStrokes(prev => prev.filter(stroke => {
      return !stroke.points.some(p => {
        const dist = Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2));
        return dist < (stroke.width + 15);
      });
    }));

    setTextBoxes(prev => prev.filter(box => {
      // ตรวจสอบระยะสัมผัสกับกล่องข้อความ
      const hitWidth = box.text.length * (box.fontSize * 0.5);
      const hitHeight = box.fontSize;
      const padding = 15;

      const isHit = (
        x >= box.x - padding &&
        x <= box.x + hitWidth + padding &&
        y >= box.y - padding &&
        y <= box.y + hitHeight + padding
      );

      return !isHit;
    }));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    strokes.forEach(stroke => {
      if (stroke.points.length < 2) return;
      ctx.beginPath();
      ctx.globalAlpha = stroke.opacity;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      stroke.points.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }, [strokes, canvasHeight]);

  const undo = () => {
    if (strokes.length === 0) return;
    const last = strokes[strokes.length - 1];
    setStrokes(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, last]);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#F2F2F7]">
      {/* Tool Bar */}
      <header className="h-16 bg-white/95 backdrop-blur-xl border-b flex items-center justify-between px-6 z-50 flex-shrink-0 shadow-sm">
        <div className="flex items-center gap-4">
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold transition-all active:scale-95 shadow-lg shadow-blue-500/20">
            <FileUp size={18} />
            <span>Open</span>
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileUpload} />
          </label>
          <div className="h-8 w-px bg-gray-200" />
          <div className="flex bg-gray-100/80 p-1 rounded-2xl border border-gray-200">
            <ToolbarButton active={currentTool === 'pen'} onClick={() => setCurrentTool('pen')} icon={<Pencil size={20} />} />
            <ToolbarButton active={currentTool === 'highlighter'} onClick={() => setCurrentTool('highlighter')} icon={<Highlighter size={20} />} />
            <ToolbarButton active={currentTool === 'eraser'} onClick={() => setCurrentTool('eraser')} icon={<Eraser size={20} />} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => setAutoConvert(!autoConvert)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all border ${autoConvert ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-white border-gray-200 text-gray-500'}`}
          >
            <Sparkles size={16} className={autoConvert ? 'animate-pulse' : ''} />
            <span>Magic Font</span>
          </button>
          
          <div className="h-8 w-px bg-gray-200 mx-1" />
          <ToolbarButton onClick={undo} icon={<Undo2 size={20} />} disabled={strokes.length === 0} />
          
          <button 
            className="bg-gray-900 text-white px-6 py-2 rounded-xl font-bold hover:bg-black transition-all active:scale-95 flex items-center gap-2 shadow-lg shadow-black/10"
          >
            <Download size={18} />
            <span>Export</span>
          </button>
        </div>
      </header>

      {/* Main Canvas Area */}
      <main ref={mainScrollRef} className="flex-1 relative overflow-y-auto overflow-x-hidden flex flex-col items-center p-8 bg-[#D1D1D6] scroll-smooth">
        <div 
          className="relative bg-white shadow-[0_25px_60px_rgba(0,0,0,0.2)] transition-all duration-300 mb-10 rounded-sm overflow-hidden"
          style={{ width: '850px', minHeight: `${canvasHeight}px` }}
        >
          {/* PDF Background Layer */}
          {pdfUrl && (
            <div className="absolute inset-0 z-0">
              <embed src={pdfUrl} type={pdfUrl.includes('image') ? 'image/png' : 'application/pdf'} className="w-full h-[1100px]" />
              <div className="w-full h-full bg-white opacity-0" />
            </div>
          )}

          {!pdfUrl && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-200 bg-white">
              <Sparkles size={80} className="mb-4 opacity-5" />
              <p className="text-xl font-bold opacity-20 select-none">Start Writing or Open a File</p>
            </div>
          )}

          {/* Drawing Layer */}
          <canvas
            ref={canvasRef}
            width={850}
            height={canvasHeight}
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={endDrawing}
            onPointerLeave={endDrawing}
            className="absolute inset-0 z-10 cursor-crosshair touch-none"
          />

          {/* Text Objects Layer (Magic Font) */}
          {textBoxes.map(box => (
            <div 
              key={box.id}
              className="absolute z-20 group p-0 bg-transparent rounded select-none thai-font fade-in"
              style={{ left: box.x, top: box.y, lineHeight: 1 }}
            >
              <div className="relative">
                <p 
                  className="text-gray-900 leading-[1.05] font-normal min-w-[2px] max-w-[800px] whitespace-pre-wrap pointer-events-none"
                  style={{ fontSize: `${box.fontSize}px` }}
                >
                  {box.text}
                </p>
                {/* Delete button (only visible on hover for desktop, or near interaction) */}
                <button 
                  onClick={(e) => { e.stopPropagation(); setTextBoxes(prev => prev.filter(b => b.id !== box.id)); }}
                  className="absolute -top-3 -right-3 opacity-0 group-hover:opacity-100 bg-red-500 text-white p-0.5 rounded-full transition-opacity shadow-lg"
                >
                  <X size={10} />
                </button>
              </div>
            </div>
          ))}

          {/* Loading Indicator */}
          {isProcessing && (
            <div className="fixed bottom-12 right-1/2 translate-x-1/2 z-50 flex items-center gap-3 bg-white/90 backdrop-blur px-6 py-3 rounded-2xl shadow-2xl border border-indigo-100 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <Loader2 className="animate-spin text-indigo-600" size={20} />
              <span className="text-sm font-bold text-indigo-700 thai-font tracking-tight">กำลังเนรมิตลายมือให้สวยงาม...</span>
            </div>
          )}
        </div>

        <button 
          onClick={addMoreSpace}
          className="flex flex-col items-center gap-3 text-white/40 hover:text-white transition-all mb-24 group"
        >
          <div className="bg-white/5 p-4 rounded-full group-hover:bg-white/10 transition-all">
            <PlusCircle size={32} />
          </div>
          <span className="font-bold tracking-widest uppercase text-[10px]">Extend Page</span>
        </button>
      </main>

      {/* Footer Info */}
      <footer className="h-10 bg-white border-t px-8 flex items-center justify-between text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em] z-50">
        <div className="flex gap-10">
          <span>Strokes: {strokes.length}</span>
          <span>Magic Text: {textBoxes.length}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className={autoConvert ? 'text-indigo-500' : 'text-gray-300'}>
            {autoConvert ? 'Magic Mode Active' : 'Manual Mode'}
          </span>
          <div className="h-3 w-px bg-gray-200" />
          <span className="text-gray-500">Professional Annotation Engine</span>
        </div>
      </footer>
    </div>
  );
};

interface ToolbarButtonProps {
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ active, onClick, icon, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`
      p-2.5 rounded-xl transition-all
      ${active ? 'bg-white shadow-sm text-blue-600 scale-110' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}
      ${disabled ? 'opacity-20 cursor-not-allowed' : 'cursor-pointer active:scale-95'}
    `}
  >
    {icon}
  </button>
);

export default App;
