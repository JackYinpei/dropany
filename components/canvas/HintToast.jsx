'use client'
import React from 'react';

export function HintToast({ hint }) {
  if (!hint) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${hint.x}px`,
        top: `${hint.y}px`,
        transform: hint.fading ? 'translate(-50%, -18px) scale(0.98)' : 'translate(-50%, -8px) scale(1)',
        opacity: hint.fading ? 0 : 1,
        transition: 'opacity 600ms ease, transform 500ms ease',
        padding: '6px 10px',
        borderRadius: 8,
        pointerEvents: 'none',
        fontSize: 12,
        color: '#fff',
        background: hint.tone === 'success' ? '#10b981' : (hint.tone === 'error' ? '#ef4444' : '#6b7280'),
        boxShadow: '0 6px 18px rgba(0,0,0,0.15)',
        zIndex: 1100,
      }}
    >
      {hint.text}
    </div>
  );
}
