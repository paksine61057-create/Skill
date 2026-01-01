
import React, { useState, useRef, useEffect } from 'react';
import { 
  Pencil, 
  Highlighter, 
  Eraser, 
  Undo2, 
  Download, 
  FileUp, 
  X,
  Loader2,
  PlusCircle,
  Sparkles
} from 'lucide-react';
import { ToolType, Stroke, Point, TextBox } from './types';
import { recognizeHandwriting } from './services/geminiService';

// ปรับให้สั้นลงมากเพื่อให้แปลงแบบ "ตัวต่อตัว" หรือ "คำต่อคำ" ได้ทันใจ
const AUTO_CONVERT_DELAY = 500; 
const PAGE_HEIGHT_INCREMENT = 1100;

const App: React.FC = () => {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [canvasHeight, setCanvasHeight] = useState(1100);
  const [autoConvert, setAutoConvert] = useState(true);
  
  const [currentTool, setCurrentTool] = useState<ToolType>('pen');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [textBoxes, setTextBoxes] = useState<TextBox[]>([]);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const autoConvertTimer = useRef<number | null>(null);
  const isConvertingRef = useRef(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPdfUrl(URL.createObjectURL(file));
      setStrokes([]);
      setTextBoxes([]);
    }
  };

  // Logic: แปลงลายเส้นปัจจุบันเป็น Text (จำลอง Vision Framework)
  const performConversion = async () => {
    // เลือกเฉพาะเส้น Pen ที่ยังค้างอยู่บนจอ
    const strokesToConvert = strokes.filter(s => s.tool === 'pen');
    if (!canvasRef.current || strokesToConvert.length === 0 || isConvertingRef.current) return;
    
    isConvertingRef.current = true;
    setIsProcessing(true);

    // 1. หาขอบเขต (Bounding Box) เพื่อคำนวณตำแหน่งและขนาดฟอนต์
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    strokesToConvert.forEach(s => {
      s.points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      });
    });

    // คำนวณขนาดฟอนต์ให้เท่ากับความสูงลายมือจริง
    const estimatedFontSize = Math.max(12, (maxY - minY) * 0.95);
    
    // ลบลายเส้นออกจาก State ทันที (PKDrawing = PKDrawing())
    const idsToClear = strokesToConvert.map(s => s.id);
    setStrokes(prev => prev.filter(s => !idsToClear.includes(s.id)));

    // 2. OCR Snapshot (Crop เฉพาะส่วนที่มีเส้นเพื่อความแม่นยำและรวดเร็ว)
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvasRef.current.width;
    tempCanvas.height = canvasRef.current.height;
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
    
    if (text && text.trim().length > 0) {
      const newBox: TextBox = {
        id: Math.random().toString(36).substr(2, 9),
        text: text.trim(),
        x: minX,
        y: minY, 
        fontSize: estimatedFontSize
      };
      setTextBoxes(prev => [...prev, newBox]);
    }

    setIsProcessing(false);
    isConvertingRef.current = false;
  };

  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (autoConvertTimer.current) window.clearTimeout(autoConvertTimer.current);
    
    isDrawing.current = true;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const newStroke: Stroke = {
      id: Math.random().toString(36).substr(2, 9),
      tool: currentTool,
      color: currentTool === 'highlighter' ? '#FFEB3B' : '#000000',
      width: currentTool === 'highlighter' ? 24 : 3.5,
      opacity: currentTool === 'highlighter' ? 0.35 : 1,
      points: [{ x, y, pressure: e.pressure || 0.5 }]
    };

    if (currentTool === 'eraser') {
      handleEraser(x, y);
    } else {
      currentStrokeRef.current = newStroke;
      setStrokes(prev => [...prev, newStroke]);
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
    } else if (currentStrokeRef.current) {
      const updatedPoints = [...currentStrokeRef.current.points, { x, y, pressure: e.pressure || 0.5 }];
      currentStrokeRef.current.points = updatedPoints;
      setStrokes(prev => prev.map(s => s.id === currentStrokeRef.current?.id ? { ...s, points: updatedPoints } : s));
    }
  };

  const endDrawing = () => {
    isDrawing.current = false;
    currentStrokeRef.current = null;
    
    // Trigger conversion quickly after lifting the pen
    if (autoConvert && strokes.some(s => s.tool === 'pen')) {
      autoConvertTimer.current = window.setTimeout(() => {
        performConversion();
      }, AUTO_CONVERT_DELAY);
    }
  };

  const handleEraser = (x: number, y: number) => {
    setStrokes(prev => prev.filter(stroke => {
      return !stroke.points.some(p => {
        const dist = Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2));
        return dist < (stroke.tool === 'highlighter' ? 30 : 15);
      });
    }));

    setTextBoxes(prev => prev.filter(box => {
      const charWidth = box.fontSize * 0.5;
      const isInside = (
        x >= box.x - 10 && x <= box.x + (box.text.length * charWidth) + 10 &&
        y >= box.y - 10 && y <= box.y + box.fontSize + 10
      );
      return !isInside;
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
  }, [strokes, canvasHeight]);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#F2F2F7]">
      <header className="h-16 bg-white/90 backdrop-blur-2xl border-b flex items-center justify-between px-6 z-50 shadow-sm">
        <div className="flex items-center gap-4">
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold shadow-lg shadow-blue-500/20">
            <FileUp size={18} />
            <span>Open PDF</span>
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileUpload} />
          </label>
          <div className="flex bg-gray-100 p-1 rounded-2xl">
            <ToolbarButton active={currentTool === 'pen'} onClick={() => setCurrentTool('pen')} icon={<Pencil size={20} />} />
            <ToolbarButton active={currentTool === 'highlighter'} onClick={() => setCurrentTool('highlighter')} icon={<Highlighter size={20} />} />
            <ToolbarButton active={currentTool === 'eraser'} onClick={() => setCurrentTool('eraser')} icon={<Eraser size={20} />} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => setAutoConvert(!autoConvert)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all border ${autoConvert ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-200 text-gray-500'}`}
          >
            <Sparkles size={16} className={autoConvert ? 'animate-pulse' : ''} />
            <span>Scribble Mode</span>
          </button>
          <div className="h-8 w-px bg-gray-200 mx-1" />
          <ToolbarButton onClick={() => setStrokes(prev => prev.slice(0, -1))} icon={<Undo2 size={20} />} disabled={strokes.length === 0} />
          <button className="bg-gray-900 text-white px-6 py-2 rounded-xl font-bold flex items-center gap-2">
            <Download size={18} />
            <span>Export</span>
          </button>
        </div>
      </header>

      <main className="flex-1 relative overflow-y-auto flex flex-col items-center p-8 bg-[#D1D1D6]">
        <div 
          className="relative bg-white shadow-2xl rounded-sm overflow-hidden"
          style={{ width: '850px', minHeight: `${canvasHeight}px` }}
        >
          {pdfUrl && (
            <div className="absolute inset-0 z-0">
              <embed src={pdfUrl} type={pdfUrl.includes('image') ? 'image/png' : 'application/pdf'} className="w-full h-full" />
            </div>
          )}

          <canvas
            ref={canvasRef}
            width={850}
            height={canvasHeight}
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={endDrawing}
            className="absolute inset-0 z-10 cursor-crosshair touch-none"
          />

          {textBoxes.map(box => (
            <div 
              key={box.id}
              className="absolute z-20 thai-font fade-in pointer-events-none"
              style={{ left: box.x, top: box.y, fontSize: `${box.fontSize}px` }}
            >
              <p className="text-gray-900 font-medium leading-none m-0 p-0">{box.text}</p>
            </div>
          ))}

          {isProcessing && (
            <div className="fixed bottom-12 right-1/2 translate-x-1/2 z-50 flex items-center gap-3 bg-white/90 backdrop-blur-md px-6 py-2 rounded-full shadow-2xl border border-indigo-100">
              <Loader2 className="animate-spin text-indigo-600" size={16} />
              <span className="text-xs font-bold text-indigo-700 thai-font">Magic Scribble...</span>
            </div>
          )}
        </div>

        <button onClick={() => setCanvasHeight(h => h + PAGE_HEIGHT_INCREMENT)} className="mt-8 mb-24 opacity-30 hover:opacity-100 transition-opacity">
          <PlusCircle size={40} className="text-white" />
        </button>
      </main>
    </div>
  );
};

const ToolbarButton = ({ active, onClick, icon, disabled }: any) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`p-2.5 rounded-xl transition-all ${active ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-600'} ${disabled ? 'opacity-20' : 'cursor-pointer active:scale-90'}`}
  >
    {icon}
  </button>
);

export default App;
