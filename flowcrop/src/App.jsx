import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, Settings, RefreshCw, ChevronLeft, ChevronRight, Crop, Move, Eraser, ScanFace, Save, Image as ImageIcon, X } from 'lucide-react';

const ASPECT_RATIOS = [
  { label: '1:1', value: 1 },
  { label: '3:4', value: 0.75 },
  { label: '4:3', value: 1.333 },
  { label: '16:9', value: 1.778 },
  { label: '自由', value: null }
];

export default function App() {
  const [step, setStep] = useState('upload'); 
  const [images, setImages] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [aspectRatio, setAspectRatio] = useState(1.778); 
  const [editMode, setEditMode] = useState('move'); 
  const [isExporting, setIsExporting] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(null); // 用于手机端长按保存

  const containerRef = useRef(null);
  const visualCanvasRef = useRef(null);
  const activePointers = useRef(new Map());
  const pinchStartRef = useRef(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);

  // 动态加载库
  useEffect(() => {
    if (!window.JSZip) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  // 阻止默认缩放
  useEffect(() => {
    const container = containerRef.current;
    if (!container || step !== 'edit') return;
    const handleWheel = (e) => {
      if (editMode !== 'move') return;
      e.preventDefault(); 
      const delta = -e.deltaY * 0.002;
      setImages(prev => {
        const newImages = [...prev];
        const t = newImages[currentIndex].transform;
        newImages[currentIndex].transform = { ...t, scale: Math.max(0.1, Math.min(t.scale + delta, 5)) };
        return newImages;
      });
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [step, currentIndex, editMode]);

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files).slice(0, 30);
    if (files.length === 0) return;
    const newImages = files.map((file, index) => ({
      id: Date.now() + index,
      file,
      url: URL.createObjectURL(file),
      transform: { x: 0, y: 0, scale: 1 },
      smudgePaths: []
    }));
    setImages(newImages);
    setCurrentIndex(0);
    setStep('edit');
  };

  // --- 交互逻辑 ---
  const onPointerDown = (e) => {
    if (editMode !== 'move' && editMode !== 'smudge') return;
    e.target.setPointerCapture(e.pointerId);
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (editMode === 'move') {
      if (activePointers.current.size === 1) {
        isDragging.current = true;
        dragStart.current = { x: e.clientX, y: e.clientY };
      } else if (activePointers.current.size === 2) {
        isDragging.current = false;
        const pts = Array.from(activePointers.current.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        pinchStartRef.current = { initialDist: dist, initialScale: images[currentIndex].transform.scale };
      }
    } else if (editMode === 'smudge' && activePointers.current.size === 1) {
      isDragging.current = true;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setImages(prev => {
        const newImages = [...prev];
        const img = newImages[currentIndex];
        img.smudgePaths = [...(img.smudgePaths || []), { points: [{ x, y }] }];
        return newImages;
      });
    }
  };

  const onPointerMove = (e) => {
    if (!activePointers.current.has(e.pointerId)) return;
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (editMode === 'move') {
      if (activePointers.current.size === 1 && isDragging.current) {
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        setImages(prev => {
          const newImages = [...prev];
          const t = newImages[currentIndex].transform;
          newImages[currentIndex].transform = { ...t, x: t.x + dx, y: t.y + dy };
          return newImages;
        });
        dragStart.current = { x: e.clientX, y: e.clientY };
      } else if (activePointers.current.size === 2 && pinchStartRef.current) {
        const pts = Array.from(activePointers.current.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const scale = pinchStartRef.current.initialScale * (dist / pinchStartRef.current.initialDist);
        setImages(prev => {
          const newImages = [...prev];
          newImages[currentIndex].transform.scale = Math.max(0.1, Math.min(scale, 5));
          return newImages;
        });
      }
    } else if (editMode === 'smudge' && isDragging.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setImages(prev => {
        const newImages = [...prev];
        const paths = newImages[currentIndex].smudgePaths;
        paths[paths.length - 1].points.push({ x, y });
        return newImages;
      });
    }
  };

  const onPointerUp = (e) => {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size === 0) isDragging.current = false;
  };

  // --- 核心渲染逻辑：生成裁剪结果 ---
  const getCroppedCanvas = (index) => {
    return new Promise((resolve) => {
      const imgObj = new Image();
      const item = images[index];
      imgObj.src = item.url;
      imgObj.onload = () => {
        const canvas = document.createElement('canvas');
        const container = containerRef.current;
        const rect = container.getBoundingClientRect();
        
        // 计算裁剪区域 (基于 UI 中白色框的比例)
        const maskWidth = rect.width * (aspectRatio ? 0.8 : 0.9);
        const maskHeight = aspectRatio ? maskWidth / aspectRatio : rect.height * 0.9;
        
        canvas.width = maskWidth * 2; // 双倍分辨率保证清晰
        canvas.height = maskHeight * 2;
        const ctx = canvas.getContext('2d');

        // 绘制背景
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 应用变换
        ctx.save();
        ctx.translate(canvas.width/2, canvas.height/2);
        ctx.scale(item.transform.scale * 2, item.transform.scale * 2);
        ctx.translate(item.transform.x / item.transform.scale, item.transform.y / item.transform.scale);
        
        // 绘制图片
        const imgRatio = imgObj.width / imgObj.height;
        let drawW, drawH;
        if (imgRatio > (rect.width/rect.height)) {
          drawW = rect.width;
          drawH = rect.width / imgRatio;
        } else {
          drawH = rect.height;
          drawW = rect.height * imgRatio;
        }
        ctx.drawImage(imgObj, -drawW/2, -drawH/2, drawW, drawH);

        // --- 应用去水印模糊 ---
        if (item.smudgePaths && item.smudgePaths.length > 0) {
          item.smudgePaths.forEach(path => {
            if (path.points.length < 2) return;
            
            ctx.save();
            // 1. 创建涂抹路径作为裁剪区
            ctx.beginPath();
            const startX = (path.points[0].x - rect.width/2 - item.transform.x) / item.transform.scale;
            const startY = (path.points[0].y - rect.height/2 - item.transform.y) / item.transform.scale;
            ctx.moveTo(startX, startY);
            for(let i=1; i<path.points.length; i++) {
              const px = (path.points[i].x - rect.width/2 - item.transform.x) / item.transform.scale;
              const py = (path.points[i].y - rect.height/2 - item.transform.y) / item.transform.scale;
              ctx.lineTo(px, py);
            }
            ctx.lineWidth = 30 / item.transform.scale;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
            ctx.clip();

            // 2. 在裁剪区内绘制模糊的图片
            ctx.filter = 'blur(15px)';
            ctx.drawImage(imgObj, -drawW/2, -drawH/2, drawW, drawH);
            ctx.restore();
          });
        }

        ctx.restore();
        resolve(canvas);
      };
    });
  };

  // 保存单张
  const handleSaveCurrent = async () => {
    const canvas = await getCroppedCanvas(currentIndex);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    
    // 如果是手机端，显示预览大图提示长按保存
    if (window.innerWidth < 768) {
      setShowPreviewModal(dataUrl);
    } else {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `flowcrop_${Date.now()}.jpg`;
      a.click();
    }
  };

  // 一键全部保存 (循环触发)
  const handleSaveAll = async () => {
    setIsExporting(true);
    for (let i = 0; i < images.length; i++) {
      const canvas = await getCroppedCanvas(i);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `flowcrop_all_${i+1}.jpg`;
      a.click();
      await new Promise(r => setTimeout(r, 300)); // 间隔防止浏览器拦截
    }
    setIsExporting(false);
  };

  // 打包 ZIP
  const handleExportZip = async () => {
    if (!window.JSZip) return;
    setIsExporting(true);
    const zip = new window.JSZip();
    for (let i = 0; i < images.length; i++) {
      const canvas = await getCroppedCanvas(i);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
      zip.file(`cropped_${i + 1}.jpg`, blob);
    }
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FlowCrop_Pack_${Date.now()}.zip`;
    a.click();
    setIsExporting(false);
  };

  // --- 实时预览绘制 ---
  useEffect(() => {
    if (step !== 'edit' || !visualCanvasRef.current) return;
    const canvas = visualCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width; canvas.height = rect.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const paths = images[currentIndex]?.smudgePaths || [];
    paths.forEach(path => {
      if (path.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(path.points[0].x, path.points[0].y);
      path.points.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 30; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.stroke();
    });
  }, [images, currentIndex, step]);

  if (step === 'upload') {
    return (
      <div className="min-h-screen bg-[#121212] text-white flex flex-col items-center justify-center p-4">
        <div className="flex items-center gap-3 mb-10">
          <div className="bg-blue-600 p-2 rounded-xl shadow-lg shadow-blue-900/40">
            <Crop size={24} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">FlowCrop <span className="text-gray-500 font-light ml-1">批量裁剪大师</span></h1>
        </div>
        <label className="w-full max-w-lg aspect-video bg-[#1A1A1A] border-2 border-dashed border-gray-700 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:bg-[#222] transition-all group">
          <Upload size={48} className="text-gray-500 group-hover:text-blue-500 transition-colors mb-4" />
          <p className="text-xl font-medium mb-1">开始上传图片</p>
          <p className="text-gray-500 text-sm">点击或拖拽，单次上限 30 张</p>
          <input type="file" multiple accept="image/*" className="hidden" onChange={handleFileUpload} />
        </label>
      </div>
    );
  }

  const currentImage = images[currentIndex];

  return (
    <div className="h-screen bg-black text-white flex flex-col overflow-hidden select-none">
      
      {/* 顶部 */}
      <div className="h-14 flex items-center justify-between px-4 bg-[#121212] border-b border-gray-800 shrink-0 z-50">
        <div className="flex items-center gap-2 font-bold text-sm">
           <div className="bg-blue-600 p-1 rounded-md"><Crop size={14} /></div> FlowCrop
        </div>
        <div className="bg-gray-800 px-3 py-1 rounded-full text-xs font-mono text-gray-300">
          {currentIndex + 1} / {images.length}
        </div>
        <button onClick={() => setStep('upload')} className="text-xs text-gray-500 hover:text-white transition">退出</button>
      </div>

      {/* 比例 */}
      <div className="h-12 flex items-center px-4 bg-[#121212] gap-3 overflow-x-auto border-b border-gray-800/50 shrink-0 no-scrollbar">
        {ASPECT_RATIOS.map(ratio => (
          <button 
            key={ratio.label}
            onClick={() => setAspectRatio(ratio.value)}
            className={`whitespace-nowrap px-4 py-1.5 rounded-full text-xs transition ${aspectRatio === ratio.value ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-800'}`}
          >
            {ratio.label}
          </button>
        ))}
      </div>

      {/* 工作区 */}
      <div 
        ref={containerRef}
        className="flex-1 relative overflow-hidden bg-black touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <img 
            src={currentImage.url} 
            draggable={false}
            style={{ transform: `translate(${currentImage.transform.x}px, ${currentImage.transform.y}px) scale(${currentImage.transform.scale})` }}
            className="max-w-full max-h-full object-contain pointer-events-none transition-transform duration-75"
          />
        </div>

        <canvas ref={visualCanvasRef} className="absolute inset-0 pointer-events-none z-10" />

        <div className="absolute inset-0 pointer-events-none z-20 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 shadow-[inset_0_0_100px_rgba(0,0,0,1)]" />
          <div 
            className="relative border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.6)]"
            style={{ width: aspectRatio ? '80%' : '90%', aspectRatio: aspectRatio || 'auto', maxHeight: aspectRatio ? '80%' : '90%' }}
          >
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-20 pointer-events-none">
              <div className="border-r border-b border-white"></div><div className="border-r border-b border-white"></div><div className="border-b border-white"></div>
              <div className="border-r border-b border-white"></div><div className="border-r border-b border-white"></div><div className="border-b border-white"></div>
              <div className="border-r border-white"></div><div className="border-r border-white"></div><div></div>
            </div>
            {/* 角标 */}
            <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-white rounded-tl-sm"></div>
            <div className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-white rounded-tr-sm"></div>
            <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-white rounded-bl-sm"></div>
            <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-white rounded-br-sm"></div>
          </div>
        </div>
      </div>

      {/* 底部控制 */}
      <div className="bg-[#121212] border-t border-gray-800 p-4 pb-8 shrink-0 flex flex-col gap-4">
        
        <div className="flex items-center justify-between">
          <div className="flex bg-[#1E1E1E] p-1 rounded-2xl">
            <button onClick={() => setEditMode('move')} className={`p-3 rounded-xl transition ${editMode === 'move' ? 'bg-blue-600 shadow-lg' : 'text-gray-500'}`} title="平移缩放"><Move size={22} /></button>
            <button onClick={() => setEditMode('smudge')} className={`p-3 rounded-xl transition ${editMode === 'smudge' ? 'bg-blue-600 shadow-lg' : 'text-gray-500'}`} title="去水印涂抹"><Eraser size={22} /></button>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setImages(prev => { const n=[...prev]; n[currentIndex].smudgePaths=[]; return n; })} className="p-3 bg-[#1E1E1E] rounded-xl text-gray-400 hover:text-white" title="重置涂抹"><RefreshCw size={22} /></button>
            <button onClick={handleSaveCurrent} className="flex items-center gap-2 px-5 bg-green-600 hover:bg-green-500 rounded-xl font-medium transition shadow-lg shadow-green-900/20"><Save size={20} /> 保存当前</button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-2">
            <button onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} disabled={currentIndex===0} className="w-12 h-12 flex items-center justify-center bg-[#1E1E1E] rounded-2xl disabled:opacity-20"><ChevronLeft /></button>
            <button onClick={() => setCurrentIndex(Math.min(images.length-1, currentIndex + 1))} disabled={currentIndex===images.length-1} className="w-12 h-12 flex items-center justify-center bg-[#1E1E1E] rounded-2xl disabled:opacity-20"><ChevronRight /></button>
          </div>
          
          <div className="flex gap-2 flex-1">
            <button onClick={handleSaveAll} disabled={isExporting} className="flex-1 h-12 flex items-center justify-center gap-2 bg-gray-800 rounded-2xl text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50">
               {isExporting ? <RefreshCw className="animate-spin" /> : <ImageIcon size={18} />} 全部保存
            </button>
            <button onClick={handleExportZip} disabled={isExporting} className="flex-1 h-12 flex items-center justify-center gap-2 bg-blue-600 rounded-2xl text-sm font-bold hover:bg-blue-500 transition shadow-lg shadow-blue-900/30 disabled:opacity-50">
               {isExporting ? <RefreshCw className="animate-spin" /> : <Download size={18} />} 导出 ZIP
            </button>
          </div>
        </div>
      </div>

      {/* 手机端长按保存弹窗 */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-6" onClick={() => setShowPreviewModal(null)}>
          <div className="absolute top-6 right-6 text-gray-400"><X size={32} /></div>
          <p className="text-blue-400 mb-4 animate-pulse font-medium">✨ 请长按下方图片选择“保存到相册”</p>
          <img src={showPreviewModal} className="max-w-full max-h-[70vh] rounded-lg shadow-2xl border border-white/10" onClick={e => e.stopPropagation()} />
          <button className="mt-8 px-8 py-3 bg-white/10 rounded-full text-sm">点击空白处关闭</button>
        </div>
      )}

    </div>
  );
}