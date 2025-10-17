'use client'
import React from 'react';

export function GuidePanelExpanded({
  status,
  session,
  onSignOut,
  onCollapse,
  quickTips,
  shareSelected,
  deleteSelected,
  selectedImageCount,
  selectedTotalCount,
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        background: '#f8fafc',
        padding: '16px',
        borderRadius: '10px',
        border: '1px solid #e5e7eb',
        boxShadow: '0 6px 18px rgba(0,0,0,0.10)',
        fontSize: '14px',
        maxWidth: '340px',
        color: '#111827',
        zIndex: 1000,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: '16px', color: '#111827' }}>使用说明</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {status === 'authenticated' ? (
            <>
              <span style={{ marginRight: 8, color: '#374151' }}>{session?.user?.email}</span>
              <button
                onClick={onSignOut}
                style={{ padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', cursor: 'pointer' }}
              >
                退出
              </button>
            </>
          ) : (
            <a href="/login" style={{ color: '#2563eb' }}>
              登录
            </a>
          )}
          <button
            onClick={onCollapse}
            title="折叠"
            style={{ padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', cursor: 'pointer' }}
          >
            收起
          </button>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a', marginBottom: 6 }}>快捷操作</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {quickTips.map((tip) => (
            <span
              key={tip}
              style={{
                background: '#dbeafe',
                color: '#1e3a8a',
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
      <ul style={{ margin: 0, paddingLeft: '20px' }}>
        <li>单击白板空白区域自动粘贴当前剪贴板的图文内容</li>
        <li>双击空白打开输入框，Ctrl + Enter 提交文字卡片，Esc 取消</li>
        <li>单击卡片切换选中，拖动主体或句柄移动/缩放，单击空白清空选择</li>
        <li>双击文字卡片即可复制内容到剪贴板</li>
        <li>右上角按钮：分享仅发送选中的图片卡片，删除会移除所有已选卡片</li>
        <li>右下角小地图可快速定位；登录后卡片会在云端实时同步</li>
      </ul>
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
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
    </div>
  );
}
