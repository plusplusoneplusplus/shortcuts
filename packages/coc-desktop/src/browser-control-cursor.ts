/** A rect or point in top-level viewport CSS pixels, the same space as trusted mouse input. */
export interface BrowserCursorRect { x: number; y: number; width: number; height: number }
export interface BrowserCursorPoint { x: number; y: number }

export type BrowserCursorCommand =
    | { op: 'click'; point: BrowserCursorPoint; from?: BrowserCursorPoint }
    | { op: 'field'; rect?: BrowserCursorRect; label: string; from?: BrowserCursorPoint }
    | { op: 'key'; key: string; rect?: BrowserCursorRect; from?: BrowserCursorPoint }
    | { op: 'scroll'; point?: BrowserCursorPoint; direction: 'up' | 'down' | 'left' | 'right'; from?: BrowserCursorPoint }
    | { op: 'hide' } | { op: 'show' } | { op: 'remove' };

export const BROWSER_CURSOR_TAG = 'coc-ai-cursor';

/**
 * Injected into the controlled view's top-level document by either engine. Keep it self-contained.
 * Draws only inside a closed shadow root on an inert fixed host and never touches focus, selection
 * or page layout. Styles go through the CSSOM so page CSP cannot block them. Returns the last
 * cursor point, or undefined when nothing is drawn.
 */
