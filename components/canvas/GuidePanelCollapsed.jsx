'use client'
import React from 'react';

export function GuidePanelCollapsed({
  status,
  session,
  quickTips,
  onExpand,
  shareSelected,
  deleteSelected,
  selectedImageCount,
  selectedTotalCount,
  collapsedTitle,
}) {
  return (
    <div style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 1000 }}>
      <div
        onClick={onExpand}
        title={collapsedTitle}
        style={{
          background: '#111827',
          color: '#fff',
          padding: '10px 14px',
          borderRadius: 999,
          border: '1px solid #111827',
          boxShadow: '0 6px 18px rgba(0,0,0,0.15)',
          fontSize: 13,
          cursor: 'pointer',
          maxWidth: '220px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {status === 'authenticated' ? (session?.user?.email || '') : '登录'}
      </div>
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={shareSelected}
          disabled={selectedImageCount === 0}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: 'none',
            background: selectedImageCount ? '#3b82f6' : '#cbd5e1',
            color: '#fff',
            cursor: selectedImageCount ? 'pointer' : 'not-allowed',
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          分享已选 {selectedImageCount ? `(${selectedImageCount})` : ''}
        </button>
      </div>
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={deleteSelected}
          disabled={selectedTotalCount === 0}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: 'none',
            background: selectedTotalCount ? '#ef4444' : '#f3f4f6',
            color: selectedTotalCount ? '#fff' : '#9ca3af',
            cursor: selectedTotalCount ? 'pointer' : 'not-allowed',
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          删除已选 {selectedTotalCount ? `(${selectedTotalCount})` : ''}
        </button>
      </div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
        {quickTips.map((tip) => (
          <span
            key={tip}
            style={{
              background: '#f1f5f9',
              color: '#1f2937',
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: '12px',
              lineHeight: 1.4,
              display: 'inline-flex',
            }}
          >
            {tip}
          </span>
        ))}
      </div>
    </div>
  );
}
