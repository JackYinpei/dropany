'use client'
import React, { useRef, useEffect, useState, useCallback } from 'react';

export default function CanvasWhiteboard() {
  const canvasRef = useRef(null);
  const pointerStateRef = useRef({ x: 0, y: 0, moved: false });
  const [cards, setCards] = useState([]);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [draggedCard, setDraggedCard] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showInput, setShowInput] = useState(false);
  const [inputPosition, setInputPosition] = useState({ x: 0, y: 0 });
  const [inputText, setInputText] = useState('');
  const inputRef = useRef(null);
  // 缓存已加载图片，避免重复加载
  const imageCacheRef = useRef(new Map()); // src => HTMLImageElement
  const objectUrlsRef = useRef(new Set()); // 用于卸载时统一 revoke
  const [hoveredCardId, setHoveredCardId] = useState(null);
  const [hoveredHandle, setHoveredHandle] = useState(null); // 'nw'|'ne'|'se'|'sw'|null
  const [resizing, setResizing] = useState(null); // { id, handle, startCanvas, initRect }

  // 将屏幕坐标转换为画布坐标
  const screenToCanvas = (screenX, screenY) => {
    return {
      x: (screenX - offset.x) / scale,
      y: (screenY - offset.y) / scale
    };
  };

  // 将画布坐标转换为屏幕坐标
  const canvasToScreen = (canvasX, canvasY) => {
    return {
      x: canvasX * scale + offset.x,
      y: canvasY * scale + offset.y
    };
  };

  // 文本换行：支持空格优先换行，长字符串回退按字符换行，支持多段落\n
  const wrapTextLines = (ctx, text, maxWidth, fontPx) => {
    ctx.font = `${fontPx}px Arial`;
    const paragraphs = (text || '').replace(/\r\n?/g, '\n').split('\n');
    const lines = [];
    paragraphs.forEach(p => {
      if (p.length === 0) {
        lines.push('');
        return;
      }
      const words = p.split(' ');
      let current = '';
      words.forEach((word, idx) => {
        if (word === '') {
          // 连续空格
          const test = current + ' ';
          if (ctx.measureText(test).width <= maxWidth) {
            current = test;
          } else {
            lines.push(current);
            current = '';
          }
          return;
        }
        const tentative = current + (current ? ' ' : '') + word;
        if (ctx.measureText(tentative).width <= maxWidth) {
          current = tentative;
        } else {
          // 单词过长或当前行不足，按字符拆分
          if (current) {
            lines.push(current);
            current = '';
          }
          let chunk = '';
          for (let ch of word) {
            const t2 = chunk + ch;
            if (ctx.measureText(t2).width <= maxWidth) {
              chunk = t2;
            } else {
              if (chunk) lines.push(chunk);
              chunk = ch;
            }
          }
          if (chunk) current = chunk;
        }
        if (idx === words.length - 1) {
          lines.push(current);
          current = '';
        }
      });
    });
    return lines;
  };

  // 计算文本内容高度
  const measureTextContentHeight = (ctx, text, maxWidth, fontPx, lineHeightPx) => {
    const lines = wrapTextLines(ctx, text, maxWidth, fontPx);
    return { lines, height: lines.length * lineHeightPx };
  };

  // 绘制所有卡片
  const drawCards = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 绘制背景
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 绘制网格
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    const gridSize = 50 * scale;
    const startX = offset.x % gridSize;
    const startY = offset.y % gridSize;

    for (let x = startX; x < canvas.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }

    for (let y = startY; y < canvas.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // 绘制所有卡片
    cards.forEach(card => {
      const screenPos = canvasToScreen(card.x, card.y);
      const cardW = card.width * scale;
      const cardH = card.height * scale;

      // 卡片阴影
      ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 3;

      // 卡片背景
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(screenPos.x, screenPos.y, cardW, cardH);

      // 重置阴影
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      if (card.type === 'image') {
        const img = imageCacheRef.current.get(card.src);
        if (img) {
          ctx.drawImage(img, screenPos.x, screenPos.y, cardW, cardH);
        } else {
          // 占位符
          ctx.fillStyle = '#f5f5f5';
          ctx.fillRect(screenPos.x, screenPos.y, cardW, cardH);
          ctx.fillStyle = '#999';
          ctx.font = `${12 * scale}px Arial`;
          ctx.fillText('加载中...', screenPos.x + 8 * scale, screenPos.y + 8 * scale);
        }
      } else {
        // 绘制文字
        ctx.fillStyle = '#333';
        ctx.textBaseline = 'top';

        const padding = 10 * scale;
        const maxWidth = (card.width - 20) * scale;
        const lineHeight = 18 * scale;
        const fontPx = 14 * scale;

        // 裁剪绘制区域为卡片内，支持滚动
        ctx.save();
        ctx.beginPath();
        ctx.rect(screenPos.x, screenPos.y, cardW, cardH);
        ctx.clip();

        const { lines, height: contentHeight } = measureTextContentHeight(ctx, card.text || '', maxWidth, fontPx, lineHeight);
        const viewportH = cardH - 2 * padding;
        const scrollY = Math.max(0, Math.min(card.scrollY || 0, Math.max(0, (contentHeight - viewportH) / 1)));

        // 起始行与偏移
        const startLine = Math.floor(scrollY / lineHeight);
        let y = screenPos.y + padding - (scrollY - startLine * lineHeight);
        const x = screenPos.x + padding;

        for (let i = startLine; i < lines.length; i++) {
          if (y > screenPos.y + cardH - padding) break;
          ctx.fillText(lines[i], x, y);
          y += lineHeight;
        }

        // 自定义滚动条（内容溢出时显示）
        if (contentHeight > viewportH) {
          const trackW = Math.max(4, 6 * scale);
          const trackX = screenPos.x + cardW - trackW - 2 * scale;
          const trackY = screenPos.y + padding;
          const trackH = viewportH;
          const ratio = viewportH / contentHeight;
          const thumbH = Math.max(20 * scale, trackH * ratio);
          const maxScroll = contentHeight - viewportH;
          const thumbY = trackY + (trackH - thumbH) * (scrollY / maxScroll);

          ctx.fillStyle = 'rgba(0,0,0,0.08)';
          ctx.fillRect(trackX, trackY, trackW, trackH);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fillRect(trackX, thumbY, trackW, thumbH);
        }

        ctx.restore();
      }

      // 卡片边框
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.strokeRect(screenPos.x, screenPos.y, cardW, cardH);

      // 交互手柄（悬停或拖动/缩放时显示）
      const showHandles = hoveredCardId === card.id || (draggedCard && draggedCard.id === card.id) || (resizing && resizing.id === card.id);
      if (showHandles) {
        const hs = 8; // 句柄渲染像素尺寸（屏幕坐标）
        const corners = [
          { name: 'nw', x: screenPos.x, y: screenPos.y },
          { name: 'ne', x: screenPos.x + cardW, y: screenPos.y },
          { name: 'se', x: screenPos.x + cardW, y: screenPos.y + cardH },
          { name: 'sw', x: screenPos.x, y: screenPos.y + cardH },
        ];
        const edges = [
          { name: 'n', x: screenPos.x + cardW / 2, y: screenPos.y },
          { name: 'e', x: screenPos.x + cardW, y: screenPos.y + cardH / 2 },
          { name: 's', x: screenPos.x + cardW / 2, y: screenPos.y + cardH },
          { name: 'w', x: screenPos.x, y: screenPos.y + cardH / 2 },
        ];
        ctx.fillStyle = '#3b82f6';
        [...corners, ...edges].forEach(c => {
          ctx.fillRect(c.x - hs / 2, c.y - hs / 2, hs, hs);
        });
      }
    });
  };

  // 处理画布双击
  const handleCanvasDoubleClick = (e) => {
    if (isPanning) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // 检查是否双击了卡片
    const canvasPos = screenToCanvas(clickX, clickY);
    const clickedCard = cards.find(card => {
      return canvasPos.x >= card.x &&
        canvasPos.x <= card.x + card.width &&
        canvasPos.y >= card.y &&
        canvasPos.y <= card.y + card.height;
    });

    if (clickedCard) return;

    // 显示输入框
    setInputPosition(canvasPos);
    setInputText('');
    setShowInput(true);
  };

  // 添加卡片
  const handleAddCard = () => {
    if (inputText.trim()) {
      const newCard = {
        id: Date.now(),
        type: 'text',
        text: inputText.trim(),
        x: inputPosition.x,
        y: inputPosition.y,
        width: 200,
        height: 100
      };
      setCards([...cards, newCard]);
    }
    setShowInput(false);
    setInputText('');
  };

  // 取消输入
  const handleCancelInput = () => {
    setShowInput(false);
    setInputText('');
  };

  // 处理鼠标按下
  const handleMouseDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    pointerStateRef.current = { x: mouseX, y: mouseY, moved: false };

    // 如果按住空格键，开始拖拽白板
    if (isSpacePressed) {
      setIsPanning(true);
      setPanStart({ x: mouseX - offset.x, y: mouseY - offset.y });
      return;
    }

    const canvasPos = screenToCanvas(mouseX, mouseY);

    // 优先检测是否按在缩放手柄上（从上到下）
    for (let i = cards.length - 1; i >= 0; i--) {
      const card = cards[i];
      const sp = canvasToScreen(card.x, card.y);
      const cardW = card.width * scale;
      const cardH = card.height * scale;
      const hs = 8; // 手柄大小，屏幕像素
      const handles = [
        { name: 'nw', x: sp.x, y: sp.y },
        { name: 'ne', x: sp.x + cardW, y: sp.y },
        { name: 'se', x: sp.x + cardW, y: sp.y + cardH },
        { name: 'sw', x: sp.x, y: sp.y + cardH },
        { name: 'n', x: sp.x + cardW / 2, y: sp.y },
        { name: 'e', x: sp.x + cardW, y: sp.y + cardH / 2 },
        { name: 's', x: sp.x + cardW / 2, y: sp.y + cardH },
        { name: 'w', x: sp.x, y: sp.y + cardH / 2 },
      ];
      for (const h of handles) {
        if (mouseX >= h.x - hs && mouseX <= h.x + hs && mouseY >= h.y - hs && mouseY <= h.y + hs) {
          setResizing({
            id: card.id,
            handle: h.name,
            startCanvas: { x: canvasPos.x, y: canvasPos.y },
            initRect: { x: card.x, y: card.y, width: card.width, height: card.height }
          });
          return;
        }
      }
    }

    // 从后往前查找（最上层的卡片优先）
    for (let i = cards.length - 1; i >= 0; i--) {
      const card = cards[i];
      if (canvasPos.x >= card.x &&
        canvasPos.x <= card.x + card.width &&
        canvasPos.y >= card.y &&
        canvasPos.y <= card.y + card.height) {
        setDraggedCard(card);
        setDragOffset({
          x: canvasPos.x - card.x,
          y: canvasPos.y - card.y
        });
        break;
      }
    }
  };

  // 处理鼠标移动
  const handleMouseMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (!pointerStateRef.current.moved) {
      const dx = Math.abs(mouseX - pointerStateRef.current.x);
      const dy = Math.abs(mouseY - pointerStateRef.current.y);
      if (dx > 2 || dy > 2) {
        pointerStateRef.current.moved = true;
      }
    }

    // 如果正在拖拽白板
    if (isPanning) {
      setOffset({
        x: mouseX - panStart.x,
        y: mouseY - panStart.y
      });
      return;
    }

    const canvasPos = screenToCanvas(mouseX, mouseY);

    // 如果正在缩放卡片
    if (resizing) {
      const { id, handle, initRect } = resizing;
      const minW = 60;
      const minH = 60;
      const dx = canvasPos.x - resizing.startCanvas.x;
      const dy = canvasPos.y - resizing.startCanvas.y;
      setCards(cards.map(card => {
        if (card.id !== id) return card;
        let { x, y, width, height } = initRect;
        if (handle === 'nw') {
          x = initRect.x + dx;
          y = initRect.y + dy;
          width = initRect.width - dx;
          height = initRect.height - dy;
        } else if (handle === 'ne') {
          y = initRect.y + dy;
          width = initRect.width + dx;
          height = initRect.height - dy;
        } else if (handle === 'se') {
          width = initRect.width + dx;
          height = initRect.height + dy;
        } else if (handle === 'sw') {
          x = initRect.x + dx;
          width = initRect.width - dx;
          height = initRect.height + dy;
        } else if (handle === 'n') {
          y = initRect.y + dy;
          height = initRect.height - dy;
        } else if (handle === 's') {
          height = initRect.height + dy;
        } else if (handle === 'e') {
          width = initRect.width + dx;
        } else if (handle === 'w') {
          x = initRect.x + dx;
          width = initRect.width - dx;
        }
        width = Math.max(minW, width);
        height = Math.max(minH, height);
        // 防止反向拖动时 x/y 超出
        if (handle === 'nw' || handle === 'sw' || handle === 'w') {
          x = Math.min(x, initRect.x + initRect.width - minW);
        }
        if (handle === 'nw' || handle === 'ne' || handle === 'n') {
          y = Math.min(y, initRect.y + initRect.height - minH);
        }
        return { ...card, x, y, width, height };
      }));
      return;
    }

    // 如果正在拖拽卡片
    if (draggedCard) {
      setCards(cards.map(card => {
        if (card.id === draggedCard.id) {
          return {
            ...card,
            x: canvasPos.x - dragOffset.x,
            y: canvasPos.y - dragOffset.y
          };
        }
        return card;
      }));
      return;
    }

    // 非拖拽状态：更新悬停卡片与手柄
    let hoverId = null;
    let handleName = null;
    for (let i = cards.length - 1; i >= 0; i--) {
      const card = cards[i];
      if (canvasPos.x >= card.x && canvasPos.x <= card.x + card.width && canvasPos.y >= card.y && canvasPos.y <= card.y + card.height) {
        hoverId = card.id;
        // 检查手柄
        const sp = canvasToScreen(card.x, card.y);
        const cardW = card.width * scale;
        const cardH = card.height * scale;
        const hs = 8;
        const handles = [
          { name: 'nw', x: sp.x, y: sp.y },
          { name: 'ne', x: sp.x + cardW, y: sp.y },
          { name: 'se', x: sp.x + cardW, y: sp.y + cardH },
          { name: 'sw', x: sp.x, y: sp.y + cardH },
          { name: 'n', x: sp.x + cardW / 2, y: sp.y },
          { name: 'e', x: sp.x + cardW, y: sp.y + cardH / 2 },
          { name: 's', x: sp.x + cardW / 2, y: sp.y + cardH },
          { name: 'w', x: sp.x, y: sp.y + cardH / 2 },
        ];
        for (const h of handles) {
          if (mouseX >= h.x - hs && mouseX <= h.x + hs && mouseY >= h.y - hs && mouseY <= h.y + hs) {
            handleName = h.name;
            break;
          }
        }
        break;
      }
    }
    setHoveredCardId(hoverId);
    setHoveredHandle(handleName);
  };

  // 处理鼠标松开
  const handleMouseUp = () => {
    setDraggedCard(null);
    setIsPanning(false);
    setResizing(null);
  };

  // 处理滚轮缩放
  const handleWheel = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const canvasPosBefore = {
        x: (mouseX - offset.x) / scale,
        y: (mouseY - offset.y) / scale
      };
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.1, Math.min(5, scale * delta));
      const newOffset = {
        x: mouseX - canvasPosBefore.x * newScale,
        y: mouseY - canvasPosBefore.y * newScale
      };
      setScale(newScale);
      setOffset(newOffset);
      return;
    }

    // 未按 Ctrl/⌘：尝试滚动文本卡片内容
    const canvasPos = screenToCanvas(mouseX, mouseY);
    for (let i = cards.length - 1; i >= 0; i--) {
      const card = cards[i];
      if (card.type === 'text' && canvasPos.x >= card.x && canvasPos.x <= card.x + card.width && canvasPos.y >= card.y && canvasPos.y <= card.y + card.height) {
        const ctx = canvas.getContext('2d');
        const padding = 10 * scale;
        const maxWidth = (card.width - 20) * scale;
        const lineHeight = 18 * scale;
        const fontPx = 14 * scale;
        const { height: contentHeight } = measureTextContentHeight(ctx, card.text || '', maxWidth, fontPx, lineHeight);
        const viewportH = card.height * scale - 2 * padding;
        if (contentHeight > viewportH) {
          e.preventDefault();
          const maxScroll = contentHeight - viewportH;
          const next = Math.max(0, Math.min((card.scrollY || 0) + e.deltaY, maxScroll));
          setCards(cards.map(c => c.id === card.id ? { ...c, scrollY: next } : c));
        }
        break;
      }
    }
  }, [scale, offset, cards]);

  const handleCanvasClick = async (e) => {
    if (e.detail > 1 || isPanning || isSpacePressed || showInput) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (pointerStateRef.current.moved) return;

    const canvasPos = screenToCanvas(mouseX, mouseY);

    const clickedCard = cards.find(card => {
      return canvasPos.x >= card.x &&
        canvasPos.x <= card.x + card.width &&
        canvasPos.y >= card.y &&
        canvasPos.y <= card.y + card.height;
    });

    if (clickedCard) return;

    if (typeof navigator === 'undefined' || !navigator.clipboard) return;

    // 优先尝试读取图片，其次读取文本
    try {
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        let added = false;
        for (const item of items) {
          const imageType = item.types.find(t => t.startsWith('image/'));
          if (imageType) {
            const blob = await item.getType(imageType);
            // 加载图片并创建卡片
            await new Promise((resolve, reject) => {
              const url = URL.createObjectURL(blob);
              const img = new Image();
              img.onload = () => {
                // 统一缩放到最大边不超过 400 像素
                const maxDim = 400;
                let w = img.width;
                let h = img.height;
                if (w > h && w > maxDim) {
                  const s = maxDim / w;
                  w = Math.round(w * s);
                  h = Math.round(h * s);
                } else if (h >= w && h > maxDim) {
                  const s = maxDim / h;
                  w = Math.round(w * s);
                  h = Math.round(h * s);
                }

                imageCacheRef.current.set(url, img);
                objectUrlsRef.current.add(url);

                const newCard = {
                  id: Date.now(),
                  type: 'image',
                  src: url,
                  x: canvasPos.x,
                  y: canvasPos.y,
                  width: w,
                  height: h
                };
                setCards(prev => [...prev, newCard]);
                resolve();
              };
              img.onerror = (ev) => {
                URL.revokeObjectURL(url);
                reject(ev);
              };
              img.src = url;
            });
            added = true;
            break;
          }
        }
        if (added) return;
      }

      if (navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        const trimmed = text.trim();
        if (!trimmed) return;
        const newCard = {
          id: Date.now(),
          type: 'text',
          text: trimmed,
          x: canvasPos.x,
          y: canvasPos.y,
          width: 200,
          height: 100
        };
        setCards(prev => [...prev, newCard]);
      }
    } catch (err) {
      console.error('读取剪贴板失败', err);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const listener = (event) => handleWheel(event);
    canvas.addEventListener('wheel', listener, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', listener);
    };
  }, [handleWheel]);

  // 处理键盘事件
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !isSpacePressed && !showInput) {
        e.preventDefault();
        setIsSpacePressed(true);
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(false);
        setIsPanning(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isSpacePressed, showInput]);

  // 输入框获得焦点
  useEffect(() => {
    if (showInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showInput]);

  // 初始化 canvas 尺寸
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      drawCards();
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // 重绘画布
  useEffect(() => {
    drawCards();
  }, [cards, scale, offset]);

  // 卸载时释放创建的 objectURL
  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
      imageCacheRef.current.clear();
    };
  }, []);

  // 获取光标样式
  const getCursor = () => {
    if (isPanning) return 'grabbing';
    if (isSpacePressed) return 'grab';
    if (draggedCard) return 'grabbing';
    if (resizing) {
      const map = {
        nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
        n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize'
      };
      return map[resizing.handle] || 'default';
    }
    if (hoveredHandle) {
      const map = {
        nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
        n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize'
      };
      return map[hoveredHandle] || 'default';
    }
    return 'default';
  };

  // 计算输入框在屏幕上的位置
  const getInputScreenPosition = () => {
    const screenPos = canvasToScreen(inputPosition.x, inputPosition.y);
    return {
      left: `${screenPos.x}px`,
      top: `${screenPos.y}px`
    };
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: getCursor(), display: 'block' }}
      />

      {/* 输入框 */}
      {showInput && (
        <div style={{
          position: 'absolute',
          ...getInputScreenPosition(),
          background: 'white',
          border: '2px solid #3b82f6',
          borderRadius: '8px',
          padding: '12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 1000,
          minWidth: '300px'
        }}>
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) {
                handleAddCard();
              } else if (e.key === 'Escape') {
                handleCancelInput();
              }
            }}
            placeholder="输入文字内容..."
            style={{
              width: '100%',
              minHeight: '80px',
              border: 'none',
              outline: 'none',
              fontFamily: 'Arial',
              fontSize: '14px',
              resize: 'vertical',
              marginBottom: '8px'
            }}
          />
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              onClick={handleCancelInput}
              style={{
                padding: '6px 16px',
                border: '1px solid #ccc',
                borderRadius: '4px',
                background: 'white',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              取消 (Esc)
            </button>
            <button
              onClick={handleAddCard}
              style={{
                padding: '6px 16px',
                border: 'none',
                borderRadius: '4px',
                background: '#3b82f6',
                color: 'white',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500'
              }}
            >
              添加 (Ctrl+Enter)
            </button>
          </div>
        </div>
      )}

      {/* 缩放比例显示 */}
      <div style={{
        position: 'absolute',
        left: '20px',
        bottom: '20px',
        background: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        padding: '8px 16px',
        borderRadius: '8px',
        fontFamily: 'monospace',
        fontSize: '14px',
        userSelect: 'none'
      }}>
        缩放: {(scale * 100).toFixed(0)}%
      </div>

      {/* 使用说明 */}
      <div style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        background: 'rgba(255, 255, 255, 0.95)',
        padding: '16px',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        fontSize: '14px',
        maxWidth: '300px'
      }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>使用说明</h3>
        <ul style={{ margin: 0, paddingLeft: '20px' }}>
          <li>点击空白处粘贴剪贴板（图/文）</li>
          <li>双击空白处手动添加文字卡片</li>
          <li>拖动卡片移动位置</li>
          <li>按住空格键拖拽白板</li>
          <li>Ctrl + 滚轮缩放画布</li>
        </ul>
      </div>
    </div>
  );
}
