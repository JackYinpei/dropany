'use client'
import React, { useRef, useEffect, useState, useCallback, useLayoutEffect } from 'react';
const DBG = true;
const dlog = (...args) => { try { if (DBG) console.log('[WB]', ...args); } catch {} };
import { useSession, signIn, signOut } from 'next-auth/react';
import { createBrowserSupabase } from '@/lib/supabaseClient';

export default function CanvasWhiteboard() {
  const canvasRef = useRef(null);
  const pointerStateRef = useRef({ x: 0, y: 0, moved: false });
  const supabaseRef = useRef(null);
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
  // 始终指向最新的绘制函数，用于异步回调中调用
  const drawRef = useRef(() => {});
  // 缓存已加载图片，避免重复加载
  const imageCacheRef = useRef(new Map()); // src => HTMLImageElement
  const objectUrlsRef = useRef(new Set()); // 用于卸载时统一 revoke
  const imageLoadingRef = useRef(new Set()); // 正在加载的 storage 路径，避免重复请求
  const [hoveredCardId, setHoveredCardId] = useState(null);
  const [hoveredHandle, setHoveredHandle] = useState(null); // 'nw'|'ne'|'se'|'sw'|null
  const [resizing, setResizing] = useState(null); // { id, handle, startCanvas, initRect }
  const [selectedCardId, setSelectedCardId] = useState(null);
  const { data: session, status } = useSession();
  const userId = session?.user?.id || null;
  const saveTimersRef = useRef(new Map()); // id -> timeout

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
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    // 重置并清空（用设备像素尺寸）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 将坐标系缩放到 CSS 像素，提高清晰度
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;
    dlog('draw start', { cards: cards.length, scale, offset, dpr, canvasW: canvas.width, canvasH: canvas.height, cssW, cssH });

    // 绘制背景
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, cssW, cssH);

    // 绘制网格
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    const gridSize = 50 * scale;
    const startX = offset.x % gridSize;
    const startY = offset.y % gridSize;

    for (let x = startX; x < cssW; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssH);
      ctx.stroke();
    }

    for (let y = startY; y < cssH; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cssW, y);
      ctx.stroke();
    }

    // 绘制所有卡片
    cards.forEach(card => {
      const screenPos = canvasToScreen(card.x, card.y);
      const cardW = card.width * scale;
      const cardH = card.height * scale;
      dlog('draw card', { id: card.id, type: card.type, screenPos, cardW, cardH });

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
          dlog('image cache hit', card.src);
          ctx.drawImage(img, screenPos.x, screenPos.y, cardW, cardH);
        } else {
          dlog('image cache miss -> signed URL', card.src);
          // 如果是登录态（存的是 storage 路径），尝试触发签名 URL 加载
          if (userId && supabaseRef.current && !imageLoadingRef.current.has(card.src)) {
            // 异步加载，不阻塞绘制
            (async () => {
              try {
                imageLoadingRef.current.add(card.src);
                const { data, error } = await supabaseRef.current.storage.from('cards').createSignedUrl(card.src, 86400);
                if (!error && data?.signedUrl) {
                  dlog('signed url ok', { src: card.src });
                  const url = data.signedUrl;
                  const imgEl = new Image();
                  imgEl.crossOrigin = 'anonymous';
                  imgEl.onload = () => {
                    dlog('image onload', { src: card.src });
                    imageCacheRef.current.set(card.src, imgEl);
                    imageLoadingRef.current.delete(card.src);
                    // 使用最新的绘制函数，避免陈旧闭包清空画布
                    if (drawRef.current) drawRef.current();
                  };
                  imgEl.onerror = () => {
                    dlog('image onerror', { src: card.src });
                    imageLoadingRef.current.delete(card.src);
                  };
                  imgEl.src = url;
                } else {
                  dlog('signed url error', { src: card.src, error });
                  imageLoadingRef.current.delete(card.src);
                }
              } catch {
                dlog('signed url exception', { src: card.src });
                imageLoadingRef.current.delete(card.src);
              }
            })();
          }
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
          // 对齐到整数像素，减少缩小时文字模糊
          ctx.fillText(lines[i], Math.round(x), Math.round(y));
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
      ctx.strokeStyle = selectedCardId === card.id ? '#2563eb' : '#3b82f6';
      ctx.lineWidth = 2;
      ctx.strokeRect(screenPos.x, screenPos.y, cardW, cardH);

      // 交互手柄（悬停或拖动/缩放时显示）
      const showHandles = selectedCardId === card.id || hoveredCardId === card.id || (draggedCard && draggedCard.id === card.id) || (resizing && resizing.id === card.id);
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
    dlog('draw end');
  };

  // 保持 drawRef 指向最新的 drawCards，供异步回调安全调用
  useLayoutEffect(() => {
    drawRef.current = drawCards;
  });

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
      // 持久化
      if (userId && supabaseRef.current) {
        scheduleSave(newCard);
      }
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
      // 记录锚点（世界坐标）
      const anchorCanvas = screenToCanvas(mouseX, mouseY);
      setPanStart({ x: anchorCanvas.x, y: anchorCanvas.y });
      // 初始化最后指针位置
      pointerStateRef.current.x = mouseX;
      pointerStateRef.current.y = mouseY;
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
          setSelectedCardId(card.id);
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
        setSelectedCardId(card.id);
        break;
      }
    }

    // 点击在空白区域则清除选中
    if (!draggedCard && !resizing) {
      let clickedAny = false;
      for (let i = cards.length - 1; i >= 0; i--) {
        const c = cards[i];
        if (canvasPos.x >= c.x && canvasPos.x <= c.x + c.width && canvasPos.y >= c.y && canvasPos.y <= c.y + c.height) {
          clickedAny = true;
          break;
        }
      }
      if (!clickedAny) setSelectedCardId(null);
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

    // 如果正在拖拽白板（锚点式平移：保持按下时的世界点在鼠标下）
    if (isPanning) {
      setOffset({
        x: mouseX - panStart.x * scale,
        y: mouseY - panStart.y * scale
      });
      // 更新最后指针位置
      pointerStateRef.current.x = mouseX;
      pointerStateRef.current.y = mouseY;
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
      // 预先计算，便于本地与持久化共用
      let nx = initRect.x, ny = initRect.y, nw = initRect.width, nh = initRect.height;
      if (handle === 'nw') {
        nx = initRect.x + dx;
        ny = initRect.y + dy;
        nw = initRect.width - dx;
        nh = initRect.height - dy;
      } else if (handle === 'ne') {
        ny = initRect.y + dy;
        nw = initRect.width + dx;
        nh = initRect.height - dy;
      } else if (handle === 'se') {
        nw = initRect.width + dx;
        nh = initRect.height + dy;
      } else if (handle === 'sw') {
        nx = initRect.x + dx;
        nw = initRect.width - dx;
        nh = initRect.height + dy;
      } else if (handle === 'n') {
        ny = initRect.y + dy;
        nh = initRect.height - dy;
      } else if (handle === 's') {
        nh = initRect.height + dy;
      } else if (handle === 'e') {
        nw = initRect.width + dx;
      } else if (handle === 'w') {
        nx = initRect.x + dx;
        nw = initRect.width - dx;
      }
      nw = Math.max(minW, nw);
      nh = Math.max(minH, nh);
      if (handle === 'nw' || handle === 'sw' || handle === 'w') {
        nx = Math.min(nx, initRect.x + initRect.width - minW);
      }
      if (handle === 'nw' || handle === 'ne' || handle === 'n') {
        ny = Math.min(ny, initRect.y + initRect.height - minH);
      }
      const updated = { ...cards.find(c => c.id === id), x: nx, y: ny, width: nw, height: nh };
      setCards(cards.map(card => (card.id === id ? updated : card)));
      if (userId && supabaseRef.current) scheduleSave(updated);
      return;
    }

    // 如果正在拖拽卡片
    if (draggedCard) {
      const updated = {
        ...draggedCard,
        x: canvasPos.x - dragOffset.x,
        y: canvasPos.y - dragOffset.y,
      };
      setCards(cards.map(card => (card.id === draggedCard.id ? updated : card)));
      if (userId && supabaseRef.current) scheduleSave(updated);
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

    // 更新最后指针位置
    pointerStateRef.current.x = mouseX;
    pointerStateRef.current.y = mouseY;
  };

  // 处理鼠标松开
  const handleMouseUp = (e) => {
    setDraggedCard(null);
    setIsPanning(false);
    setResizing(null);
  };

  // 处理滚轮缩放
  const handleWheel = useCallback((e) => {
    dlog('wheel event', { ctrl: e.ctrlKey || e.metaKey, deltaY: e.deltaY });
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    // 取最后一次指针位置作为缩放锚点，若无则退回到当前事件位置
    let anchorX = pointerStateRef.current.x;
    let anchorY = pointerStateRef.current.y;
    const inBounds = anchorX >= 0 && anchorX <= rect.width && anchorY >= 0 && anchorY <= rect.height;
    if (!inBounds || anchorX === undefined || anchorY === undefined) {
      anchorX = e.clientX - rect.left;
      anchorY = e.clientY - rect.top;
    }

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const canvasPosBefore = {
        x: (anchorX - offset.x) / scale,
        y: (anchorY - offset.y) / scale
      };
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.1, Math.min(5, scale * delta));
      const newOffset = {
        x: anchorX - canvasPosBefore.x * newScale,
        y: anchorY - canvasPosBefore.y * newScale
      };
      setScale(newScale);
      setOffset(newOffset);
      dlog('zoom apply', { newScale, newOffset });
      return;
    }

    // 未按 Ctrl/⌘：尝试滚动文本卡片内容
    const canvasPos = screenToCanvas(anchorX, anchorY);
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
          const updated = { ...card, scrollY: next };
          setCards(cards.map(c => c.id === card.id ? updated : c));
          if (userId && supabaseRef.current) scheduleSave(updated);
        }
        break;
      }
    }
  }, [scale, offset, cards, userId]);

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
            dlog('clipboard image found', { imageType });
            // 优先用本地解码获取尺寸，避免依赖网络图片加载
            let w = 0, h = 0;
            try {
              if (typeof createImageBitmap === 'function') {
                const bmp = await createImageBitmap(blob);
                w = bmp.width; h = bmp.height;
              } else {
                // 兼容：用 objectURL + Image 读取尺寸
                const tmpUrl = URL.createObjectURL(blob);
                await new Promise((resolve, reject) => {
                  const img = new Image();
                  img.onload = () => { w = img.width; h = img.height; URL.revokeObjectURL(tmpUrl); resolve(); };
                  img.onerror = (e) => { URL.revokeObjectURL(tmpUrl); reject(e); };
                  img.src = tmpUrl;
                });
              }
            } catch (e) {
              // 尺寸读取失败则给个默认
              w = 200; h = 150;
            }
            // 按较长边等比缩放到 400
            const maxDim = 400;
            if (w > h && w > maxDim) { const s = maxDim / w; w = Math.round(w * s); h = Math.round(h * s); }
            else if (h >= w && h > maxDim) { const s = maxDim / h; w = Math.round(w * s); h = Math.round(h * s); }

            // 若已登录则上传 Supabase Storage，否则走本地 objectURL
            if (userId && supabaseRef.current) {
              const ext = imageType.split('/')[1] || 'png';
              const filePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
              const { error: upErr } = await supabaseRef.current.storage.from('cards').upload(filePath, blob, { upsert: true, contentType: imageType });
              if (upErr) throw upErr;
              dlog('storage upload ok', { filePath });
              // 本地立即缓存以便绘制（避免依赖远程图片加载）
              try {
                const tmpUrl = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => {
                  imageCacheRef.current.set(filePath, img);
                  objectUrlsRef.current.add(tmpUrl);
                  if (drawRef.current) drawRef.current();
                };
                img.onerror = () => { URL.revokeObjectURL(tmpUrl); };
                img.src = tmpUrl;
              } catch {}
              const newCard = { id: Date.now(), type: 'image', src: filePath, x: canvasPos.x, y: canvasPos.y, width: w, height: h };
              setCards(prev => [...prev, newCard]);
              scheduleSave(newCard);
            } else {
              const url = URL.createObjectURL(blob);
              const img = new Image();
              try {
                await new Promise((resolve, reject) => {
                  img.onload = resolve;
                  img.onerror = reject;
                  img.src = url;
                });
                imageCacheRef.current.set(url, img);
                objectUrlsRef.current.add(url);
              } catch {}
              const newCard = { id: Date.now(), type: 'image', src: url, x: canvasPos.x, y: canvasPos.y, width: w, height: h };
              setCards(prev => [...prev, newCard]);
            }
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
        if (userId && supabaseRef.current) scheduleSave(newCard);
      }
    } catch (err) {
      console.error('读取剪贴板失败', err);
    }
  };

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const listener = (event) => handleWheel(event);
    canvas.addEventListener('wheel', listener, { passive: false });
    dlog('wheel listener attached');

    return () => {
      canvas.removeEventListener('wheel', listener);
      dlog('wheel listener removed');
    };
  }, [handleWheel]);

  // 处理键盘事件
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !isSpacePressed && !showInput) {
        e.preventDefault();
        setIsSpacePressed(true);
      }
      // 删除选中卡片：Delete 或 Backspace（输入中除外）
      if ((e.key === 'Delete' || e.key === 'Backspace') && !showInput) {
        // 若聚焦在可编辑元素，忽略
        const tgt = e.target;
        const isEditable = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
        if (isEditable) return;
        if (selectedCardId != null) {
          e.preventDefault();
          setCards(prev => prev.filter(c => c.id !== selectedCardId));
          // 删除远端
          if (userId && supabaseRef.current) {
            supabaseRef.current.from('cards').delete().match({ id: String(selectedCardId), user_id: userId }).then(() => {});
          }
          setSelectedCardId(null);
        }
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
  }, [isSpacePressed, showInput, selectedCardId, userId]);

  // 输入框获得焦点
  useEffect(() => {
    if (showInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showInput]);

  // 初始化 canvas 尺寸（HiDPI 适配）
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
      const cssW = window.innerWidth;
      const cssH = window.innerHeight;
      // CSS 尺寸
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      // 设备像素尺寸
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      dlog('resize', { cssW, cssH, dpr, width: canvas.width, height: canvas.height });
      drawCards();
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [cards, scale, offset]);

  // 重绘画布
  useLayoutEffect(() => {
    dlog('layout redraw', { cards: cards.length, scale, offset });
    drawCards();
  }, [cards, scale, offset]);

  // 观察 cards 变化
  useEffect(() => {
    dlog('cards changed', cards.map(c => ({ id: c.id, type: c.type })));
  }, [cards]);

  // 页面可见性变化时强制重绘，避免偶发的首帧被清空
  useEffect(() => {
    const onVis = () => { if (drawRef.current) drawRef.current(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // 卸载时释放创建的 objectURL
  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
      imageCacheRef.current.clear();
    };
  }, []);

  // 建立 Supabase 连接与实时同步
  useEffect(() => {
    let channel;
    const setup = async () => {
      if (!userId || !session?.supabaseAccessToken || !session?.supabaseRefreshToken) return;
      const supabase = createBrowserSupabase();
      const { data, error } = await supabase.auth.setSession({
        access_token: session.supabaseAccessToken,
        refresh_token: session.supabaseRefreshToken,
      });
      if (error) {
        console.error('Supabase setSession error', error);
        return;
      }
      dlog('supabase setSession ok');
      supabaseRef.current = supabase;
      // 拉取初始数据
      const { data: rows, error: qerr } = await supabase
        .from('cards')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: true });
      dlog('initial query finished', { error: qerr ? qerr.message : null });
      if (!qerr && Array.isArray(rows)) {
        const list = rows.map(r => fromRow(r));
        dlog('initial fetch ok', { count: list.length });
        setCards(list);
        // 预加载图片（私有桶：使用签名 URL）
        for (const c of list) {
          if (c.type === 'image' && c.src && !imageCacheRef.current.get(c.src)) {
            try {
              imageLoadingRef.current.add(c.src);
              const { data, error } = await supabase.storage.from('cards').createSignedUrl(c.src, 86400);
              if (!error && data?.signedUrl) {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                  imageCacheRef.current.set(c.src, img);
                  imageLoadingRef.current.delete(c.src);
                  if (drawRef.current) drawRef.current();
                };
                img.onerror = () => { imageLoadingRef.current.delete(c.src); };
                img.src = data.signedUrl;
              } else {
                imageLoadingRef.current.delete(c.src);
              }
            } catch {
              imageLoadingRef.current.delete(c.src);
            }
          }
        }
      } else if (qerr) {
        console.error('Load cards error', qerr);
      }

      // 订阅实时变更
      channel = supabase
        .channel('cards:user:' + userId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cards', filter: `user_id=eq.${userId}` }, (payload) => {
          const row = payload.new || payload.old;
          const id = row?.id;
          if (!id) return;
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const card = fromRow(payload.new);
            dlog('realtime upsert', { id: card.id, type: card.type });
            setCards(prev => {
              const exists = prev.some(c => String(c.id) === String(card.id));
              if (exists) return prev.map(c => (String(c.id) === String(card.id) ? card : c));
              return [...prev, card];
            });
            // 由依赖 cards 的布局效果触发重绘
            if (card.type === 'image' && card.src && !imageCacheRef.current.get(card.src)) {
              (async () => {
                try {
                  imageLoadingRef.current.add(card.src);
                  const { data, error } = await supabase.storage.from('cards').createSignedUrl(card.src, 86400);
                  if (!error && data?.signedUrl) {
                    const img = new Image();
                    img.crossOrigin = 'anonymous';
                    img.onload = () => { imageCacheRef.current.set(card.src, img); imageLoadingRef.current.delete(card.src); if (drawRef.current) drawRef.current(); };
                    img.onerror = () => { imageLoadingRef.current.delete(card.src); };
                    img.src = data.signedUrl;
                  } else {
                    imageLoadingRef.current.delete(card.src);
                  }
                } catch {
                  imageLoadingRef.current.delete(card.src);
                }
              })();
            }
          } else if (payload.eventType === 'DELETE') {
            dlog('realtime delete', { id });
            setCards(prev => prev.filter(c => String(c.id) !== String(id)));
          }
        })
        .subscribe();
    };
    setup();
    return () => {
      if (channel && supabaseRef.current) {
        supabaseRef.current.removeChannel(channel);
      }
    };
  }, [userId, session?.supabaseAccessToken, session?.supabaseRefreshToken]);

  // 工具：保存卡片（去抖）与转换
  const toRow = (card) => ({
    id: String(card.id),
    user_id: userId,
    type: card.type,
    text: card.text || null,
    src: card.src || null,
    x: card.x,
    y: card.y,
    width: card.width,
    height: card.height,
    scroll_y: card.scrollY || 0,
  });
  const fromRow = (r) => ({
    id: /^(\d+)$/.test(r.id) ? Number(r.id) : r.id,
    type: r.type,
    text: r.text || '',
    src: r.src || null, // 存储路径，如 <uid>/file.ext
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    scrollY: r.scroll_y || 0,
  });

  const scheduleSave = (card) => {
    if (!userId || !supabaseRef.current) return;
    const id = String(card.id);
    const key = id;
    const timers = saveTimersRef.current;
    if (timers.has(key)) clearTimeout(timers.get(key));
    const t = setTimeout(async () => {
      try {
        dlog('upsert card', { id: card.id, type: card.type });
        await supabaseRef.current.from('cards').upsert([toRow(card)], { onConflict: 'id' });
      } catch (e) {
        console.error('save card error', e);
      }
    }, 300);
    timers.set(key, t);
  };

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

      {/* 使用说明 / 用户状态 */}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: '16px' }}>使用说明</h3>
          <div>
            {status === 'authenticated' ? (
              <>
                <span style={{ marginRight: 8, color: '#374151' }}>{session?.user?.email}</span>
                <button onClick={() => signOut()} style={{ padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>退出</button>
              </>
            ) : (
              <a href="/login" style={{ color: '#2563eb' }}>登录</a>
            )}
          </div>
        </div>
        <ul style={{ margin: 0, paddingLeft: '20px' }}>
          <li>点击空白处粘贴剪贴板（图/文）</li>
          <li>双击空白处手动添加文字卡片</li>
          <li>拖动卡片移动位置</li>
          <li>按住空格键拖拽白板</li>
          <li>Ctrl + 滚轮缩放画布</li>
          <li>登录后，卡片会实时保存在云端</li>
        </ul>
      </div>
    </div>
  );
}
