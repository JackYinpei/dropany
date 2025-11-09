'use client'
import React from 'react';

export function TextInputOverlay({
  visible,
  position,
  inputRef,
  value,
  onChange,
  onConfirm,
  onCancel,
  isEditing,
}) {
  if (!visible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(-50%, -50%)',
        background: '#ffffff',
        borderRadius: '12px',
        boxShadow: '0 20px 40px rgba(15,23,42,0.20)',
        padding: '18px',
        minWidth: '320px',
        border: '1px solid rgba(148,163,184,0.25)',
        zIndex: 1200,
        color: '#0f172a',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="输入文字内容，Ctrl + Enter 保存"
        style={{
          width: '100%',
          minHeight: '120px',
          border: '1px solid rgba(148,163,184,0.40)',
          borderRadius: '8px',
          padding: '12px',
          fontSize: '14px',
          lineHeight: 1.6,
          resize: 'vertical',
          outline: 'none',
          boxShadow: 'inset 0 1px 2px rgba(15,23,42,0.08)',
          color: '#0f172a',
          backgroundColor: '#ffffff',
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            onConfirm();
          } else if (e.key === 'Escape') {
            onCancel();
          }
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, gap: 8 }}>
        <button
          onClick={onCancel}
          style={{
            padding: '6px 16px',
            border: '1px solid rgba(148,163,184,0.40)',
            borderRadius: '6px',
            background: '#fff',
            color: '#475569',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          取消 (Esc)
        </button>
        <button
          onClick={onConfirm}
          style={{
            padding: '6px 16px',
            border: 'none',
            borderRadius: '4px',
            background: '#3b82f6',
            color: 'white',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500',
          }}
        >
          {isEditing ? '保存 (Ctrl+Enter)' : '添加 (Ctrl+Enter)'}
        </button>
      </div>
    </div>
  );
}
