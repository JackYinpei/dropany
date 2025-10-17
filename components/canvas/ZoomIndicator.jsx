'use client'
import React from 'react';

export function ZoomIndicator({ scale }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: '20px',
        bottom: '20px',
        background: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        padding: '8px 16px',
        borderRadius: '8px',
        fontFamily: 'monospace',
        fontSize: '14px',
        userSelect: 'none',
        zIndex: 900,
      }}
    >
      缩放: {(scale * 100).toFixed(0)}%
    </div>
  );
}
