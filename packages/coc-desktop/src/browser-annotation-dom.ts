import { browserClipRect } from './browser-control-clip';
import { browserAnnotationSnapshot, type BrowserAnnotationPageSnapshot, type BrowserAnnotationElementSnapshot } from './browser-annotation-snapshot';

export interface BrowserAnnotationRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface BrowserAnnotationSelection {
    type: 'selection';
    kind: 'element' | 'area';
    rect: BrowserAnnotationRect;
    tag?: string;
    immediate: boolean;
    page: BrowserAnnotationPageSnapshot;
    element?: BrowserAnnotationElementSnapshot;
}

export type BrowserAnnotationEvent =
    | BrowserAnnotationSelection
    | { type: 'comment'; comment: string; selection: BrowserAnnotationSelection }
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

/** Self-contained selection and comment editor. Hosts execute it only in an owned URL guest's isolated world. */
function browserAnnotation(command: BrowserAnnotationCommand, clipRect: typeof browserClipRect, snapshot: typeof browserAnnotationSnapshot): BrowserAnnotationResult {
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
            .editor { position: absolute; width: min(300px, 100vw); max-height: 100vh; overflow: auto;
                padding: 12px; border: 1px solid #94a3b8; border-radius: 8px; background: #ffffff;
                box-shadow: 0 4px 16px rgb(0 0 0 / 20%); color: #0f172a; font: 14px/20px sans-serif; }
            .editor textarea { display: block; width: 100%; height: 80px; padding: 6px;
                border: 1px solid #94a3b8; border-radius: 4px; resize: none; white-space: pre-wrap;
                overflow: auto; background: #ffffff; color: #0f172a; font: 14px/20px sans-serif; }
            .editor button { display: inline-block; margin: 8px 8px 0 0; padding: 4px 10px;
                border-radius: 4px; background: #e2e8f0; color: #0f172a; font: 14px/20px sans-serif;
                cursor: pointer; }
            .editor .save { background: #2563eb; color: #ffffff; }
            .editor button:disabled { opacity: .5; cursor: default; }
            .editor :focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
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
        const editor = document.createElement('div');
        editor.className = 'editor';
        editor.setAttribute('role', 'dialog');
        editor.setAttribute('aria-label', 'Page comment');
        editor.hidden = true;
        const input = document.createElement('textarea');
        input.setAttribute('aria-label', 'Comment');
        input.placeholder = 'Add a comment';
        input.maxLength = 8000;
        const save = document.createElement('button');
        save.className = 'save';
        save.textContent = 'Save';
        save.type = 'button';
        const cancel = document.createElement('button');
        cancel.textContent = 'Cancel';
        cancel.type = 'button';
        editor.append(input, save, cancel);
        root.append(style, shield, outline, label, editor);
        const listeners: (() => void)[] = [];
        let drag: { x: number; y: number; pointerId: number } | null = null;
        let suppressClick = false;
        let pending: BrowserAnnotationSelection | null = null;
        const owned: Mode = {
            session: command.session, url: location.href, active: true, events: [],
            dispose(reason) {
                if (!owned.active) return;
                owned.active = false;
                drag = null;
                pending = null;
                input.value = '';
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
        const swallow = (event: Event, preventDefault = true) => {
            if (preventDefault && event.cancelable) event.preventDefault();
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
        const report = (event: BrowserAnnotationEvent) => {
            // A stalled host must not leave an unbounded queue or a page-blocking overlay.
            if (owned.events.length >= 32) { owned.dispose('overflow'); return; }
            owned.events.push(event);
        };
        const closeEditor = () => {
            pending = null;
            suppressClick = false;
            input.value = '';
            editor.hidden = true;
            hide();
            host.focus({ preventScroll: true });
        };
        const saveComment = () => {
            if (!pending || !input.value.trim() || input.value.length > input.maxLength) return;
            report({ type: 'comment', comment: input.value, selection: pending });
            if (owned.active) closeEditor();
        };
        const select = (selection: BrowserAnnotationSelection) => {
            report(selection);
            if (!owned.active) return;
            pending = selection;
            input.value = '';
            save.disabled = true;
            editor.hidden = false;
            const width = Math.min(300, window.innerWidth);
            const height = Math.min(editor.getBoundingClientRect().height || 150, window.innerHeight);
            const below = selection.rect.y + selection.rect.height + 8;
            Object.assign(editor.style, {
                left: `${Math.max(0, Math.min(selection.rect.x, window.innerWidth - width))}px`,
                top: `${Math.max(0, Math.min(below + height <= window.innerHeight ? below : selection.rect.y - height - 8, window.innerHeight - height))}px`,
            });
            input.focus({ preventScroll: true });
        };
        // Closed-root event paths are retargeted at the host in window capture. Hit-test
        // inside our private root, then stop propagation here while preserving native editing.
        const editorPointer = (event: MouseEvent) => {
            if (!pending || event.target !== host) return false;
            const element = root.elementFromPoint?.(event.clientX, event.clientY);
            if (!element || !editor.contains(element)) return false;
            swallow(event, false);
            if (event.type === 'click') {
                if (element === save) { event.preventDefault(); saveComment(); }
                if (element === cancel) { event.preventDefault(); closeEditor(); }
            }
            return true;
        };
        const editorInput = (event: Event) => {
            if (!pending || event.target !== host || !root.activeElement || !editor.contains(root.activeElement)) return false;
            swallow(event, false);
            save.disabled = !input.value.trim() || input.value.length > input.maxLength;
            return true;
        };
        const area = (x: number, y: number): BrowserAnnotationRect => {
            const end = point(x, y);
            return { x: Math.min(drag!.x, end.x), y: Math.min(drag!.y, end.y), width: Math.abs(end.x - drag!.x), height: Math.abs(end.y - drag!.y) };
        };
        listen('pointerdown', event => {
            if (!current() || editorPointer(event)) return;
            swallow(event);
            if (pending) return;
            if (event.button !== 0 || event.isPrimary === false) return;
            suppressClick = false;
            if (event.shiftKey) {
                drag = { ...point(event.clientX, event.clientY), pointerId: event.pointerId };
                hide();
            }
        });
        listen('pointermove', event => {
            if (!current() || editorPointer(event)) return;
            swallow(event);
            if (pending) return;
            if (drag) {
                if (event.pointerId === drag.pointerId) show(area(event.clientX, event.clientY), 'Area');
            } else {
                const target = elementAt(event.clientX, event.clientY);
                if (target) show(target.rect, target.element.localName); else hide();
            }
        });
        listen('pointerup', event => {
            if (!current() || editorPointer(event)) return;
            swallow(event);
            if (pending) return;
            if (!drag || event.pointerId !== drag.pointerId || event.button !== 0) return;
            const rect = area(event.clientX, event.clientY);
            drag = null;
            suppressClick = true;
            if (rect.width < 3 || rect.height < 3) { hide(); return; }
            show(rect, 'Area');
            select({ type: 'selection', kind: 'area', rect, immediate: false, ...snapshot() });
        });
        listen('click', event => {
            if (!current() || editorPointer(event)) return;
            swallow(event);
            if (pending) return;
            if (suppressClick) { suppressClick = false; return; }
            if (event.button !== 0 || event.shiftKey) return;
            const target = elementAt(event.clientX, event.clientY);
            if (!target) { hide(); return; }
            show(target.rect, target.element.localName);
            select({ type: 'selection', kind: 'element', rect: target.rect, tag: target.element.localName, immediate: event.ctrlKey || event.metaKey, ...snapshot(target.element) });
        });
        listen('keydown', event => {
            if (!current()) return;
            if (pending && event.key !== 'Escape' && editorInput(event)) {
                if (event.key === 'Tab') {
                    event.preventDefault();
                    const stops = [input, ...(!save.disabled ? [save] : []), cancel];
                    const index = stops.indexOf(root.activeElement as HTMLTextAreaElement | HTMLButtonElement);
                    stops[(index + (event.shiftKey ? stops.length - 1 : 1)) % stops.length].focus({ preventScroll: true });
                } else if ((event.key === 'Enter' || event.key === ' ') && root.activeElement !== input) {
                    event.preventDefault();
                    if (!event.repeat) { if (root.activeElement === save) saveComment(); else closeEditor(); }
                }
                return;
            }
            swallow(event);
            if (event.key === 'Escape' && !event.repeat) {
                if (pending) closeEditor(); else owned.dispose('escape');
            }
        });
        const cancelDrag = () => { if (drag) suppressClick = true; drag = null; if (!pending) hide(); };
        listen('pointercancel', event => { swallow(event); cancelDrag(); });
        listen('blur', event => { if (event.target === window) cancelDrag(); });
        listen('resize', cancelDrag);
        listen('scroll', cancelDrag);
        for (const name of ['mousedown', 'mouseup', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchmove', 'touchend', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'copy', 'cut', 'paste', 'submit', 'dragstart', 'drop', 'wheel'] as const) {
            listen(name, event => {
                if (!current()) return;
                if (event instanceof MouseEvent && editorPointer(event)) return;
                if (['keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'copy', 'cut', 'paste'].includes(name) && editorInput(event)) return;
                swallow(event);
            });
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
    return `(${browserAnnotation.toString()})(${JSON.stringify(command)},(${browserClipRect.toString()}),(${browserAnnotationSnapshot.toString()}))`;
}