export function browserCursor(command: BrowserCursorCommand): BrowserCursorPoint | undefined {
    const effectMs = 600, idleMs = 3000, glideMs = 300;
    interface Overlay {
        document: Document;
        host: HTMLElement;
        layer: HTMLElement;
        cursor: HTMLElement;
        point?: BrowserCursorPoint;
        idle?: ReturnType<typeof setTimeout>;
        effects: Set<{ element: HTMLElement; timer: ReturnType<typeof setTimeout> }>;
    }
    const scope = window as Window & { __cocCursorOverlay?: Overlay };
    let overlay = scope.__cocCursorOverlay?.document === document ? scope.__cocCursorOverlay : undefined;
    if (command.op === 'remove') {
        if (overlay) {
            clearTimeout(overlay.idle);
            for (const effect of overlay.effects) clearTimeout(effect.timer);
            overlay.host.remove();
        }
        delete scope.__cocCursorOverlay;
        return undefined;
    }
    if (command.op === 'hide' || command.op === 'show') {
        if (overlay) overlay.layer.style.visibility = command.op === 'hide' ? 'hidden' : 'visible';
        return overlay?.point;
    }
    const finite = (...values: number[]) => values.every(value => typeof value === 'number' && Number.isFinite(value));
    const style = (element: HTMLElement, rules: Partial<CSSStyleDeclaration>) => { Object.assign(element.style, rules); };
    // The cursor keeps its end state in inline style, so its animations must not fill and mask later moves.
    const animate = (element: HTMLElement, frames: Keyframe[], duration: number, fill: FillMode = 'forwards') => {
        if (typeof element.animate === 'function') element.animate(frames, { duration, easing: 'ease-out', fill });
    };
    if (!overlay) {
        const host = document.createElement('coc-ai-cursor');
        host.setAttribute('aria-hidden', 'true');
        style(host, {
            all: 'initial', position: 'fixed', left: '0', top: '0', width: '0', height: '0', overflow: 'visible',
            zIndex: '2147483647', pointerEvents: 'none', contain: 'layout style', display: 'block',
        });
        const root = host.attachShadow({ mode: 'closed' });
        const layer = document.createElement('div');
        style(layer, { position: 'fixed', left: '0', top: '0', width: '0', height: '0', overflow: 'visible', pointerEvents: 'none' });
        const cursor = document.createElement('div');
        style(cursor, { position: 'fixed', left: '0', top: '0', width: '20px', height: '20px', opacity: '0', willChange: 'transform' });
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 20 20');
        svg.setAttribute('width', '20');
        svg.setAttribute('height', '20');
        const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        arrow.setAttribute('d', 'M2 1 L2 16 L6 12 L9 19 L12 18 L9 11 L15 11 Z');
        arrow.setAttribute('fill', '#7c3aed');
        arrow.setAttribute('stroke', '#ffffff');
        arrow.setAttribute('stroke-width', '1.5');
        arrow.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(arrow);
        cursor.appendChild(svg);
        layer.appendChild(cursor);
        root.appendChild(layer);
        (document.documentElement ?? document).appendChild(host);
        overlay = { document, host, layer, cursor, effects: new Set() };
        Object.defineProperty(scope, '__cocCursorOverlay', { value: overlay, configurable: true, writable: true });
    } else if (!overlay.host.isConnected) (document.documentElement ?? document).appendChild(overlay.host);
    const state = overlay;
    const effect = (rules: Partial<CSSStyleDeclaration>, frames: Keyframe[], text?: string) => {
        const element = document.createElement('div');
        style(element, { position: 'fixed', pointerEvents: 'none', boxSizing: 'border-box', ...rules });
        if (text !== undefined) {
            element.textContent = text;
            style(element, {
                font: '600 12px/1.4 system-ui, sans-serif', color: '#ffffff', background: '#7c3aed', borderRadius: '6px',
                padding: '2px 8px', whiteSpace: 'nowrap', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis',
                boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
            });
        }
        state.layer.appendChild(element);
        animate(element, frames, effectMs);
        const item = { element, timer: setTimeout(() => { element.remove(); state.effects.delete(item); }, effectMs) };
        state.effects.add(item);
        return element;
    };
    const fadeOut: Keyframe[] = [{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }];
    // Without an explicit rect, mark the top-level focused element (a focused frame marks its owner).
    const activeRect = (): BrowserCursorRect | undefined => {
        let active = document.activeElement;
        for (let depth = 0; active?.shadowRoot?.activeElement && depth < 256; depth++) active = active.shadowRoot.activeElement;
        if (!active || active === document.body || active === document.documentElement) return undefined;
        const { x, y, width, height } = active.getBoundingClientRect();
        return width > 0 && height > 0 ? { x, y, width, height } : undefined;
    };
    const fieldRect = command.op === 'field' || command.op === 'key' ? command.rect ?? activeRect() : undefined;
    const label = (text: string, x: number, y: number) => effect({ left: `${x}px`, top: `${y}px` }, fadeOut, text.slice(0, 80));
    // A key press leaves the cursor where it is; other actions move it to their target.
    const point = command.op === 'click' ? command.point
        : command.op === 'scroll' ? command.point ?? state.point ?? command.from ?? { x: innerWidth / 2, y: innerHeight / 2 }
            : command.op === 'field' && fieldRect ? { x: fieldRect.x + fieldRect.width / 2, y: fieldRect.y + fieldRect.height / 2 }
                : state.point ?? command.from;
    const from = state.point ?? command.from;
    if (point && finite(point.x, point.y)) {
        state.layer.style.visibility = 'visible';
        const at = (value: BrowserCursorPoint) => `translate(${value.x}px, ${value.y}px)`;
        state.cursor.style.transform = at(point);
        state.cursor.style.opacity = '1';
        if (from && finite(from.x, from.y) && (from.x !== point.x || from.y !== point.y)) {
            animate(state.cursor, [{ transform: at(from), opacity: 1 }, { transform: at(point), opacity: 1 }], glideMs, 'none');
        }
        state.point = { x: point.x, y: point.y };
    }
    if (command.op === 'click' && state.point) {
        const { x, y } = state.point;
        effect({ left: `${x - 16}px`, top: `${y - 16}px`, width: '32px', height: '32px', borderRadius: '50%', border: '3px solid #7c3aed' },
            [{ transform: 'scale(0.3)', opacity: 1 }, { transform: 'scale(1.4)', opacity: 0 }]);
    } else if (command.op === 'field' && fieldRect && finite(fieldRect.x, fieldRect.y, fieldRect.width, fieldRect.height)) {
        const { x, y, width, height } = fieldRect;
        effect({ left: `${x - 2}px`, top: `${y - 2}px`, width: `${width + 4}px`, height: `${height + 4}px`,
            border: '2px solid #7c3aed', borderRadius: '4px', background: 'rgba(124,58,237,0.08)' }, fadeOut);
        label(command.label, x, Math.max(0, y - 24));
    } else if (command.op === 'key') {
        const rect = fieldRect && finite(fieldRect.x, fieldRect.y, fieldRect.width, fieldRect.height) ? fieldRect : undefined;
        const x = rect ? rect.x : state.point?.x ?? innerWidth / 2;
        const y = rect ? rect.y + rect.height + 6 : (state.point?.y ?? innerHeight / 2) + 24;
        label(`⌨ ${command.key}`, Math.max(0, x), Math.min(Math.max(0, y), Math.max(0, innerHeight - 24)));
    } else if (command.op === 'scroll' && state.point) {
        const glyphs = { up: '↑', down: '↓', left: '←', right: '→' };
        const shift = { up: [0, -24], down: [0, 24], left: [-24, 0], right: [24, 0] }[command.direction];
        effect({ left: `${state.point.x - 16}px`, top: `${state.point.y - 16}px`, width: '32px', height: '32px',
            borderRadius: '50%', background: '#7c3aed', color: '#ffffff', font: '700 20px/32px system-ui, sans-serif', textAlign: 'center' },
        [{ transform: 'translate(0, 0)', opacity: 1 }, { transform: `translate(${shift[0]}px, ${shift[1]}px)`, opacity: 0 }]).textContent = glyphs[command.direction];
    }
    clearTimeout(state.idle);
    state.idle = setTimeout(() => {
        animate(state.cursor, [{ opacity: 1 }, { opacity: 0 }], 400, 'none');
        state.cursor.style.opacity = '0';
    }, idleMs);
    return state.point;
}

/** Overlay commands are ignored by callers on failure; the expression itself never throws to the page. */
export function buildBrowserCursorExpression(command: BrowserCursorCommand): string {
    return `(() => { try { return (${browserCursor.toString()})(${JSON.stringify(command)}); } catch { return undefined; } })()`;
}
