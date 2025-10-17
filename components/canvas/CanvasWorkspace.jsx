'use client'
import React, { useRef, useEffect, useState, useCallback, useLayoutEffect, useMemo } from 'react';
import { HintToast } from './HintToast';
import { CardContextMenu } from './CardContextMenu';
import { TextInputOverlay } from './TextInputOverlay';
import { ZoomIndicator } from './ZoomIndicator';
import { MinimapPanel } from './MinimapPanel';
import { GuidePanelExpanded } from './GuidePanelExpanded';
import { GuidePanelCollapsed } from './GuidePanelCollapsed';

export default function CanvasWorkspace({
  cards,
  setCards,
  userId,
  session,
  status,
  supabaseReady,
  scheduleSave,
  deleteCards,
  deleteCard,
  uploadImage,
  createSignedUrl,
  onSignOut = () => {},
}) {
  const canvasRef = useRef(null);
  const pointerStateRef = useRef({ x: 0, y: 0, moved: false, pointerId: null });
  const activePointersRef = useRef(new Map()); // pointerId -> { x, y, pointerType }
  const pinchStateRef = useRef(null); // 当前缩放手势状态
  const panPointerRef = useRef(null); // 当前驱动平移的指针 ID
  const [hint, setHint] = useState(null); // { x, y, text, tone: 'success'|'info'|'error', fading: bool }
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
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const inputRef = useRef(null);
  const minimapSvgRef = useRef(null);
  const minimapPointerActiveRef = useRef(false);
  // 始终指向最新的绘制函数，用于异步回调中调用
  const drawRef = useRef(() => {});
  // 缓存已加载图片，避免重复加载
  const imageCacheRef = useRef(new Map()); // src => HTMLImageElement
  const objectUrlsRef = useRef(new Set()); // 用于卸载时统一 revoke
  const imageLoadingRef = useRef(new Set()); // 正在加载的 storage 路径，避免重复请求
  const [hoveredCardId, setHoveredCardId] = useState(null);
  const [hoveredHandle, setHoveredHandle] = useState(null); // 'nw'|'ne'|'se'|'sw'|null
  const [resizing, setResizing] = useState(null); // { id, handle, startCanvas, initRect }
  // 单一主选已移除，统一使用多选集合
  const [selectedIds, setSelectedIds] = useState(new Set()); // 多选集合（文本与图片均可）
  const [isGuideCollapsed, setIsGuideCollapsed] = useState(false); // 使用说明是否折叠
  const pendingPasteTimeoutRef = useRef(null);
  const [editingCardId, setEditingCardId] = useState(null);
  const longPressTimerRef = useRef(null);
  const longPressTargetRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null);
  const cardsRef = useRef(cards);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  // 轻提示动画
  const showHint = useCallback((text, x, y, tone = 'success') => {
    const pos = { x: Math.max(12, Math.min(x, (typeof window !== 'undefined' ? window.innerWidth - 12 : x))), y: Math.max(12, y - 20) };
    setHint({ text, x: pos.x, y: pos.y, tone, fading: false });
    // 触发过渡（稍作停留再淡出）
    setTimeout(() => {
      setHint(prev => prev ? { ...prev, fading: true } : prev);
    }, 120);
    // 自动消失
    setTimeout(() => setHint(null), 900);
  }, []);

  

  // 批量分享已选图片
  const shareSelected = useCallback(async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.share) {
        showHint('该设备不支持分享', 24, 24, 'info');
        return;
      }
      const ids = Array.from(selectedIds);
      if (!ids.length) {
        showHint('请先选择图片', 24, 24, 'info');
        return;
      }
      const imgs = cards.filter(c => ids.includes(c.id) && c.type === 'image');
      if (!imgs.length) {
        showHint('仅支持分享图片', 24, 24, 'info');
        return;
      }
      const blobs = await Promise.all(imgs.map(async (card) => {
        let blob = null;
        try {
          if (userId && supabaseReady && card.src && !/^https?:|^blob:|^data:/.test(card.src)) {
            const { data, error } = await createSignedUrl(card.src, 3600);
            if (!error && data?.signedUrl) {
              const res = await fetch(data.signedUrl);
              blob = await res.blob();
            }
          }
          if (!blob && card.src) {
            try {
              const res = await fetch(card.src);
              blob = await res.blob();
            } catch {}
          }
          if (!blob) {
            const img = imageCacheRef.current.get(card.src);
            if (img && img.naturalWidth && img.naturalHeight) {
              const c = document.createElement('canvas');
              c.width = img.naturalWidth; c.height = img.naturalHeight;
              const ctx2 = c.getContext('2d');
              ctx2.drawImage(img, 0, 0);
              blob = await new Promise(resolve => c.toBlob(b => resolve(b), 'image/png', 0.92));
            }
          }
        } catch {}
        return blob;
      }));
      const files = blobs.filter(Boolean).map((blob, idx) => new File([blob], `image-${idx + 1}.png`, { type: blob.type || 'image/png' }));
      if (!files.length) {
        showHint('未能获取到图片数据', 24, 24, 'error');
        return;
      }
      if (navigator.canShare && !navigator.canShare({ files })) {
        showHint('该设备不支持多图分享', 24, 24, 'info');
        return;
      }
      await navigator.share({ files, title: '分享图片', text: '' });
    } catch {
      showHint('分享失败', 24, 24, 'error');
    }
  }, [cards, selectedIds, userId, showHint, supabaseReady, createSignedUrl]);

  // 批量删除已选（文本与图片）
  const deleteSelected = useCallback(async () => {
    const idsArr = Array.from(selectedIds);
    if (idsArr.length === 0) {
      showHint('请先选择要删除的卡片', 24, 24, 'info');
      return;
    }
    const idsSet = new Set(idsArr);
    setCards(prev => prev.filter(c => !idsSet.has(c.id)));
    if (userId) {
      await deleteCards(idsArr);
    }
    setSelectedIds(new Set());
  }, [selectedIds, userId, showHint, deleteCards]);

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

  const clearPendingPasteTimeout = () => {
    if (pendingPasteTimeoutRef.current) {
      clearTimeout(pendingPasteTimeoutRef.current);
      pendingPasteTimeoutRef.current = null;
    }
  };

  const cancelLongPress = (pointerId = null) => {
    if (longPressTimerRef.current) {
      if (pointerId === null || longPressTargetRef.current?.pointerId === pointerId) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
        longPressTargetRef.current = null;
      }
    }
  };

  const beginEditCard = (card, positionOverride = null) => {
    if (!card || card.type !== 'text') return;
    const pos = positionOverride || { x: card.x, y: card.y };
    setInputPosition(pos);
    setInputText(card.text || '');
    setEditingCardId(card.id);
    setShowInput(true);
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.add(card.id);
      return next;
    });
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
          // 如果是登录态（存的是 storage 路径），尝试触发签名 URL 加载
          if (userId && supabaseReady && !imageLoadingRef.current.has(card.src)) {
            // 异步加载，不阻塞绘制
            (async () => {
              try {
                imageLoadingRef.current.add(card.src);
                const { data, error } = await createSignedUrl(card.src, 86400);
                if (!error && data?.signedUrl) {
                  const url = data.signedUrl;
                  const imgEl = new Image();
                  imgEl.crossOrigin = 'anonymous';
                  imgEl.onload = () => {
                    imageCacheRef.current.set(card.src, imgEl);
                    imageLoadingRef.current.delete(card.src);
                    // 使用最新的绘制函数，避免陈旧闭包清空画布
                    if (drawRef.current) drawRef.current();
                  };
                  imgEl.onerror = () => {
                    imageLoadingRef.current.delete(card.src);
                  };
                  imgEl.src = url;
                } else {
                  imageLoadingRef.current.delete(card.src);
                }
              } catch {
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

      // 卡片边框（多选或单选高亮）
      const isSelected = selectedIds.has(card.id);
      ctx.strokeStyle = isSelected ? '#2563eb' : '#3b82f6';
      ctx.lineWidth = 2;
      ctx.strokeRect(screenPos.x, screenPos.y, cardW, cardH);

      // 交互手柄（悬停或拖动/缩放时显示）
      const showHandles = selectedIds.has(card.id) || hoveredCardId === card.id || (draggedCard && draggedCard.id === card.id) || (resizing && resizing.id === card.id);
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

  // 保持 drawRef 指向最新的 drawCards，供异步回调安全调用
  useLayoutEffect(() => {
    drawRef.current = drawCards;
  });

  // 处理画布双击
  const handleCanvasDoubleClick = async (e) => {
    if (isPanning) return;

    clearPendingPasteTimeout();
    setContextMenu(null);

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

    if (clickedCard) {
      if (clickedCard.type === 'text') {
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(clickedCard.text || '');
            showHint('已复制', clickX, clickY, 'success');
          }
        } catch {}
      }
      return;
    }

    // 双击空白：显示输入框
    setInputPosition(canvasPos);
    setInputText('');
    setEditingCardId(null);
    setShowInput(true);
  };

  // 添加卡片
  const handleAddCard = () => {
    const nextText = editingCardId ? inputText : inputText.trim();

    if (editingCardId) {
      let updatedCard = null;
      setCards(prev => prev.map(card => {
        if (card.id !== editingCardId) return card;
        updatedCard = { ...card, text: nextText };
        return updatedCard;
      }));
      if (updatedCard && userId) {
        scheduleSave(updatedCard);
      }
    } else if (nextText) {
      const newCard = {
        id: Date.now(),
        type: 'text',
        text: nextText,
        x: inputPosition.x,
        y: inputPosition.y,
        width: 200,
        height: 100
      };
      setCards(prev => [...prev, newCard]);
      // 持久化
      if (userId) {
        scheduleSave(newCard);
      }
    }

    setShowInput(false);
    setInputText('');
    setEditingCardId(null);
  };

  // 取消输入
  const handleCancelInput = () => {
    setShowInput(false);
    setInputText('');
    setEditingCardId(null);
  };

  // 处理指针按下（兼容鼠标与触摸）
  const handlePointerDown = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    clearPendingPasteTimeout();
    setContextMenu(null);
    cancelLongPress();

    const rect = canvas.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;
    const isTouch = e.pointerType === 'touch';

    pointerStateRef.current = { x: pointerX, y: pointerY, moved: false, pointerId: e.pointerId };

    try {
      canvas.setPointerCapture?.(e.pointerId);
    } catch {}

    activePointersRef.current.set(e.pointerId, { x: pointerX, y: pointerY, pointerType: e.pointerType });

    const touchPoints = Array.from(activePointersRef.current.values()).filter(p => p.pointerType === 'touch');
    if (touchPoints.length >= 2) {
      const [p1, p2] = touchPoints.slice(0, 2);
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const centerX = (p1.x + p2.x) / 2;
      const centerY = (p1.y + p2.y) / 2;
      pinchStateRef.current = {
        initialDistance: distance,
        initialScale: scale,
        centerCanvas: screenToCanvas(centerX, centerY),
      };
      setDraggedCard(null);
      setResizing(null);
      setIsPanning(false);
      panPointerRef.current = null;
      return;
    } else {
      pinchStateRef.current = null;
    }

    if (isSpacePressed) {
      setIsPanning(true);
      panPointerRef.current = e.pointerId;
      const anchorCanvas = screenToCanvas(pointerX, pointerY);
      setPanStart({ x: anchorCanvas.x, y: anchorCanvas.y });
      pointerStateRef.current.x = pointerX;
      pointerStateRef.current.y = pointerY;
      return;
    }

    const canvasPos = screenToCanvas(pointerX, pointerY);

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
        if (pointerX >= h.x - hs && pointerX <= h.x + hs && pointerY >= h.y - hs && pointerY <= h.y + hs) {
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
        // 触摸拖拽卡片时不立即开启平移
        if (isTouch) {
          panPointerRef.current = null;
          if (card.type === 'text') {
            const cardId = card.id;
            longPressTargetRef.current = { pointerId: e.pointerId, cardId };
            longPressTimerRef.current = setTimeout(() => {
              if (!longPressTargetRef.current || longPressTargetRef.current.pointerId !== e.pointerId || longPressTargetRef.current.cardId !== cardId) {
                return;
              }
              if (pointerStateRef.current.moved) {
                return;
              }
              const latest = cardsRef.current?.find(c => c.id === cardId);
              if (latest) {
                beginEditCard(latest);
              }
              setDraggedCard(null);
              setResizing(null);
              setIsPanning(false);
              longPressTargetRef.current = null;
              longPressTimerRef.current = null;
            }, 500);
          }
        }
        break;
      }
    }

    // 点击在空白区域则清除选中，并支持触摸平移
    if (!draggedCard && !resizing) {
      let clickedAny = false;
      for (let i = cards.length - 1; i >= 0; i--) {
        const c = cards[i];
        if (canvasPos.x >= c.x && canvasPos.x <= c.x + c.width && canvasPos.y >= c.y && canvasPos.y <= c.y + c.height) {
          clickedAny = true;
          break;
        }
      }
      if (!clickedAny) {
        setSelectedIds(new Set());
        if (isTouch) {
          setIsPanning(true);
          panPointerRef.current = e.pointerId;
          const anchorCanvas = screenToCanvas(pointerX, pointerY);
          setPanStart({ x: anchorCanvas.x, y: anchorCanvas.y });
        }
      }
    }
  };

  // 处理指针移动
  const handlePointerMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;

    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: pointerX, y: pointerY, pointerType: e.pointerType });
    }

    if (!pointerStateRef.current.moved) {
      const dx0 = Math.abs(pointerX - pointerStateRef.current.x);
      const dy0 = Math.abs(pointerY - pointerStateRef.current.y);
      if (dx0 > 2 || dy0 > 2) {
        pointerStateRef.current.moved = true;
        cancelLongPress(e.pointerId);
      }
    }

    const touchPoints = Array.from(activePointersRef.current.values()).filter(p => p.pointerType === 'touch');
    if (pinchStateRef.current && touchPoints.length >= 2) {
      const [p1, p2] = touchPoints.slice(0, 2);
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const base = pinchStateRef.current.initialDistance || 1;
      const ratio = distance / base;
      const newScale = Math.max(0.1, Math.min(5, pinchStateRef.current.initialScale * ratio));
      const centerX = (p1.x + p2.x) / 2;
      const centerY = (p1.y + p2.y) / 2;
      const centerCanvas = pinchStateRef.current.centerCanvas;
      setScale(newScale);
      setOffset({
        x: centerX - centerCanvas.x * newScale,
        y: centerY - centerCanvas.y * newScale,
      });
      pointerStateRef.current.x = pointerX;
      pointerStateRef.current.y = pointerY;
      return;
    }

    // 如果正在拖拽白板（锚点式平移：保持按下时的世界点在指针下）
    if (isPanning) {
      if (panPointerRef.current === null || panPointerRef.current === e.pointerId || e.pointerType !== 'touch') {
        setOffset({
          x: pointerX - panStart.x * scale,
          y: pointerY - panStart.y * scale
        });
        pointerStateRef.current.x = pointerX;
        pointerStateRef.current.y = pointerY;
      }
      return;
    }

    const canvasPos = screenToCanvas(pointerX, pointerY);

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
      if (userId) scheduleSave(updated);
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
      if (userId) scheduleSave(updated);
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
          if (pointerX >= h.x - hs && pointerX <= h.x + hs && pointerY >= h.y - hs && pointerY <= h.y + hs) {
            handleName = h.name;
            break;
          }
        }
        break;
      }
    }
    setHoveredCardId(hoverId);
    setHoveredHandle(handleName);

    pointerStateRef.current.x = pointerX;
    pointerStateRef.current.y = pointerY;
  };

  // 结束指针交互
  const stopPointerTracking = (pointerId) => {
    activePointersRef.current.delete(pointerId);
    if (panPointerRef.current === pointerId) {
      panPointerRef.current = null;
    }
    const remainingTouches = Array.from(activePointersRef.current.values()).filter(p => p.pointerType === 'touch');
    if (remainingTouches.length < 2) {
      pinchStateRef.current = null;
    }
    if (pointerStateRef.current.pointerId === pointerId) {
      pointerStateRef.current.pointerId = null;
    }
  };

  const handlePointerUp = (e) => {
    const canvas = canvasRef.current;
    try {
      canvas?.releasePointerCapture?.(e.pointerId);
    } catch {}
    cancelLongPress(e.pointerId);
    stopPointerTracking(e.pointerId);
    setDraggedCard(null);
    setResizing(null);
    setIsPanning(false);
  };

  // 处理滚轮缩放
  const handleWheel = useCallback((e) => {
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
          if (userId) scheduleSave(updated);
        }
        break;
      }
    }
  }, [scale, offset, cards, userId, scheduleSave]);

  const handleCanvasClick = (e) => {
    clearPendingPasteTimeout();
    setContextMenu(null);

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

    // 点击到卡片：所有类型均切换选中（高亮由选中驱动）
    if (clickedCard) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(clickedCard.id)) next.delete(clickedCard.id);
        else next.add(clickedCard.id);
        return next;
      });
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.clipboard) return;

    const pasteFromClipboard = async () => {
      try {
        if (navigator.clipboard.read) {
          const items = await navigator.clipboard.read();
          let added = false;
          for (const item of items) {
            const imageType = item.types.find(t => t.startsWith('image/'));
            if (imageType) {
              const blob = await item.getType(imageType);
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
              } catch (err) {
                // 尺寸读取失败则给个默认
                w = 200; h = 150;
              }
              // 按较长边等比缩放到 400
              const maxDim = 400;
              if (w > h && w > maxDim) { const s = maxDim / w; w = Math.round(w * s); h = Math.round(h * s); }
              else if (h >= w && h > maxDim) { const s = maxDim / h; w = Math.round(w * s); h = Math.round(h * s); }

              // 若已登录则上传 Supabase Storage，否则走本地 objectURL
              if (userId && supabaseReady) {
                const ext = imageType.split('/')[1] || 'png';
                const filePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
                const { error: upErr } = await uploadImage(filePath, blob, { upsert: true, contentType: imageType });
                if (upErr) throw upErr;
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
          if (userId) scheduleSave(newCard);
        }
      } catch (err) {}
    };

    pendingPasteTimeoutRef.current = setTimeout(() => {
      pasteFromClipboard().finally(() => {
        pendingPasteTimeoutRef.current = null;
      });
    }, 220);
  };

  const handleCanvasContextMenu = (e) => {
    e.preventDefault();
    clearPendingPasteTimeout();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;
    const canvasPos = screenToCanvas(pointerX, pointerY);

    for (let i = cards.length - 1; i >= 0; i--) {
      const card = cards[i];
      if (canvasPos.x >= card.x && canvasPos.x <= card.x + card.width && canvasPos.y >= card.y && canvasPos.y <= card.y + card.height) {
        setSelectedIds(new Set([card.id]));
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          cardId: card.id,
          cardType: card.type
        });
        return;
      }
    }

    setContextMenu(null);
    setSelectedIds(new Set());
  };

  const handleContextMenuAction = async (action) => {
    if (!contextMenu) return;
    clearPendingPasteTimeout();

    const target = cards.find(card => card.id === contextMenu.cardId);
    setContextMenu(null);
    if (!target) return;

    if (action === 'edit') {
      beginEditCard(target);
      return;
    }

    if (action === 'delete') {
      setCards(prev => prev.filter(card => card.id !== target.id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
      if (userId) {
        await deleteCard(target.id);
      }
      showHint('已删除', contextMenu.x, contextMenu.y, 'success');
    }
  };

  useLayoutEffect(() => {
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
      // 删除选中卡片：Delete 或 Backspace（输入中除外）
      if ((e.key === 'Delete' || e.key === 'Backspace') && !showInput) {
        // 若聚焦在可编辑元素，忽略
        const tgt = e.target;
        const isEditable = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
        if (isEditable) return;
        if (selectedIds.size > 0) {
          e.preventDefault();
          deleteSelected();
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
  }, [isSpacePressed, showInput, selectedIds, userId, deleteSelected]);

  // 使用说明 5 秒后自动折叠
  useEffect(() => {
    const t = setTimeout(() => setIsGuideCollapsed(true), 5000);
    return () => clearTimeout(t);
  }, []);

  // 输入框获得焦点
  useEffect(() => {
    if (showInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showInput]);

  useEffect(() => {
    return () => {
      clearPendingPasteTimeout();
      cancelLongPress();
    };
  }, []);

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
      setViewportSize(prev => (prev.width === cssW && prev.height === cssH ? prev : { width: cssW, height: cssH }));
      drawCards();
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [cards, scale, offset]);

  // 重绘画布（依赖更多交互态，确保高亮/悬停/选择及时更新）
  useLayoutEffect(() => {
    drawCards();
  }, [cards, scale, offset, selectedIds, hoveredCardId, hoveredHandle, draggedCard, resizing]);

  // 观察 cards 变化
  useEffect(() => {}, [cards]);

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

  // 预加载存储中的图片，避免在绘制时阻塞
  useEffect(() => {
    if (!userId || !supabaseReady) return;
    let cancelled = false;

    const fetchImages = async () => {
      for (const card of cards) {
        if (card.type !== 'image' || !card.src) continue;
        if (/^https?:|^blob:|^data:/.test(card.src)) continue;
        if (imageCacheRef.current.has(card.src) || imageLoadingRef.current.has(card.src)) continue;
        try {
          imageLoadingRef.current.add(card.src);
          const { data, error } = await createSignedUrl(card.src, 86400);
          if (cancelled) return;
          if (!error && data?.signedUrl) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              if (cancelled) return;
              imageCacheRef.current.set(card.src, img);
              imageLoadingRef.current.delete(card.src);
              if (drawRef.current) drawRef.current();
            };
            img.onerror = () => {
              imageLoadingRef.current.delete(card.src);
            };
            img.src = data.signedUrl;
          } else {
            imageLoadingRef.current.delete(card.src);
          }
        } catch {
          imageLoadingRef.current.delete(card.src);
        }
      }
    };

    fetchImages();

    return () => {
      cancelled = true;
    };
  }, [cards, userId, supabaseReady, createSignedUrl]);

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
      x: screenPos.x,
      y: screenPos.y
    };
  };

  // 已选计数：分享仅统计图片，删除统计全部
  const selectedImageCount = cards.reduce((acc, c) => acc + (selectedIds.has(c.id) && c.type === 'image' ? 1 : 0), 0);
  const selectedTotalCount = selectedIds.size;

  const quickTips = useMemo(() => [
    '单击空白粘贴剪贴板',
    '双击空白添加文字卡片',
    '空格 + 拖动拖动画布',
    'Ctrl + 滚轮调整缩放'
  ], []);

  const sessionEmail = session?.user?.email || '';

  const collapsedTitle = useMemo(() => {
    const items = [
      status === 'authenticated' ? sessionEmail : '登录',
      ...quickTips,
    ].filter(Boolean);
    return items.join('\n');
  }, [status, sessionEmail, quickTips]);

  const minimapWidth = 200;
  const minimapHeight = 140;
  const hasViewport = viewportSize.width > 0 && viewportSize.height > 0;
  const viewportTopLeft = hasViewport ? screenToCanvas(0, 0) : null;
  const viewportBottomRight = hasViewport ? screenToCanvas(viewportSize.width, viewportSize.height) : null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  if (viewportTopLeft && viewportBottomRight) {
    minX = Math.min(minX, viewportTopLeft.x, viewportBottomRight.x);
    minY = Math.min(minY, viewportTopLeft.y, viewportBottomRight.y);
    maxX = Math.max(maxX, viewportTopLeft.x, viewportBottomRight.x);
    maxY = Math.max(maxY, viewportTopLeft.y, viewportBottomRight.y);
  }

  cards.forEach(card => {
    minX = Math.min(minX, card.x, card.x + card.width);
    minY = Math.min(minY, card.y, card.y + card.height);
    maxX = Math.max(maxX, card.x, card.x + card.width);
    maxY = Math.max(maxY, card.y, card.y + card.height);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    minX = -100; minY = -100; maxX = 100; maxY = 100;
  }

  const baseWidth = Math.max(1, maxX - minX);
  const baseHeight = Math.max(1, maxY - minY);
  const padX = baseWidth * 0.05 + 40;
  const padY = baseHeight * 0.05 + 40;
  minX -= padX;
  minY -= padY;
  maxX += padX;
  maxY += padY;

  const worldWidth = Math.max(1, maxX - minX);
  const worldHeight = Math.max(1, maxY - minY);
  const minimapScale = Math.min(minimapWidth / worldWidth, minimapHeight / worldHeight);
  const minimapOffsetX = (minimapWidth - worldWidth * minimapScale) / 2;
  const minimapOffsetY = (minimapHeight - worldHeight * minimapScale) / 2;

  const viewportRect = (viewportTopLeft && viewportBottomRight) ? {
    x: minimapOffsetX + (Math.min(viewportTopLeft.x, viewportBottomRight.x) - minX) * minimapScale,
    y: minimapOffsetY + (Math.min(viewportTopLeft.y, viewportBottomRight.y) - minY) * minimapScale,
    width: Math.max(2, Math.abs(viewportBottomRight.x - viewportTopLeft.x) * minimapScale),
    height: Math.max(2, Math.abs(viewportBottomRight.y - viewportTopLeft.y) * minimapScale),
  } : null;

  const minimapMarkers = cards.map(card => {
    const centerX = card.x + card.width / 2;
    const centerY = card.y + card.height / 2;
    return {
      id: card.id,
      x: minimapOffsetX + (centerX - minX) * minimapScale,
      y: minimapOffsetY + (centerY - minY) * minimapScale,
    };
  });

  const handleMinimapNavigate = useCallback((clientX, clientY) => {
    if (!hasViewport || !viewportSize.width || !viewportSize.height) return;
    const svgEl = minimapSvgRef.current;
    if (!svgEl || !minimapScale) return;
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const localX = Math.max(0, Math.min(minimapWidth, ((clientX - rect.left) / rect.width) * minimapWidth));
    const localY = Math.max(0, Math.min(minimapHeight, ((clientY - rect.top) / rect.height) * minimapHeight));
    const worldX = minX + (localX - minimapOffsetX) / minimapScale;
    const worldY = minY + (localY - minimapOffsetY) / minimapScale;
    const newOffset = {
      x: viewportSize.width / 2 - worldX * scale,
      y: viewportSize.height / 2 - worldY * scale,
    };
    setOffset(newOffset);
  }, [hasViewport, viewportSize.width, viewportSize.height, minimapScale, minimapOffsetX, minimapOffsetY, minX, minY, scale, setOffset]);

  const handleMinimapPointerDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    minimapPointerActiveRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    handleMinimapNavigate(e.clientX, e.clientY);
  }, [handleMinimapNavigate]);

  const handleMinimapPointerMove = useCallback((e) => {
    if (!minimapPointerActiveRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    handleMinimapNavigate(e.clientX, e.clientY);
  }, [handleMinimapNavigate]);

  const handleMinimapPointerUp = useCallback((e) => {
    if (!minimapPointerActiveRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    minimapPointerActiveRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  const preventEvent = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDoubleClick}
        onContextMenu={handleCanvasContextMenu}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ cursor: getCursor(), display: 'block', touchAction: 'none' }}
      />

      <HintToast hint={hint} />

      <CardContextMenu
        contextMenu={contextMenu}
        onEdit={() => { void handleContextMenuAction('edit'); }}
        onDelete={() => { void handleContextMenuAction('delete'); }}
      />

      <TextInputOverlay
        visible={showInput}
        position={getInputScreenPosition()}
        inputRef={inputRef}
        value={inputText}
        onChange={setInputText}
        onConfirm={handleAddCard}
        onCancel={handleCancelInput}
        isEditing={Boolean(editingCardId)}
      />

      <ZoomIndicator scale={scale} />



      <MinimapPanel
        width={minimapWidth}
        height={minimapHeight}
        minimapRef={minimapSvgRef}
        viewportRect={viewportRect}
        markers={minimapMarkers}
        onPointerDown={handleMinimapPointerDown}
        onPointerMove={handleMinimapPointerMove}
        onPointerUp={handleMinimapPointerUp}
        onPrevent={preventEvent}
      />

      {!isGuideCollapsed ? (
        <GuidePanelExpanded
          status={status}
          session={session}
          onSignOut={onSignOut}
          onCollapse={() => setIsGuideCollapsed(true)}
          quickTips={quickTips}
          shareSelected={shareSelected}
          deleteSelected={deleteSelected}
          selectedImageCount={selectedImageCount}
          selectedTotalCount={selectedTotalCount}
        />
      ) : (
        <GuidePanelCollapsed
          status={status}
          session={session}
          quickTips={quickTips}
          onExpand={() => setIsGuideCollapsed(false)}
          shareSelected={shareSelected}
          deleteSelected={deleteSelected}
          selectedImageCount={selectedImageCount}
          selectedTotalCount={selectedTotalCount}
          collapsedTitle={collapsedTitle}
        />
      )}

    </div>
  );
}
