import type React from 'react';

export interface ZoomControlsProps {
    zoomLabel: string;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onReset: () => void;
    onFitToView: () => void;
}

export function ZoomControls({ zoomLabel, onZoomIn, onZoomOut, onReset, onFitToView }: ZoomControlsProps) {
    return (
        <div
            data-no-drag
            data-testid="zoom-controls"
            style={{
                position: 'absolute',
                bottom: 8,
                right: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                background: 'var(--bg-secondary, rgba(0,0,0,0.6))',
                borderRadius: 4,
                padding: '2px 4px',
                fontSize: 11,
                userSelect: 'none',
                zIndex: 10,
            }}
        >
            <button onClick={onZoomOut} title="Zoom out" style={btnStyle}>−</button>
            <span data-testid="zoom-label" style={{ minWidth: 36, textAlign: 'center', color: 'var(--text-secondary, #aaa)' }}>
                {zoomLabel}
            </span>
            <button onClick={onZoomIn} title="Zoom in" style={btnStyle}>+</button>
            <button onClick={onReset} title="Reset zoom" style={btnStyle}>⟲</button>
            <button onClick={onFitToView} title="Fit to view" style={btnStyle}>⊞</button>
        </div>
    );
}

const btnStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-primary, #ccc)',
    cursor: 'pointer',
    padding: '2px 6px',
    fontSize: 14,
    lineHeight: 1,
};
