
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
const AUTO_CONVERT_DELAY = 1800; // Wait 1.8 seconds after writing before converting

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
    const convertStrokes = strokes.filter(s => s.tool !== 'highlighter');
    if (!canvasRef.current || convertStrokes.length === 0) return;
    
    setIsProcessing(true);
    const canvas = canvasRef.current;
    
    // 1. Calculate Bounding Box of handwriting to place text accurately
    let minX = Infinity, minY = Infinity;
    convertStrokes.forEach(s => {
      s.points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
      });
    });

    // 2. Create a temporary canvas for OCR (Cleaner background for better AI results)
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tCtx = tempCanvas.getContext('2d');
    if (tCtx) {
      tCtx.lineCap = 'round';
      tCtx.lineJoin = 'round';
      convertStrokes.forEach(stroke => {
        tCtx.beginPath();
        tCtx.strokeStyle = stroke.color;
        tCtx.lineWidth = stroke.width;
        tCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
        stroke.points.forEach(p => tCtx.lineTo(p.x, p.y));
        tCtx.stroke();
      });
    }

    const dataUrl = tempCanvas.toDataURL('image/png');
    const text = await recognizeHandwriting(dataUrl);
    
    if (text && text.trim() && text !== "Error recognizing text") {
      // Place the new textbox at the exact top-left of where the handwriting was
      // Adjust slightly (e.g., -5px) to account for font-rendering vs stroke-edges
      const newBox: TextBox = {
        id: Math.random().toString(36).substr(2, 9),
        text: text.trim(),
        x: minX,
        y: minY - 10 // Lift slightly for better baseline feel
      };

      setTextBoxes(prev => [...prev, newBox]);
      // Clear ONLY the handwriting strokes that were converted, keep highlighters
      setStrokes(prev => prev.filter(s => s.tool === 'highlighter'));
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
    
    // Start auto-convert timer if enabled and we have drawing strokes
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
        return dist < (stroke.width + 10);
      });
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
      {/* Top Toolbar */}
      <header className="h-16 bg-white/90 backdrop-blur-xl border-b flex items-center justify-between px-6 z-50 flex-shrink-0">
        <div className="flex items-center gap-4">
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-semibold transition-all active:scale-95 shadow-lg shadow-blue-500/20">
            <FileUp size={18} />
            <span>Open File</span>
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileUpload} />
          </label>
          <div className="h-8 w-px bg-gray-200" />
          <div className="flex bg-gray-100/80 p-1 rounded-2xl border border-gray-200">
            <ToolbarButton 
              active={currentTool === 'pen'} 
              onClick={() => setCurrentTool('pen')} 
              icon={<Pencil size={20} />} 
              label="Pen"
            />
            <ToolbarButton 
              active={currentTool === 'highlighter'} 
              onClick={() => setCurrentTool('highlighter')} 
              icon={<Highlighter size={20} />} 
              label="Marker"
            />
            <ToolbarButton 
              active={currentTool === 'eraser'} 
              onClick={() => setCurrentTool('eraser')} 
              icon={<Eraser size={20} />} 
              label="Eraser"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-indigo-50/50 p-1 rounded-2xl border border-indigo-100">
             <button 
              onClick={() => setAutoConvert(!autoConvert)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold transition-all ${autoConvert ? 'bg-indigo-600 text-white shadow-md' : 'text-indigo-600 hover:bg-indigo-100'}`}
            >
              <Sparkles size={16} />
              <span>Auto-Convert</span>
            </button>
          </div>
          <div className="h-8 w-px bg-gray-200 mx-1" />
          <ToolbarButton onClick={undo} icon={<Undo2 size={20} />} disabled={strokes.length === 0} />
          <button 
            onClick={performConversion}
            disabled={isProcessing || strokes.filter(s => s.tool !== 'highlighter').length === 0}
            className="flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-50 transition-all active:scale-95 disabled:opacity-50"
          >
            {isProcessing ? <Loader2 className="animate-spin text-indigo-600" size={18} /> : <Type className="text-indigo-600" size={18} />}
            <span>Convert</span>
          </button>
          <button 
            className="bg-gray-900 text-white px-5 py-2 rounded-xl font-semibold hover:bg-black transition-all active:scale-95 flex items-center gap-2 shadow-lg shadow-black/10"
          >
            <Download size={18} />
            <span>Export PDF</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main 
        ref={mainScrollRef}
        className="flex-1 relative overflow-y-auto overflow-x-hidden flex flex-col items-center p-12 bg-[#D1D1D6]"
      >
        <div 
          className="relative bg-white shadow-[0_20px_50px_rgba(0,0,0,0.15)] transition-all duration-500 mb-10 rounded-sm overflow-hidden"
          style={{ width: '850px', minHeight: `${canvasHeight}px` }}
        >
          {/* Document Background */}
          {pdfUrl ? (
            <div className="absolute inset-0 z-0">
              <embed src={pdfUrl} type={pdfUrl.includes('image') ? 'image/png' : 'application/pdf'} className="w-full h-[1100px]" />
              <div className="w-full h-full bg-white" />
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-300 bg-white">
              <Sparkles size={80} className="mb-6 opacity-10 animate-pulse" />
              <p className="text-2xl font-semibold opacity-30">Drop a file to begin writing</p>
            </div>
          )}

          {/* Annotation Canvas */}
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

          {/* Render Text Boxes with Anuphan font */}
          {textBoxes.map(box => (
            <div 
              key={box.id}
              className="absolute z-20 group p-0 bg-transparent hover:bg-indigo-50/30 rounded transition-colors thai-font fade-in"
              style={{ left: box.x, top: box.y }}
            >
              <div className="relative">
                <p className="text-xl text-gray-900 leading-tight font-normal min-w-[20px] max-w-[600px] whitespace-pre-wrap">
                  {box.text}
                </p>
                <button 
                  onClick={() => setTextBoxes(prev => prev.filter(b => b.id !== box.id))}
                  className="absolute -top-4 -right-4 opacity-0 group-hover:opacity-100 bg-red-500 text-white p-1 rounded-full transition-opacity shadow-lg"
                >
                  <X size={10} />
                </button>
              </div>
            </div>
          ))}

          {/* Processing Indicator Overlay */}
          {isProcessing && (
            <div className="absolute bottom-10 right-10 z-30 flex items-center gap-3 bg-white/80 backdrop-blur px-4 py-2 rounded-full shadow-xl border border-indigo-100 animate-bounce">
              <Loader2 className="animate-spin text-indigo-600" size={20} />
              <span className="text-sm font-bold text-indigo-700 thai-font">กำลังเนรมิตข้อความ...</span>
            </div>
          )}
        </div>

        <button 
          onClick={addMoreSpace}
          className="flex flex-col items-center gap-3 text-white/50 hover:text-white transition-all mb-20 group"
        >
          <div className="bg-white/10 p-4 rounded-full group-hover:bg-white/20 transition-all group-hover:scale-110">
            <PlusCircle size={32} />
          </div>
          <span className="font-bold tracking-wide uppercase text-xs">Add More Canvas Space</span>
        </button>
      </main>

      {/* Footer */}
      <footer className="h-10 bg-white border-t px-8 flex items-center justify-between text-[11px] text-gray-400 font-bold uppercase tracking-widest z-50">
        <div className="flex gap-8">
          <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-indigo-400 rounded-full"/> Strokes: {strokes.length}</span>
          <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-amber-400 rounded-full"/> Objects: {textBoxes.length}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={autoConvert ? 'text-indigo-500' : 'text-gray-400'}>Auto-Convert: {autoConvert ? 'ON' : 'OFF'}</span>
          <div className="h-3 w-px bg-gray-200" />
          <span>iPad Pro Simulation Mode</span>
        </div>
      </footer>
    </div>
  );
};

interface ToolbarButtonProps {
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label?: string;
  disabled?: boolean;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ active, onClick, icon, label, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`
      flex items-center gap-2 px-4 py-2 rounded-xl transition-all
      ${active ? 'bg-white shadow-md text-blue-600 scale-105' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}
      ${disabled ? 'opacity-20 cursor-not-allowed' : 'cursor-pointer'}
    `}
  >
    {icon}
    {label && <span className="text-sm font-bold uppercase tracking-tight">{label}</span>}
  </button>
);

export default App;
