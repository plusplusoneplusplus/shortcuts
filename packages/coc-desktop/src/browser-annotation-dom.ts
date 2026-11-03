import { browserClipRect } from './browser-control-clip';

export interface BrowserAnnotationRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export type BrowserAnnotationEvent =
    | { type: 'selection'; kind: 'element' | 'area'; rect: BrowserAnnotationRect; tag?: string; immediate: boolean }
    | { type: 'exit'; reason: 'escape' | 'navigation' | 'removed' | 'overflow' | 'stop' };

export interface BrowserAnnotationResult {
    active: boolean;
    events: BrowserAnnotationEvent[];
}

export interface BrowserAnnotationCommand {
    action: 'start' | 'drain' | 'stop';
    /** Drains and stops must match the generation established by the main-owned start. */
    session: string;
}

/** Self-contained selection primitive. Hosts execute it only in an owned URL guest's isolated world. */
function browserAnnotation(command: BrowserAnnotationCommand, clipRect: typeof browserClipRect): BrowserAnnotationResult {
    interface Mode {
        session: string;
        url: string;
        active: boolean;
        events: BrowserAnnotationEvent[];
        dispose(reason: Extract<BrowserAnnotationEvent, { type: 'exit' }>['reason']): void;
    }
    const page = window as Window & { __cocBrowserAnnotation?: Mode };
    let mode = page.__cocBrowserAnnotation;
    if (mode?.active && mode.url !== location.href) mode.dispose('navigation');
    if (command.action === 'start' && (!mode?.active || mode.session !== command.session)) {
        mode?.dispose('stop');
        const host = document.createElement('div');
        // The host is the only light-DOM node. Inline !important also neutralizes page !important rules.
        const hostStyles: Record<string, string> = {
            all: 'initial', position: 'fixed', inset: '0', width: '100vw', height: '100vh',
            display: 'block', 'z-index': '2147483647', background: 'transparent', opacity: '1',
            visibility: 'visible', transform: 'none', filter: 'none', isolation: 'isolate',
            'pointer-events': 'auto', 'touch-action': 'none', margin: '0', padding: '0', border: '0',
        };
        for (const [name, value] of Object.entries(hostStyles)) host.style.setProperty(name, value, 'important');
        host.tabIndex = -1;
        const root = host.attachShadow({ mode: 'closed' });
        const style = document.createElement('style');
        style.textContent = `
            :host, * { all: initial; box-sizing: border-box; }
            .shield { position: absolute; inset: 0; cursor: crosshair; touch-action: none; }
            .outline { position: absolute; pointer-events: none; border: 2px solid #2563eb;
                background: rgb(37 99 235 / 12%); }
            .label { position: absolute; pointer-events: none; padding: 3px 6px; border-radius: 4px;
                background: #1e3a8a; color: #ffffff; font: 12px/18px sans-serif; white-space: nowrap; }
            [hidden] { display: none; }
        `;
        const shield = document.createElement('div');
        shield.className = 'shield';
        const outline = document.createElement('div');
        outline.className = 'outline';
        outline.hidden = true;
        const label = document.createElement('div');
        label.className = 'label';
        label.hidden = true;
        root.append(style, shield, outline, label);
        const listeners: (() => void)[] = [];
        let drag: { x: number; y: number; pointerId: number } | null = null;
        let suppressClick = false;
        const owned: Mode = {
            session: command.session, url: location.href, active: true, events: [],
            dispose(reason) {
                if (!owned.active) return;
                owned.active = false;
                drag = null;
                observer.disconnect();
                for (const off of listeners) off();
                host.remove();
                owned.events.push({ type: 'exit', reason });
            },
        };
        mode = owned;
        Object.defineProperty(page, '__cocBrowserAnnotation', { value: owned, configurable: true });
        const observer = new MutationObserver(() => {
            if (!host.isConnected) owned.dispose('removed');
        });
        const listen = <K extends keyof WindowEventMap>(name: K, handler: (event: WindowEventMap[K]) => void) => {
            window.addEventListener(name, handler, { capture: true, passive: false });
            listeners.push(() => window.removeEventListener(name, handler, true));
        };
        const swallow = (event: Event) => {
            if (event.cancelable) event.preventDefault();
            event.stopImmediatePropagation();
        };
        const current = () => {
            if (owned.active && owned.url !== location.href) owned.dispose('navigation');
            if (owned.active && !host.isConnected) owned.dispose('removed');
            return owned.active;
        };
        const point = (x: number, y: number) => ({
            x: Math.max(0, Math.min(window.innerWidth, x)),
            y: Math.max(0, Math.min(window.innerHeight, y)),
        });
        const clipped = (rect: BrowserAnnotationRect, bounds = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }): BrowserAnnotationRect | null => {
            const x = Math.max(bounds.left, rect.x), y = Math.max(bounds.top, rect.y);
            const right = Math.min(bounds.right, rect.x + rect.width), bottom = Math.min(bounds.bottom, rect.y + rect.height);
            return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
        };
        const hit = (x: number, y: number): Element | null => {
            host.style.setProperty('display', 'none', 'important');
            try {
                let element = document.elementFromPoint(x, y);
                // Open shadows can identify their actual target; closed roots and frames stay opaque.
                for (let depth = 0; element?.shadowRoot && depth < 32; depth++) {
                    const nested = element.shadowRoot.elementFromPoint?.(x, y);
                    if (!nested || nested === element) break;
                    element = nested;
                }
                return element;
            } finally {
                host.style.setProperty('display', 'block', 'important');
            }
        };
        const hide = () => { outline.hidden = true; label.hidden = true; };
        const show = (rect: BrowserAnnotationRect, tag: string) => {
            outline.hidden = false;
            label.hidden = false;
            Object.assign(outline.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
            label.textContent = `${tag} ${Math.round(rect.width)} x ${Math.round(rect.height)}`;
            Object.assign(label.style, {
                left: `${Math.min(rect.x, Math.max(0, window.innerWidth - 180))}px`,
                top: `${rect.y >= 28 ? rect.y - 28 : Math.min(rect.y + rect.height, Math.max(0, window.innerHeight - 26))}px`,
            });
        };
        const elementAt = (x: number, y: number) => {
            const element = hit(x, y);
            if (!element || !element.isConnected || element === host) return null;
            const rect = clipped(element.getBoundingClientRect(), clipRect(element));
            return rect ? { element, rect } : null;
        };
        const select = (event: Extract<BrowserAnnotationEvent, { type: 'selection' }>) => {
            // A stalled host must not leave an unbounded queue or a page-blocking overlay.
            if (owned.events.length >= 32) { owned.dispose('overflow'); return; }
            owned.events.push(event);
        };
        const area = (x: number, y: number): BrowserAnnotationRect => {
            const end = point(x, y);
            return { x: Math.min(drag!.x, end.x), y: Math.min(drag!.y, end.y), width: Math.abs(end.x - drag!.x), height: Math.abs(end.y - drag!.y) };
        };
        listen('pointerdown', event => {
            if (!current()) return;
            swallow(event);
            if (event.button !== 0 || event.isPrimary === false) return;
            suppressClick = false;
            if (event.shiftKey) {
                drag = { ...point(event.clientX, event.clientY), pointerId: event.pointerId };
                hide();
            }
        });
        listen('pointermove', event => {
            if (!current()) return;
            swallow(event);
            if (drag) {
                if (event.pointerId === drag.pointerId) show(area(event.clientX, event.clientY), 'Area');
            } else {
                const target = elementAt(event.clientX, event.clientY);
                if (target) show(target.rect, target.element.localName); else hide();
            }
        });
        listen('pointerup', event => {
            if (!current()) return;
            swallow(event);
            if (!drag || event.pointerId !== drag.pointerId || event.button !== 0) return;
            const rect = area(event.clientX, event.clientY);
            drag = null;
            suppressClick = true;
            if (rect.width < 3 || rect.height < 3) { hide(); return; }
            show(rect, 'Area');
            select({ type: 'selection', kind: 'area', rect, immediate: false });
        });
        listen('click', event => {
            if (!current()) return;
            swallow(event);
            if (suppressClick) { suppressClick = false; return; }
            if (event.button !== 0 || event.shiftKey) return;
            const target = elementAt(event.clientX, event.clientY);
            if (!target) { hide(); return; }
            show(target.rect, target.element.localName);
            select({ type: 'selection', kind: 'element', rect: target.rect, tag: target.element.localName, immediate: event.ctrlKey || event.metaKey });
        });
        listen('keydown', event => {
            if (!current()) return;
            swallow(event);
            if (event.key === 'Escape') owned.dispose('escape');
        });
        const cancelDrag = () => { if (drag) suppressClick = true; drag = null; hide(); };
        listen('pointercancel', event => { swallow(event); cancelDrag(); });
        listen('blur', event => { if (event.target === window) cancelDrag(); });
        listen('resize', cancelDrag);
        listen('scroll', cancelDrag);
        for (const name of ['mousedown', 'mouseup', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchmove', 'touchend', 'keyup', 'beforeinput', 'input', 'submit', 'dragstart', 'drop', 'wheel'] as const) {
            listen(name, event => { if (current()) swallow(event); });
        }
        for (const name of ['pagehide', 'beforeunload', 'hashchange', 'popstate'] as const) {
            listen(name, () => owned.dispose('navigation'));
        }
        document.documentElement.append(host);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        host.focus({ preventScroll: true });
    }
    if (!mode || mode.session !== command.session) return { active: false, events: [] };
    if (command.action === 'stop') mode.dispose('stop');
    const result = { active: mode.active, events: mode.events.splice(0) };
    if (!mode.active) Reflect.deleteProperty(page, '__cocBrowserAnnotation');
    return result;
}

export function buildBrowserAnnotationExpression(command: BrowserAnnotationCommand): string {
    return `(${browserAnnotation.toString()})(${JSON.stringify(command)},(${browserClipRect.toString()}))`;
}
