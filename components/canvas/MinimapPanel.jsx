'use client'
import React from 'react';

export function MinimapPanel({
  width,
  height,
  minimapRef,
  viewportRect,
  markers,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPrevent,
}) {
  return (
    <div
      style={{
        position: 'absolute',
        right: '20px',
        bottom: '20px',
        width: width + 24,
        height: height + 48,
        background: 'rgba(17, 24, 39, 0.82)',
        borderRadius: 14,
        padding: '12px 14px',
        boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
        color: '#e5e7eb',
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'auto',
        zIndex: 1200,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
      onClick={onPrevent}
      onDoubleClick={onPrevent}
      onWheel={onPrevent}
      onContextMenu={onPrevent}
    >
      <div style={{ fontWeight: 500, letterSpacing: '0.02em' }}>小地图</div>
      <div style={{ position: 'relative', flex: 1 }}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', height: '100%', display: 'block' }}
          ref={minimapRef}
        >
          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            rx={12}
            ry={12}
            fill="rgba(255,255,255,0.08)"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={1}
          />
          {viewportRect && (
            <rect
              x={viewportRect.x}
              y={viewportRect.y}
              width={viewportRect.width}
              height={viewportRect.height}
              fill="rgba(59,130,246,0.18)"
              stroke="#3b82f6"
              strokeWidth={1.5}
              rx={4}
              ry={4}
            />
          )}
          {markers.map((marker) => (
            <circle
              key={marker.id}
              cx={marker.x}
              cy={marker.y}
              r={4}
              fill="#ef4444"
              stroke="#ffffff"
              strokeWidth={1}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
