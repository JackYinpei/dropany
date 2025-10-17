'use client'
import React from 'react';

export function CardContextMenu({ contextMenu, onEdit, onDelete }) {
  if (!contextMenu) return null;

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        left: `${contextMenu.x}px`,
        top: `${contextMenu.y}px`,
        transform: 'translate(4px, 4px)',
        background: 'white',
        border: '1px solid #d1d5db',
        borderRadius: 6,
        boxShadow: '0 10px 24px rgba(15,23,42,0.18)',
        padding: '6px 0',
        minWidth: '140px',
        zIndex: 1100,
      }}
    >
      {contextMenu.cardType === 'text' && (
        <button
          onClick={onEdit}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: '8px 16px',
            background: 'transparent',
            border: 'none',
            fontSize: 13,
            cursor: 'pointer',
            color: '#111827',
          }}
        >
          编辑文字
        </button>
      )}
      <button
        onClick={onDelete}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '8px 16px',
          background: 'transparent',
          border: 'none',
          fontSize: 13,
          cursor: 'pointer',
          color: '#b91c1c',
        }}
      >
        删除卡片
      </button>
    </div>
  );
}
