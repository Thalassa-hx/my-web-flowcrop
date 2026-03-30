import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, Image as ImageIcon, Download, ChevronRight, ChevronLeft, 
  RotateCw, RefreshCcw, Brush, Move, Settings, CheckCircle2, ScanFace, X
} from 'lucide-react';

// --- 工具函数：根据比例获取宽高 ---
const getAspectSize = (ratioStr, maxWidth, maxHeight) => {
  if (ratioStr === 'free') return { width: maxWidth * 0.8, height: maxHeight * 0.8 };
  const [w, h] = ratioStr.split(':').map(Number);
  const ratio = w / h;
  let targetWidth = maxWidth * 0.8;
  let targetHeight = targetWidth / ratio;
  
  if (targetHeight > maxHeight * 0.8) {
    targetHeight = maxHeight * 0.8;
    targetWidth = targetHeight * ratio;
  }
  return { width: targetWidth, height: targetHeight };
};

export default function BatchCropper() {
  const [step, setStep] = useState('upload'); // upload, edit, export
  const [images, setImages] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  
  // 全局设置
  const [globalRatio, setGlobalRatio] = useState('1:1');
  const [exportFormat, setExportFormat] = useState('image/jpeg');
  const [exportQuality, setExportQuality] = useState(0.9);
  const [autoFaceDetect, setAutoFaceDetect] = useState(false);

  // 编辑器状态
  const [editMode, setEditMode] = useState('move'); // 'move' 或 'smudge'
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1, rotation: 0 });
  const [smudgePaths, setSmudgePaths] = useState([]);
  
  // 引用
  const containerRef = useRef(null);
  const imageRef = useRef(null);
  const smudgeCanvasRef = useRef(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // 修复：使用原生事件绑定来拦截浏览器的默认网页缩放行为
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e) => {
      if (editMode !== 'move') return;
      // 核心代码：阻止浏览器默认的网页滚动/缩放
      e.preventDefault(); 
      // 稍微调大了一点缩放灵敏度，让触控板更顺滑
      const zoomSensitivity = 0.002; 
      const delta = -e.deltaY * zoomSensitivity;
      setTransform(prev => ({
        ...prev,
        scale: Math.max(0.1, Math.min(prev.scale + delta, 5))
      }));
    };

    // 必须设置为 passive: false 才能生效
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [editMode, step, currentIndex]);

  // 动态加载 JSZip
  useEffect(() => {
    if (!window.JSZip) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  // --- 步骤一：上传图片 ---
  const handleUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    if (files.length > 30) {
      alert("一次最多只能上传 30 张图片！已截取前 30 张。");
      files.splice(30);
    }

    const newImages = files.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      url: URL.createObjectURL(file),
      name: file.name,
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      smudgePaths: [],
      ratio: globalRatio,
      processedDataUrl: null // 保存最终裁剪的图片
    }));

    setImages(newImages);
    setCurrentIndex(0);
    setStep('edit');
  };

  // --- 步骤二：编辑器逻辑 ---
  const currentImage = images[currentIndex];

  // 初始化当前图片的变换状态
  useEffect(() => {
    if (currentImage && step === 'edit') {
      // 模拟人脸识别居中 (向下平移一点模拟脸部位置)
      let initialTransform = currentImage.transform;
      if (autoFaceDetect && currentImage.transform.scale === 1 && currentImage.transform.x === 0) {
         initialTransform = { ...initialTransform, y: 20 }; // 假装人脸偏上
      }
      setTransform(initialTransform);
      setSmudgePaths(currentImage.smudgePaths || []);
      setGlobalRatio(currentImage.ratio || globalRatio);
      
      // 清空并重绘涂抹画布
      if (smudgeCanvasRef.current && imageRef.current) {
         const ctx = smudgeCanvasRef.current.getContext('2d');
         ctx.clearRect(0, 0, smudgeCanvasRef.current.width, smudgeCanvasRef.current.height);
         (currentImage.smudgePaths || []).forEach(path => drawSmudgePath(ctx, path));
      }
    }
  }, [currentIndex, currentImage, step, autoFaceDetect]);

  // 更新比例
  const handleRatioChange = (e) => {
    const newRatio = e.target.value;
    setGlobalRatio(newRatio);
    // 更新当前及后续图片的比例设定
    setImages(prev => prev.map((img, idx) => 
      idx >= currentIndex ? { ...img, ratio: newRatio } : img
    ));
    setTransform({ x: 0, y: 0, scale: 1, rotation: 0 }); // 切换比例重置当前变换
  };

  // 保存当前进度到列表
  const saveCurrentProgress = () => {
    setImages(prev => {
      const newImages = [...prev];
      newImages[currentIndex] = {
        ...newImages[currentIndex],
        transform,
        smudgePaths,
        ratio: globalRatio
      };
      return newImages;
    });
  };

  // 导航
  const handleNext = async () => {
    saveCurrentProgress();
    // 实际生成裁剪结果并暂存
    const dataUrl = await generateCroppedImage();
    setImages(prev => {
      const newImages = [...prev];
      newImages[currentIndex].processedDataUrl = dataUrl;
      return newImages;
    });

    if (currentIndex < images.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setStep('export');
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      saveCurrentProgress();
      setCurrentIndex(prev => prev - 1);
    }
  };

  // 交互控制 (拖拽/涂抹)
  const onPointerDown = (e) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    
    if (editMode === 'smudge' && smudgeCanvasRef.current) {
       const rect = smudgeCanvasRef.current.getBoundingClientRect();
       const scaleX = smudgeCanvasRef.current.width / rect.width;
       const scaleY = smudgeCanvasRef.current.height / rect.height;
       
       const startX = (e.clientX - rect.left) * scaleX;
       const startY = (e.clientY - rect.top) * scaleY;
       
       const newPath = { points: [{ x: startX, y: startY }] };
       setSmudgePaths(prev => [...prev, newPath]);
    }
  };

  const onPointerMove = (e) => {
    if (!isDragging.current) return;

    if (editMode === 'move') {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      dragStart.current = { x: e.clientX, y: e.clientY };
    } else if (editMode === 'smudge' && smudgeCanvasRef.current) {
       const rect = smudgeCanvasRef.current.getBoundingClientRect();
       const scaleX = smudgeCanvasRef.current.width / rect.width;
       const scaleY = smudgeCanvasRef.current.height / rect.height;
       
       const x = (e.clientX - rect.left) * scaleX;
       const y = (e.clientY - rect.top) * scaleY;
       
       setSmudgePaths(prev => {
         const paths = [...prev];
         paths[paths.length - 1].points.push({ x, y });
         
         // 实时绘制
         const ctx = smudgeCanvasRef.current.getContext('2d');
         drawSmudgePath(ctx, paths[paths.length - 1]);
         return paths;
       });
    }
  };

  const onPointerUp = () => {
    isDragging.current = false;
  };

  // 绘制单条涂抹路径 (使用马赛克/模糊效果)
  const drawSmudgePath = (ctx, path) => {
    if (!path || path.points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(path.points[0].x, path.points[0].y);
    for (let i = 1; i < path.points.length; i++) {
      ctx.lineTo(path.points[i].x, path.points[i].y);
    }
    ctx.strokeStyle = 'rgba(150, 150, 150, 0.9)'; // 模拟模糊遮盖，实际开发中可用复杂的像素算法
    ctx.lineWidth = 30;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.filter = 'blur(5px)'; // HTML5 Canvas 滤镜
    ctx.stroke();
    ctx.filter = 'none';
  };

  // 重置当前图片
  const handleReset = () => {
    setTransform({ x: 0, y: 0, scale: 1, rotation: 0 });
    setSmudgePaths([]);
    if (smudgeCanvasRef.current) {
      const ctx = smudgeCanvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, smudgeCanvasRef.current.width, smudgeCanvasRef.current.height);
    }
  };

  // 核心：生成最终裁剪的图片 (利用隐藏 Canvas)
  const generateCroppedImage = () => {
    return new Promise((resolve) => {
      if (!containerRef.current || !imageRef.current) {
        resolve(null);
        return;
      }

      const containerRect = containerRef.current.getBoundingClientRect();
      const { width: cropWidth, height: cropHeight } = getAspectSize(globalRatio, containerRect.width, containerRect.height);
      
      const canvas = document.createElement('canvas');
      canvas.width = cropWidth;
      canvas.height = cropHeight;
      const ctx = canvas.getContext('2d');

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        // 画布中心
        const cx = cropWidth / 2;
        const cy = cropHeight / 2;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cropWidth, cropHeight);

        ctx.save();
        ctx.translate(cx, cy); // 移动到中心
        ctx.translate(transform.x, transform.y); // 应用用户拖拽
        ctx.rotate((transform.rotation * Math.PI) / 180); // 应用旋转
        ctx.scale(transform.scale, transform.scale); // 应用缩放
        
        // 计算图片在容器中的基础缩放 (object-fit: contain 效果)
        const baseScale = Math.min(containerRect.width / img.width, containerRect.height / img.height);
        const drawWidth = img.width * baseScale;
        const drawHeight = img.height * baseScale;

        // 绘制原图
        ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

        // 绘制涂抹层
        if (smudgeCanvasRef.current) {
           ctx.drawImage(smudgeCanvasRef.current, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        }

        ctx.restore();
        
        // 导出
        const dataUrl = canvas.toDataURL(exportFormat, parseFloat(exportQuality));
        resolve(dataUrl);
      };
      img.src = currentImage.url;
    });
  };

  // --- 步骤三：导出逻辑 ---
  const handleExportZip = async () => {
    if (!window.JSZip) {
      alert("正在加载打包组件，请稍后点击...");
      return;
    }
    const zip = new window.JSZip();
    const folder = zip.folder("cropped_images");
    
    images.forEach((img, index) => {
      if (img.processedDataUrl) {
        // 去掉 dataUrl 的头部
        const base64Data = img.processedDataUrl.split(',')[1];
        const ext = exportFormat === 'image/png' ? 'png' : 'jpg';
        const filename = `cropped_${index + 1}_${img.name.split('.')[0]}.${ext}`;
        folder.file(filename, base64Data, {base64: true});
      }
    });

    const content = await zip.generateAsync({type: "blob"});
    // 触发下载
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = "batch_cropped_images.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };


  // --- 渲染 UI ---
  return (
    <div className="min-h-screen bg-neutral-900 text-white font-sans selection:bg-blue-500/30">
      
      {/* 顶部导航条 */}
      <header className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-950">
        <div className="flex items-center gap-2">
          <ImageIcon className="text-blue-500" />
          <h1 className="text-lg font-semibold tracking-wide">FlowCrop<span className="text-neutral-500 font-normal ml-2 text-sm">批量裁剪大师</span></h1>
        </div>
        
        {step === 'edit' && (
          <div className="flex items-center gap-4 text-sm text-neutral-400">
            <span>进度: <strong className="text-white">{currentIndex + 1}</strong> / {images.length}</span>
            <button 
              onClick={() => {
                if(window.confirm("确定要放弃当前进度并返回首页吗？")) {
                  setStep('upload'); setImages([]);
                }
              }}
              className="hover:text-red-400 transition-colors"
            >
              取消
            </button>
          </div>
        )}
      </header>

      {/* 视图区域 */}
      <main className="flex-1 flex flex-col h-[calc(100vh-65px)]">
        
        {/* --- 视图一：上传 --- */}
        {step === 'upload' && (
          <div className="flex-1 flex flex-col items-center justify-center p-6">
            <div className="max-w-md w-full text-center">
              <div className="bg-neutral-800/50 border-2 border-dashed border-neutral-700 rounded-2xl p-12 hover:border-blue-500/50 hover:bg-neutral-800 transition-all cursor-pointer relative">
                <input 
                  type="file" 
                  multiple 
                  accept="image/*" 
                  onChange={handleUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <Upload className="w-12 h-12 mx-auto text-neutral-400 mb-4" />
                <h3 className="text-xl font-medium mb-2">点击上传图片</h3>
                <p className="text-neutral-500 text-sm">支持批量多选，单次最多 30 张</p>
              </div>
              
              <div className="mt-8 text-left bg-neutral-800/30 p-4 rounded-xl">
                <h4 className="flex items-center gap-2 text-sm font-medium text-neutral-300 mb-3"><Settings size={16}/> 预设导出选项</h4>
                <div className="flex flex-col gap-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">导出格式</span>
                    <select value={exportFormat} onChange={e => setExportFormat(e.target.value)} className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 outline-none">
                      <option value="image/jpeg">JPG</option>
                      <option value="image/png">PNG</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">导出画质</span>
                    <select value={exportQuality} onChange={e => setExportQuality(Number(e.target.value))} className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 outline-none">
                      <option value={1}>极高 (无损)</option>
                      <option value={0.9}>高 (推荐)</option>
                      <option value={0.7}>中</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- 视图二：编辑流水线 --- */}
        {step === 'edit' && currentImage && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 操作栏 */}
            <div className="flex flex-wrap items-center justify-between p-3 bg-neutral-900 border-b border-neutral-800 gap-4">
              <div className="flex items-center gap-2 bg-neutral-950 p-1 rounded-lg">
                {['1:1', '3:4', '4:3', '16:9', 'free'].map(ratio => (
                  <button
                    key={ratio}
                    onClick={() => handleRatioChange({target: {value: ratio}})}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${globalRatio === ratio ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}`}
                  >
                    {ratio === 'free' ? '自由' : ratio}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3">
                 <button 
                  onClick={() => setAutoFaceDetect(!autoFaceDetect)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border ${autoFaceDetect ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'bg-transparent border-neutral-700 text-neutral-400'}`}
                >
                  <ScanFace size={14} /> AI 定位
                </button>
                <button onClick={handleReset} className="flex items-center gap-1 text-xs text-neutral-400 hover:text-white px-2">
                  <RefreshCcw size={14} /> 重置
                </button>
              </div>
            </div>

            {/* 画布区域 */}
            <div 
              ref={containerRef}
              className="flex-1 relative bg-black overflow-hidden flex items-center justify-center touch-none select-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              {/* 待裁剪的图片 */}
              <div 
                className="absolute inset-0 flex items-center justify-center"
                style={{
                  transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale}) rotate(${transform.rotation}deg)`,
                  transition: isDragging.current ? 'none' : 'transform 0.1s ease-out'
                }}
              >
                <img 
                  ref={imageRef}
                  src={currentImage.url} 
                  alt="target" 
                  className="max-w-full max-h-full object-contain pointer-events-none"
                  onLoad={(e) => {
                    // 同步涂抹画布的大小
                    if(smudgeCanvasRef.current) {
                      smudgeCanvasRef.current.width = e.target.naturalWidth;
                      smudgeCanvasRef.current.height = e.target.naturalHeight;
                    }
                  }}
                />
                {/* 涂抹层 */}
                <canvas 
                  ref={smudgeCanvasRef}
                  className="absolute inset-0 w-full h-full pointer-events-none opacity-80"
                  style={{ mixBlendMode: 'normal' }}
                />
              </div>

              {/* 裁剪遮罩 (利用 CSS border 构建中空视觉) */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                 {/* 动态计算内部框的大小 */}
                 {containerRef.current && (
                    <div 
                      className="border border-white/50 relative shadow-[0_0_0_9999px_rgba(0,0,0,0.6)]"
                      style={{
                        width: getAspectSize(globalRatio, containerRef.current.clientWidth, containerRef.current.clientHeight).width,
                        height: getAspectSize(globalRatio, containerRef.current.clientWidth, containerRef.current.clientHeight).height,
                      }}
                    >
                      {/* 裁剪框九宫格辅助线 */}
                      <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-30">
                        <div className="border-r border-b border-white"></div>
                        <div className="border-r border-b border-white"></div>
                        <div className="border-b border-white"></div>
                        <div className="border-r border-b border-white"></div>
                        <div className="border-r border-b border-white"></div>
                        <div className="border-b border-white"></div>
                        <div className="border-r border-white"></div>
                        <div className="border-r border-white"></div>
                        <div></div>
                      </div>
                    </div>
                 )}
              </div>
            </div>

            {/* 底部工具与导航 */}
            <div className="bg-neutral-950 p-4 border-t border-neutral-800 flex items-center justify-between">
              
              {/* 模式切换 */}
              <div className="flex bg-neutral-900 rounded-lg p-1">
                <button 
                  onClick={() => setEditMode('move')}
                  className={`p-2 rounded-md transition-colors ${editMode === 'move' ? 'bg-neutral-700 text-white' : 'text-neutral-500'}`}
                  title="移动/缩放"
                >
                  <Move size={20} />
                </button>
                <button 
                  onClick={() => setEditMode('smudge')}
                  className={`p-2 rounded-md transition-colors ${editMode === 'smudge' ? 'bg-blue-600 text-white' : 'text-neutral-500'}`}
                  title="涂抹去水印"
                >
                  <Brush size={20} />
                </button>
                <div className="w-px bg-neutral-800 mx-1"></div>
                <button 
                  onClick={() => setTransform(p => ({ ...p, rotation: p.rotation + 90 }))}
                  className="p-2 text-neutral-500 hover:text-white transition-colors rounded-md"
                  title="旋转 90 度"
                >
                  <RotateCw size={20} />
                </button>
              </div>

              {/* 流水线控制 */}
              <div className="flex gap-2">
                <button 
                  onClick={handlePrev}
                  disabled={currentIndex === 0}
                  className="flex items-center px-4 py-2 bg-neutral-900 text-neutral-300 rounded-lg hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-medium text-sm"
                >
                  <ChevronLeft size={16} className="mr-1" /> 上一张
                </button>
                <button 
                  onClick={handleNext}
                  className="flex items-center px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors font-medium shadow-lg shadow-blue-900/20 text-sm"
                >
                  {currentIndex === images.length - 1 ? '完成处理' : '下一张'} <ChevronRight size={16} className="ml-1" />
                </button>
              </div>

            </div>
          </div>
        )}

        {/* --- 视图三：导出 --- */}
        {step === 'export' && (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="bg-green-500/10 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="text-green-500 w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold mb-2">处理完成！</h2>
            <p className="text-neutral-400 mb-8">已成功处理 {images.length} 张图片</p>
            
            <button 
              onClick={handleExportZip}
              className="flex items-center justify-center gap-2 w-full max-w-xs py-4 bg-white text-black font-semibold rounded-xl hover:bg-neutral-200 transition-transform active:scale-95 text-lg"
            >
              <Download size={20} /> 一键打包下载 (ZIP)
            </button>

            <button 
              onClick={() => { setStep('upload'); setImages([]); }}
              className="mt-6 text-sm text-neutral-500 hover:text-white transition-colors"
            >
              处理新图片
            </button>
          </div>
        )}

      </main>
    </div>
  );
}