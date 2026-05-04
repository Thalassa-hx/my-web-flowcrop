import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, Settings, RefreshCw, ChevronLeft, ChevronRight, Crop, Move, Eraser, Save, Image as ImageIcon, X, Sparkles, Layers } from 'lucide-react';

const ASPECT_RATIOS = [
  { label: '1:1', value: 1 },
  { label: '3:4', value: 0.75 },
  { label: '4:3', value: 1.333 },
  { label: '16:9', value: 1.778 },
  { label: '960:540', value: 960 / 540 },
  { label: '自由', value: null }
];

export default function App() {
  const [step, setStep] = useState('upload'); 
  const [images, setImages] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [aspectRatio, setAspectRatio] = useState(960 / 540); 
  const [editMode, setEditMode] = useState('move'); 
  const [isExporting, setIsExporting] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(null); 

  // 导出配置
  const [exportFormat, setExportFormat] = useState('image/png');
  const [exportQuality, setExportQuality] = useState(1);
  const [targetSize, setTargetSize] = useState('960x540'); 

  const containerRef = useRef(null);
  const visualCanvasRef = useRef(null);
  const activePointers = useRef(new Map());
  const pinchStartRef = useRef(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);

  useEffect(() => {
    if (!window.JSZip) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  const getMaskSize = () => {
    if (!containerRef.current) return { width: 0, height: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const padding = 40; 
    const maxW = rect.width - padding * 2;
    const maxH = rect.height - padding * 2;

    if (!aspectRatio) return { width: maxW * 0.9, height: maxH * 0.9 };

    let targetW = maxW * 0.8;
    let targetH = targetW / aspectRatio;

    if (targetH > maxH) {
      targetH = maxH;
      targetW = targetH * aspectRatio;
    }
    return { width: targetW, height: targetH };
  };

  const getClampedTransform = (x, y, scale, imgData) => {
    if (!containerRef.current || !imgData) return { x, y };
    const { width: maskWidth, height: maskHeight } = getMaskSize();
    const rect = containerRef.current.getBoundingClientRect();

    const imgRatio = imgData.width / imgData.height;
    let initialW, initialH;
    if (imgRatio > rect.width / rect.height) {
      initialW = rect.width; initialH = rect.width / imgRatio;
    } else {
      initialH = rect.height; initialW = rect.height * imgRatio;
    }

    const currentW = initialW * scale;
    const currentH = initialH * scale;

    const maxX = Math.max(0, (currentW - maskWidth) / 2);
    const maxY = Math.max(0, (currentH - maskHeight) / 2);

    return {
      x: Math.max(-maxX, Math.min(x, maxX)),
      y: Math.max(-maxY, Math.min(y, maxY))
    };
  };

  const getMinScale = (imgIdx) => {
    if (!containerRef.current || !images[imgIdx]) return 0.1;
    const rect = containerRef.current.getBoundingClientRect();
    const { width: maskWidth, height: maskHeight } = getMaskSize();
    const imgRatio = images[imgIdx].width / images[imgIdx].height;
    let initialW, initialH;
    if (imgRatio > rect.width / rect.height) {
      initialW = rect.width; initialH = rect.width / imgRatio;
    } else {
      initialH = rect.height; initialW = rect.height * imgRatio;
    }
    return Math.max(maskWidth / initialW, maskHeight / initialH);
  };

  const handleWheel = (e) => {
    if (editMode !== 'move') return;
    e.preventDefault(); 
    const delta = -e.deltaY * 0.0015; 
    const minScale = getMinScale(currentIndex);
    
    setImages(prev => {
      if (prev.length === 0) return prev;
      const newImages = [...prev];
      const img = newImages[currentIndex];
      const targetScale = Math.max(minScale, Math.min(img.transform.scale + delta, 5));
      const clamped = getClampedTransform(img.transform.x, img.transform.y, targetScale, img);
      newImages[currentIndex].transform = { ...clamped, scale: targetScale };
      return newImages;
    });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || step !== 'edit') return;
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [step, currentIndex, editMode, aspectRatio, images]);

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files).slice(0, 30);
    if (files.length === 0) return;
    const loadPromises = files.map(file => {
      return new Promise((resolve) => {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = () => {
          resolve({
            id: Date.now() + Math.random(),
            file, url: img.src,
            width: img.naturalWidth, height: img.naturalHeight,
            transform: { x: 0, y: 0, scale: 1.2 }, 
            smudgePaths: []
          });
        };
      });
    });
    Promise.all(loadPromises).then(newImages => {
      setImages(newImages);
      setCurrentIndex(0);
      setStep('edit');
    });
  };

  const updateRatio = (val) => {
    setAspectRatio(val);
    if (images.length === 0) return; 

    setTimeout(() => {
      setImages(prev => {
        if (prev.length === 0) return prev;
        const n = [...prev];
        const min = getMinScale(currentIndex);
        const targetScale = Math.max(min, n[currentIndex].transform.scale);
        const clamped = getClampedTransform(n[currentIndex].transform.x, n[currentIndex].transform.y, targetScale, n[currentIndex]);
        n[currentIndex].transform = { ...clamped, scale: targetScale };
        return n;
      });
    }, 50);
  };

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
          const img = newImages[currentIndex];
          const targetX = img.transform.x + dx;
          const targetY = img.transform.y + dy;
          const clamped = getClampedTransform(targetX, targetY, img.transform.scale, img);
          newImages[currentIndex].transform = { ...img.transform, ...clamped };
          return newImages;
        });
        dragStart.current = { x: e.clientX, y: e.clientY };
      } else if (activePointers.current.size === 2 && pinchStartRef.current) {
        const pts = Array.from(activePointers.current.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const minScale = getMinScale(currentIndex);
        const targetScale = Math.max(minScale, Math.min(pinchStartRef.current.initialScale * (dist / pinchStartRef.current.initialDist), 5));
        
        setImages(prev => {
          const newImages = [...prev];
          const img = newImages[currentIndex];
          const clamped = getClampedTransform(img.transform.x, img.transform.y, targetScale, img);
          newImages[currentIndex].transform = { ...clamped, scale: targetScale };
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

  const getCroppedCanvas = (index) => {
    return new Promise((resolve) => {
      const imgObj = new Image();
      const item = images[index];
      imgObj.src = item.url;
      imgObj.onload = () => {
        const canvas = document.createElement('canvas');
        const { width: maskWidth, height: maskHeight } = getMaskSize();
        const rect = containerRef.current.getBoundingClientRect();
        
        if (targetSize === '960x540') {
          canvas.width = 960;
          canvas.height = 540;
        } else {
          canvas.width = maskWidth * 2; 
          canvas.height = maskHeight * 2;
        }

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'black'; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const exportScaleX = canvas.width / maskWidth;
        const exportScaleY = canvas.height / maskHeight;

        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(item.transform.scale * exportScaleX, item.transform.scale * exportScaleY);
        ctx.translate(item.transform.x / item.transform.scale, item.transform.y / item.transform.scale);
        
        const imgRatio = imgObj.width / imgObj.height;
        let drawW, drawH;
        if (imgRatio > (rect.width/rect.height)) {
          drawW = rect.width; drawH = rect.width / imgRatio;
        } else {
          drawH = rect.height; drawW = rect.height * imgRatio;
        }
        ctx.drawImage(imgObj, -drawW/2, -drawH/2, drawW, drawH);

        if (item.smudgePaths && item.smudgePaths.length > 0) {
          item.smudgePaths.forEach(path => {
            if (path.points.length < 2) return;
            ctx.save(); ctx.beginPath();
            const startX = (path.points[0].x - rect.width/2 - item.transform.x) / item.transform.scale;
            const startY = (path.points[0].y - rect.height/2 - item.transform.y) / item.transform.scale;
            ctx.moveTo(startX, startY);
            for(let i=1; i<path.points.length; i++) {
              const px = (path.points[i].x - rect.width/2 - item.transform.x) / item.transform.scale;
              const py = (path.points[i].y - rect.height/2 - item.transform.y) / item.transform.scale;
              ctx.lineTo(px, py);
            }
            ctx.lineWidth = 30 / item.transform.scale; 
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.stroke(); ctx.clip(); ctx.filter = 'blur(15px)';
            ctx.drawImage(imgObj, -drawW/2, -drawH/2, drawW, drawH); ctx.restore();
          });
        }
        ctx.restore(); 
        resolve(canvas);
      };
    });
  };

  const handleSaveCurrent = async () => {
    const canvas = await getCroppedCanvas(currentIndex);
    const dataUrl = canvas.toDataURL(exportFormat, exportQuality);
    if (window.innerWidth < 768) { setShowPreviewModal(dataUrl); } 
    else { const a = document.createElement('a'); a.href = dataUrl; a.download = `flowcrop_${Date.now()}.${exportFormat.split('/')[1]}`; a.click(); }
  };

  const handleSaveAll = async () => {
    setIsExporting(true);
    for (let i = 0; i < images.length; i++) {
      const canvas = await getCroppedCanvas(i);
      const dataUrl = canvas.toDataURL(exportFormat, exportQuality);
      const a = document.createElement('a'); a.href = dataUrl; a.download = `flowcrop_all_${i+1}.${exportFormat.split('/')[1]}`; a.click();
      await new Promise(r => setTimeout(r, 500));
    }
    setIsExporting(false);
  };

  const handleExportZip = async () => {
    if (!window.JSZip) return;
    setIsExporting(true);
    const zip = new window.JSZip();
    for (let i = 0; i < images.length; i++) {
      const canvas = await getCroppedCanvas(i);
      const blob = await new Promise(res => canvas.toBlob(res, exportFormat, exportQuality));
      zip.file(`cropped_${i + 1}.${exportFormat.split('/')[1]}`, blob);
    }
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a'); a.href = url; a.download = `FlowCrop_Pack_${Date.now()}.zip`; a.click();
    setIsExporting(false);
  };

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
      ctx.beginPath(); ctx.moveTo(path.points[0].x, path.points[0].y);
      path.points.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; ctx.lineWidth = 30; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.stroke();
    });
  }, [images, currentIndex, step]);

  // ==========================================
  //  UI/UX PRO MAX 视觉重构 - 上传界面
  // ==========================================
  if (step === 'upload') {
    return (
      <div className="relative min-h-screen bg-[#09090b] text-zinc-100 flex flex-col items-center justify-center p-6 sm:p-12 overflow-hidden selection:bg-violet-500/30">
        {/* 背景氛围光效 */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-violet-600/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[400px] bg-blue-600/10 blur-[100px] rounded-full pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center w-full max-w-2xl">
          {/* Logo 区域 */}
          <div className="flex items-center gap-4 mb-12 animate-fade-in-up">
            <div className="relative bg-gradient-to-br from-blue-500 to-violet-600 p-3.5 rounded-2xl shadow-lg shadow-violet-500/25 ring-1 ring-white/20">
              <Crop size={28} className="text-white drop-shadow-md" />
              <div className="absolute -top-1 -right-1 bg-[#09090b] rounded-full p-0.5"><Sparkles size={12} className="text-violet-400" /></div>
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white">
              Flow<span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-violet-400">Crop</span>
              <span className="inline-block ml-3 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-zinc-400 font-medium align-middle uppercase tracking-wider backdrop-blur-sm">
                Pro Max
              </span>
            </h1>
          </div>

          {/* 核心上传区 */}
          <label className="group relative w-full aspect-[2/1] sm:aspect-video rounded-[2.5rem] overflow-hidden cursor-pointer transition-all duration-500 hover:scale-[1.01] shadow-2xl shadow-black/50">
            {/* 渐变发光边框效果 */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 via-violet-500/10 to-fuchsia-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="absolute inset-[2px] bg-[#0f0f11]/90 backdrop-blur-xl rounded-[2.5rem] flex flex-col items-center justify-center border border-dashed border-white/10 group-hover:border-violet-500/40 transition-colors duration-300">
              <div className="bg-white/5 p-5 rounded-full mb-5 group-hover:bg-violet-500/10 transition-colors duration-300">
                <Upload size={40} className="text-zinc-400 group-hover:text-violet-400 transition-colors duration-300" />
              </div>
              <p className="text-2xl font-semibold mb-2 text-zinc-200 group-hover:text-white transition-colors">拖拽或点击上传图片</p>
              <p className="text-zinc-500 text-sm font-medium">支持批量多选，单次上限 <span className="text-violet-400">30</span> 张</p>
            </div>
            <input type="file" multiple accept="image/*" className="hidden" onChange={handleFileUpload} />
          </label>

          {/* 导出设置卡片 */}
          <div className="w-full mt-8 bg-[#0f0f11]/80 backdrop-blur-xl rounded-[2rem] p-6 sm:p-8 border border-white/5 shadow-xl">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-zinc-300 mb-6 tracking-wide uppercase">
              <Settings size={16} className="text-violet-400"/> 导出偏好设置
            </h4>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500 ml-1">文件格式</label>
                <div className="relative">
                  <select 
                    value={exportFormat} 
                    onChange={e => setExportFormat(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-sm text-zinc-200 appearance-none outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-all cursor-pointer"
                  >
                    <option value="image/jpeg" className="bg-[#18181b]">JPG (推荐，体积小)</option>
                    <option value="image/png" className="bg-[#18181b]">PNG (透明背景/无损)</option>
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={16} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500 ml-1">渲染画质</label>
                <div className="relative">
                  <select 
                    value={exportQuality} 
                    onChange={e => setExportQuality(parseFloat(e.target.value))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-sm text-zinc-200 appearance-none outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-all cursor-pointer"
                  >
                    <option value={1} className="bg-[#18181b]">极高 (100% 原始画质)</option>
                    <option value={0.9} className="bg-[#18181b]">高 (90% 均衡推荐)</option>
                    <option value={0.8} className="bg-[#18181b]">中 (80%)</option>
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={16} />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-500 ml-1">统一导出尺寸</label>
              <div className="relative">
                <select 
                  value={targetSize} 
                  onChange={e => {
                    const val = e.target.value;
                    setTargetSize(val);
                    if(val === '960x540') setAspectRatio(960/540);
                  }}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-sm text-violet-300 font-medium appearance-none outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-all cursor-pointer"
                >
                  <option value="auto" className="bg-[#18181b]">自适应 (保持当前超清分辨率)</option>
                  <option value="960x540" className="bg-[#18181b]">固定 960 × 540 像素 (常用预设)</option>
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-violet-400 pointer-events-none" size={16} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 辅助图标组件
  function ChevronDown(props) {
    return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
  }

  // ==========================================
  //  UI/UX PRO MAX 视觉重构 - 编辑界面
  // ==========================================
  const currentImage = images[currentIndex];
  const { width: maskWidth, height: maskHeight } = getMaskSize();

  return (
    <div className="h-screen bg-[#000000] text-zinc-100 flex flex-col overflow-hidden select-none font-sans">
      
      {/* 顶部悬浮导航栏 (Glassmorphism) */}
      <div className="absolute top-0 left-0 right-0 z-50 h-16 flex items-center justify-between px-4 sm:px-6 bg-[#09090b]/80 backdrop-blur-2xl border-b border-white/5">
        <div className="flex items-center gap-3">
           <div className="bg-gradient-to-tr from-blue-600 to-violet-600 p-1.5 rounded-lg shadow-lg shadow-violet-500/20">
             <Crop size={16} className="text-white" />
           </div>
           <span className="font-bold text-base tracking-wide text-zinc-100">FlowCrop</span>
        </div>
        
        {/* 比例切换 (居中) */}
        <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-1.5 bg-white/5 p-1 rounded-full border border-white/5">
          {ASPECT_RATIOS.map(ratio => (
            <button 
              key={ratio.label}
              onClick={() => updateRatio(ratio.value)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-300 ${aspectRatio === ratio.value ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
            >
              {ratio.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <div className="bg-white/5 px-4 py-1.5 rounded-full text-xs font-mono text-zinc-300 border border-white/5 shadow-inner">
            {currentIndex + 1} <span className="text-zinc-600">/</span> {images.length}
          </div>
          <button onClick={() => setStep('upload')} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 移动端比例栏 */}
      <div className="md:hidden absolute top-16 left-0 right-0 z-40 h-12 flex items-center px-4 bg-[#09090b]/90 backdrop-blur-xl gap-2 overflow-x-auto border-b border-white/5 no-scrollbar">
        {ASPECT_RATIOS.map(ratio => (
          <button 
            key={ratio.label}
            onClick={() => updateRatio(ratio.value)}
            className={`whitespace-nowrap px-5 py-1.5 rounded-full text-xs font-medium transition-all duration-300 ${aspectRatio === ratio.value ? 'bg-zinc-800 text-white border border-white/10' : 'text-zinc-400 bg-white/5 border border-transparent'}`}
          >
            {ratio.label}
          </button>
        ))}
      </div>

      {/* 核心工作区 */}
      <div 
        ref={containerRef}
        className="flex-1 relative overflow-hidden bg-[#0A0A0C] touch-none"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0)', backgroundSize: '32px 32px' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="absolute inset-0 flex items-center justify-center pt-24 pb-28 md:pt-16 md:pb-24">
          <img 
            src={currentImage.url} 
            draggable={false}
            style={{ transform: `translate(${currentImage.transform.x}px, ${currentImage.transform.y}px) scale(${currentImage.transform.scale})`, willChange: 'transform' }}
            className="max-w-full max-h-full object-contain pointer-events-none transition-transform duration-75"
          />
        </div>

        <canvas ref={visualCanvasRef} className="absolute inset-0 pointer-events-none z-10" />

        <div className="absolute inset-0 pointer-events-none z-20 flex items-center justify-center pt-24 pb-28 md:pt-16 md:pb-24">
          {/* 高级暗角遮罩 */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />
          
          {/* 裁剪框 - 升级版 */}
          <div 
            className="relative border border-white/40 shadow-[0_0_0_9999px_rgba(0,0,0,0.7),_0_0_30px_rgba(0,0,0,0.3)] transition-all duration-300 ease-out"
            style={{ width: maskWidth || '80%', height: maskHeight || '80%' }}
          >
            {/* 网格参考线 */}
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-20 pointer-events-none">
              <div className="border-r border-b border-white"></div><div className="border-r border-b border-white"></div><div className="border-b border-white"></div>
              <div className="border-r border-b border-white"></div><div className="border-r border-b border-white"></div><div className="border-b border-white"></div>
              <div className="border-r border-white"></div><div className="border-r border-white"></div><div></div>
            </div>
            {/* 视觉角标 */}
            <div className="absolute -top-[1.5px] -left-[1.5px] w-6 h-6 border-t-[3px] border-l-[3px] border-white rounded-tl-sm shadow-[0_0_10px_rgba(255,255,255,0.2)]"></div>
            <div className="absolute -top-[1.5px] -right-[1.5px] w-6 h-6 border-t-[3px] border-r-[3px] border-white rounded-tr-sm shadow-[0_0_10px_rgba(255,255,255,0.2)]"></div>
            <div className="absolute -bottom-[1.5px] -left-[1.5px] w-6 h-6 border-b-[3px] border-l-[3px] border-white rounded-bl-sm shadow-[0_0_10px_rgba(255,255,255,0.2)]"></div>
            <div className="absolute -bottom-[1.5px] -right-[1.5px] w-6 h-6 border-b-[3px] border-r-[3px] border-white rounded-br-sm shadow-[0_0_10px_rgba(255,255,255,0.2)]"></div>
          </div>
        </div>
      </div>

      {/* 底部控制岛 (Floating Island Design) */}
      <div className="absolute bottom-6 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:w-[800px] z-50">
        <div className="bg-[#18181b]/90 backdrop-blur-2xl border border-white/10 rounded-3xl p-3 shadow-2xl flex flex-col gap-3">
          
          <div className="flex items-center justify-between px-1">
            {/* 左侧工具栏 */}
            <div className="flex bg-black/40 p-1 rounded-2xl border border-white/5">
              <button onClick={() => setEditMode('move')} className={`p-2.5 rounded-xl transition-all duration-300 ${editMode === 'move' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`} title="平移与缩放"><Move size={20} /></button>
              <button onClick={() => setEditMode('smudge')} className={`p-2.5 rounded-xl transition-all duration-300 ${editMode === 'smudge' ? 'bg-violet-600 text-white shadow-md shadow-violet-900/30' : 'text-zinc-500 hover:text-zinc-300'}`} title="智能去水印"><Eraser size={20} /></button>
              <div className="w-[1px] bg-white/10 mx-1 my-1"></div>
              <button onClick={() => setImages(prev => { const n=[...prev]; n[currentIndex].smudgePaths=[]; n[currentIndex].transform={x:0,y:0,scale:getMinScale(currentIndex)}; return n; })} className="p-2.5 rounded-xl text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors" title="重置图片"><RefreshCw size={20} /></button>
            </div>

            {/* 中间翻页 (桌面端显示) */}
            <div className="hidden md:flex gap-2">
              <button onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} disabled={currentIndex===0} className="w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-full disabled:opacity-20 transition-colors"><ChevronLeft size={18} /></button>
              <button onClick={() => setCurrentIndex(Math.min(images.length-1, currentIndex + 1))} disabled={currentIndex===images.length-1} className="w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-full disabled:opacity-20 transition-colors"><ChevronRight size={18} /></button>
            </div>

            {/* 右侧：单张保存 */}
            <button onClick={handleSaveCurrent} className="group relative flex items-center gap-2 px-5 py-2.5 bg-zinc-100 hover:bg-white text-zinc-900 rounded-2xl font-semibold transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.2)]">
              <Save size={18} className="group-hover:scale-110 transition-transform duration-300" />
              <span>保存当前</span>
            </button>
          </div>

          <div className="w-full h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent my-1 hidden md:block"></div>

          {/* 底部导出区 */}
          <div className="flex items-center gap-3">
             {/* 移动端翻页移到这里 */}
             <div className="md:hidden flex gap-2 shrink-0">
                <button onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} disabled={currentIndex===0} className="w-12 h-12 flex items-center justify-center bg-black/40 border border-white/5 rounded-2xl disabled:opacity-20 transition-colors"><ChevronLeft size={20}/></button>
                <button onClick={() => setCurrentIndex(Math.min(images.length-1, currentIndex + 1))} disabled={currentIndex===images.length-1} className="w-12 h-12 flex items-center justify-center bg-black/40 border border-white/5 rounded-2xl disabled:opacity-20 transition-colors"><ChevronRight size={20} /></button>
             </div>

            <button onClick={handleSaveAll} disabled={isExporting} className="flex-1 h-12 flex items-center justify-center gap-2 bg-black/40 hover:bg-black/60 border border-white/5 rounded-2xl text-sm font-medium transition-all duration-300 disabled:opacity-50 text-zinc-300 hover:text-white">
               {isExporting ? <RefreshCw className="animate-spin" size={18} /> : <ImageIcon size={18} />} 全部保存相册
            </button>
            <button onClick={handleExportZip} disabled={isExporting} className="flex-1 h-12 relative flex items-center justify-center gap-2 rounded-2xl text-sm font-bold text-white transition-all duration-300 disabled:opacity-50 overflow-hidden group">
               <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-violet-600 transition-transform duration-500 group-hover:scale-105" />
               <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity" />
               <span className="relative flex items-center gap-2 z-10 drop-shadow-md">
                 {isExporting ? <RefreshCw className="animate-spin" size={18} /> : <Download size={18} />} 导出 ZIP 包
               </span>
            </button>
          </div>

        </div>
      </div>

      {/* 手机端长按保存弹窗 */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-[100] bg-[#09090b]/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 animate-in fade-in duration-300" onClick={() => setShowPreviewModal(null)}>
          <div className="absolute top-6 right-6 text-zinc-500 hover:text-white bg-white/5 p-2 rounded-full cursor-pointer transition-colors"><X size={24} /></div>
          <div className="flex items-center gap-2 mb-6 text-violet-400 bg-violet-400/10 px-4 py-2 rounded-full border border-violet-400/20">
             <Sparkles size={16} className="animate-pulse" />
             <p className="text-sm font-medium">长按下方图片，选择“保存到相册”</p>
          </div>
          <div className="relative p-1 rounded-2xl bg-gradient-to-br from-white/20 to-white/5 shadow-2xl">
             <img src={showPreviewModal} className="max-w-full max-h-[65vh] rounded-xl" onClick={e => e.stopPropagation()} />
          </div>
          <button className="mt-10 px-8 py-3 bg-white/10 hover:bg-white/20 border border-white/10 rounded-full text-sm font-medium text-white transition-colors">完成并关闭</button>
        </div>
      )}

    </div>
  );
}