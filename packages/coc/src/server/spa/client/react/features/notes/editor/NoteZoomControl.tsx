import { useEffect, useRef, useState } from 'react';
import {
    NOTE_ZOOM_DEFAULT,
    NOTE_ZOOM_PRESETS,
    type UseNoteZoomResult,
} from './useNoteZoom';

export interface NoteZoomControlProps {
    /** Zoom state from `useNoteZoom`. */
    zoom: UseNoteZoomResult;
}

/**
 * Toolbar zoom control for the individual note page (AC-01).
 *
 * Renders a `−` button, a clickable current-percentage readout, and a `+`
 * button. `−`/`+` step by `NOTE_ZOOM_STEP` (10%) clamped to 50%–200%. Clicking
 * the readout opens a preset menu (50…200%) plus a "Reset to 100%" entry. The
 * percentage is always shown (even at 100%). The `−`/`+` buttons disable at the
 * min/max bound.
 */
export function NoteZoomControl({ zoom }: NoteZoomControlProps) {
    const { zoom: level, setZoom, zoomIn, zoomOut, reset, canZoomIn, canZoomOut } = zoom;
    const [menuOpen, setMenuOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close the preset menu on outside click or Escape.
    useEffect(() => {
        if (!menuOpen) return;
        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
        }
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape') setMenuOpen(false);
        }
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [menuOpen]);

    const btnCls =
        'h-7 w-6 rounded flex items-center justify-center text-sm hover:bg-[#e0e0e0] dark:hover:bg-[#505050] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent';

    return (
        <div className="relative flex items-center" ref={ref} data-testid="note-zoom-control">
            <button
                type="button"
                title="Zoom out"
                aria-label="Zoom out"
                className={btnCls}
                disabled={!canZoomOut}
                onMouseDown={(e) => e.preventDefault()}
                onClick={zoomOut}
                data-testid="note-zoom-out"
            >
                −
            </button>
            <button
                type="button"
                title="Zoom level — click to choose a preset"
                aria-label={`Zoom ${level}% — click to choose a preset`}
                className="h-7 min-w-[3rem] px-1 rounded text-xs tabular-nums hover:bg-[#e0e0e0] dark:hover:bg-[#505050]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setMenuOpen((v) => !v)}
                data-testid="note-zoom-readout"
            >
                {level}%
            </button>
            <button
                type="button"
                title="Zoom in"
                aria-label="Zoom in"
                className={btnCls}
                disabled={!canZoomIn}
                onMouseDown={(e) => e.preventDefault()}
                onClick={zoomIn}
                data-testid="note-zoom-in"
            >
                +
            </button>

            {menuOpen && (
                <div
                    className="absolute top-full right-0 mt-1 z-50 py-1 rounded shadow-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-xs text-[#1e1e1e] dark:text-[#cccccc]"
                    data-testid="note-zoom-menu"
                    role="menu"
                >
                    {NOTE_ZOOM_PRESETS.map((preset) => (
                        <button
                            key={preset}
                            type="button"
                            role="menuitemradio"
                            aria-checked={level === preset}
                            className={
                                'block w-full text-left px-3 py-1 tabular-nums hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] ' +
                                (level === preset ? 'font-semibold bg-[#f0f0f0] dark:bg-[#2a2a2a]' : '')
                            }
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                                setZoom(preset);
                                setMenuOpen(false);
                            }}
                            data-testid={`note-zoom-preset-${preset}`}
                        >
                            {preset}%
                        </button>
                    ))}
                    <div className="my-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]" />
                    <button
                        type="button"
                        role="menuitem"
                        className="block w-full text-left px-3 py-1 hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c]"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                            reset();
                            setMenuOpen(false);
                        }}
                        data-testid="note-zoom-reset"
                    >
                        Reset to {NOTE_ZOOM_DEFAULT}%
                    </button>
                </div>
            )}
        </div>
    );
}
