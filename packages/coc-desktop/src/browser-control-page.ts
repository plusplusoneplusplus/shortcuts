import { buildBrowserDomExpression, type BrowserDomCommand, type BrowserDomSnapshot, type BrowserDomSnapshotChunk, type BrowserDomReadPage, type BrowserDomTarget } from './browser-control-dom';
import { setTimeout as delay } from 'node:timers/promises';
import { BrowserFrameRegistry, type BrowserCdpListener } from './browser-frame-registry';
import type { BrowserControlFrame } from '@plusplusoneplusplus/coc-client';
import { browserClipRect } from './browser-control-clip';
import { browserPaste } from './browser-control-paste';
import { randomUUID } from 'node:crypto';

export type BrowserCdpSender = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<unknown>;
export type BrowserScrollDirection = 'up' | 'down' | 'left' | 'right';
let nextFrameRef = 1;

/** One instance per owner-qualified URL view, retained across its navigations. */
export class BrowserControlPage {
    private nextRef = 1;
    private frames?: BrowserFrameRegistry;
    private readonly frameRefs = new Map<string, string>();
    private readonly readDocuments = new Map<string, string>();
    private executionFrame?: string;
    private budget?: { nodes: number; chars: number; refs: number };
    private inputRevision?: number;
    private mouseContext?: { session: string; x: number; y: number };

    private readonly send: BrowserCdpSender;

    constructor(send: BrowserCdpSender, private readonly platform = process.platform) {
        this.send = (method, params, session) => {
            const release = method === 'Input.dispatchMouseEvent' && params?.type === 'mouseReleased'
                || method === 'Input.dispatchKeyEvent' && params?.type === 'keyUp';
            if (method.startsWith('Input.') && !release && this.frames && this.inputRevision !== undefined) this.frames.assert(this.inputRevision);
            return session === undefined ? send(method, params) : send(method, params, session);
        };
    }

    async configureFrames(enabled: boolean, subscribe?: (listener: BrowserCdpListener) => () => void, ready?: () => Promise<void>): Promise<void> {
        this.inputRevision = undefined;
        if (!enabled) {
            if (this.frames) {
                const frames = this.frames;
                try {
                    for (const frame of frames.list()) if (frame.context !== undefined) {
                        await frames.evaluate('delete window.__cocBrowserControl', frame.id);
                    }
                    await frames.stop();
                } finally { this.frames = undefined; this.frameRefs.clear(); this.readDocuments.clear(); }
            }
            return;
        }
        if (!subscribe) throw new Error('unsupported-runtime: frame event transport unavailable');
        if (!this.frames) this.frames = new BrowserFrameRegistry(this.send, () => this.frameRefs.clear());
        await this.frames.start(subscribe, ready);
    }

    frameMetadata(offset = 0, frame?: string, ref?: string): { frames?: BrowserControlFrame[]; frame?: string; document?: string; truncated?: string } {
        if (!this.frames) return {};
        const selected = frame || ref ? this.frames.resolve(this.frameFor(ref, frame)) : this.frames.list()[0];
        return { frames: this.frames.metadata(offset), frame: selected?.id, document: selected?.document, truncated: this.frames.truncated };
    }

    dispose(): void {
        this.frames?.dispose();
        this.frames = undefined;
        this.frameRefs.clear();
        this.readDocuments.clear();
    }

    private frameFor(ref?: string, handle?: string): string | undefined {
        if (!this.frames) {
            if (handle) throw new Error('Browser frame control is disabled');
            return undefined;
        }
        const owner = ref ? this.frameRefs.get(ref) : undefined;
        if (ref && !owner) throw new Error('stale ref, re-snapshot');
        if (owner && handle && owner !== handle) throw new Error('Browser ref belongs to another frame');
        return this.frames.resolve(owner ?? handle).id;
    }

    private async dom<T>(command: BrowserDomCommand): Promise<T> {
        if (this.frames) {
            const frame = this.frameFor('ref' in command ? command.ref : undefined, this.executionFrame);
            const generation = this.frames.resolve(frame).document;
            const result = await this.frames.evaluate<T>(buildBrowserDomExpression({ ...command,
                scope: { ...(this.budget ?? { nodes: 20000, chars: 1000000, refs: 10000 }), generation } }), frame);
            if (result && typeof result === 'object' && this.budget) {
                const metrics = result as { visited?: number; consumed?: number };
                this.budget.nodes = Math.max(0, this.budget.nodes - (metrics.visited ?? 0));
                this.budget.chars = Math.max(0, this.budget.chars - (metrics.consumed ?? 0));
            }
            return result;
        }
        const reply = await this.send('Runtime.evaluate', {
            expression: buildBrowserDomExpression(command), returnByValue: true,
        }) as { result?: { value?: T }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
        if (reply.exceptionDetails) {
            throw new Error(reply.exceptionDetails.exception?.description?.split('\n')[0] || reply.exceptionDetails.text || 'Browser page evaluation failed');
        }
        if (!reply.result || !('value' in reply.result)) throw new Error('Browser page returned no result');
        return reply.result.value as T;
    }

    async snapshot(options: { ref?: string; all?: boolean } = {}): Promise<BrowserDomSnapshot> {
        if (this.frames) {
            await this.frames.refresh();
            const revision = this.frames.revision;
            const elements: BrowserDomSnapshot['elements'] = [];
            const selected = options.ref ? [this.frames.resolve(this.frameFor(options.ref))] : this.frames.list();
            this.budget = { nodes: 20000, chars: 1000000, refs: 10000 - this.frameRefs.size };
            try {
                for (const frame of selected) {
                    if (frame.context === undefined || frame.status === 'loading') continue;
                    if (!await this.visibleFrame(frame.id)) { frame.status = 'unavailable'; continue; }
                    frame.status = 'ready';
                    if (!this.budget.nodes || !this.budget.chars || this.frameRefs.size >= 10000) {
                        this.frames.truncated = 'aggregate-work-limit'; break;
                    }
                    this.budget.refs = 10000 - this.frameRefs.size;
                    this.nextRef = Math.max(this.nextRef, nextFrameRef);
                    if (this.nextRef > Number.MAX_SAFE_INTEGER - 10000) throw new Error('Browser frame reference limit exceeded');
                    // Reserve before asynchronous extraction so different view queues cannot alias refs.
                    nextFrameRef = this.nextRef + 10000;
                    this.executionFrame = frame.id;
                    const snapshot = await this.snapshotLocal(options);
                    for (const element of snapshot.elements) {
                        this.frameRefs.set(element.ref, frame.id);
                        elements.push({ ...element, frame: frame.id });
                    }
                    if (snapshot.truncated) this.frames.truncated = snapshot.truncated;
                }
                this.frames.assert(revision);
                const info = await this.frames.evaluate<{ title: string; url: string }>('({title:document.title,url:location.href})');
                return { ...info, elements, nextRef: this.nextRef };
            } finally { this.executionFrame = undefined; this.budget = undefined; }
        }
        return this.snapshotLocal(options);
    }

    private async snapshotLocal(options: { ref?: string; all?: boolean }): Promise<BrowserDomSnapshot> {
        const result = await this.dom<BrowserDomSnapshot | BrowserDomSnapshotChunk>({ ...options, action: 'snapshot', nextRef: this.nextRef });
        this.nextRef = result.nextRef;
        if ('elements' in result) return result;
        let json = result.chunk;
        if (result.offset !== 0 || !json.length || json.length > 64000 || result.total < json.length) throw new Error('Browser returned an invalid snapshot chunk');
        while (json.length < result.total) {
            const chunk = await this.dom<BrowserDomSnapshotChunk>({ action: 'snapshot-chunk', token: result.token, offset: json.length });
            if (chunk.token !== result.token || chunk.offset !== json.length || chunk.total !== result.total
                || !chunk.chunk.length || chunk.chunk.length > 64000 || json.length + chunk.chunk.length > result.total) {
                throw new Error('Browser returned an invalid snapshot chunk');
            }
            json += chunk.chunk;
        }
        const snapshot: BrowserDomSnapshot | null = JSON.parse(json);
        if (!snapshot || typeof snapshot.title !== 'string' || typeof snapshot.url !== 'string'
            || snapshot.nextRef !== result.nextRef || !Array.isArray(snapshot.elements)
            || !snapshot.elements.every(element => element && typeof element.ref === 'string' && typeof element.role === 'string'
                && typeof element.name === 'string' && typeof element.depth === 'number')) {
            throw new Error('Browser returned an invalid paged snapshot');
        }
        return snapshot;
    }

    async read(ref?: string): Promise<string> {
        return (await this.readPage(ref)).text;
    }

    async readPage(ref?: string, offset = 0, frame?: string): Promise<BrowserDomReadPage> {
        if (!this.frames) {
            this.frameFor(ref, frame);
            return this.dom<BrowserDomReadPage>({ action: 'read', ref, paged: true, offset });
        }
        await this.frames.refresh();
        const revision = this.frames.revision;
        const selected = ref || frame ? [this.frames.resolve(this.frameFor(ref, frame))] : this.frames.list();
        const readKey = ref ?? frame ?? 'main';
        const generation = JSON.stringify(selected.map(entry => [entry.id, entry.document]));
        if (offset && this.readDocuments.has(readKey) && this.readDocuments.get(readKey) !== generation) throw new Error('stale browser read continuation, restart at offset 0');
        let text = '';
        let total = 0;
        this.budget = { nodes: 20000, chars: 1000000, refs: 10000 };
        const append = (value: string) => {
            const start = Math.max(offset - total, 0);
            if (start < value.length && text.length < 8000) text += value.slice(start, start + 8000 - text.length);
            total += value.length;
        };
        try {
            for (const entry of selected) {
                if (!ref && !frame && entry.context !== undefined && !await this.visibleFrame(entry.id)) {
                    entry.status = 'unavailable';
                    append(`[frame ${entry.id} | origin ${entry.origin} | unavailable: hidden frame]\n[/frame ${entry.id}]\n`);
                    continue;
                }
                const header = `[frame ${entry.id} | origin ${entry.origin} | ${entry.status}]\n`;
                append(header);
                if (entry.context === undefined) append('[unavailable: no execution context]');
                else if (entry.status === 'loading') append('[loading: document not ready]');
                else {
                    this.executionFrame = entry.id;
                    const localOffset = Math.max(0, offset - total);
                    const page = await this.dom<BrowserDomReadPage>({ action: 'read', ref, paged: true, offset: localOffset });
                    if (text.length < 8000) text += page.text.slice(0, 8000 - text.length);
                    total += page.textTotal;
                    if (page.truncated) this.frames.truncated = page.truncated;
                }
                append(`\n[/frame ${entry.id}]\n`);
                if (!this.budget.nodes || !this.budget.chars) { this.frames.truncated = 'aggregate-work-limit'; break; }
            }
            this.frames.assert(revision);
            if (this.readDocuments.size >= 256 && !this.readDocuments.has(readKey)) this.readDocuments.delete(this.readDocuments.keys().next().value!);
            this.readDocuments.set(readKey, generation);
            return { text, textTotal: total };
        } finally { this.executionFrame = undefined; this.budget = undefined; }
    }

    async evaluate(js: string): Promise<unknown> {
        const result = await this.evaluateForTool(js);
        if (result.valueTruncated) throw new Error('Browser evaluation exceeds 4000 characters; return a smaller result');
        return JSON.parse(result.valueJson);
    }

    async evaluateForTool(js: string, frame?: string): Promise<{ valueJson: string; valueTruncated: boolean }> {
        // Serialize and cap in the page before CDP can copy a large object into native transport.
        const expression = `Promise.resolve((0, eval)(${JSON.stringify(js)})).then(value => {
            if (typeof value === 'bigint') value = value.toString() + 'n';
            else if (typeof value === 'number' && !Number.isFinite(value)) value = String(value);
            const json = JSON.stringify(value) ?? 'null';
            return { valueJson: json.slice(0, 4000), valueTruncated: json.length > 4000 };
        })`;
        if (this.frames) {
            const result = await this.frames.evaluate<{ valueJson: string; valueTruncated: boolean }>(expression, this.frameFor(undefined, frame), true);
            if (!result || typeof result.valueJson !== 'string' || typeof result.valueTruncated !== 'boolean' || result.valueJson.length > 4000) {
                throw new Error('Browser frame returned no valid evaluation result');
            }
            return result;
        }
        this.frameFor(undefined, frame);
        const reply = await this.send('Runtime.evaluate', {
            expression, returnByValue: true, awaitPromise: true,
        }) as { result?: { value?: { valueJson: string; valueTruncated: boolean } }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
        if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text || 'Browser page evaluation failed');
        const result = reply.result?.value;
        if (!result || typeof result.valueJson !== 'string' || typeof result.valueTruncated !== 'boolean' || result.valueJson.length > 4000) {
            throw new Error('Browser page returned no valid evaluation result');
        }
        return result;
    }

    async screenshot(ref?: string, format: 'jpeg' | 'png' = 'jpeg'): Promise<{ data: string; mimeType: 'image/jpeg' | 'image/png' }> {
        const metrics = await this.send('Page.getLayoutMetrics') as { cssVisualViewport?: { clientWidth: number; clientHeight: number; pageX: number; pageY: number }; visualViewport?: { clientWidth: number; clientHeight: number; pageX: number; pageY: number } };
        const viewport = metrics.cssVisualViewport ?? metrics.visualViewport;
        if (!viewport || viewport.clientWidth <= 0 || viewport.clientHeight <= 0) throw new Error('Browser viewport unavailable');
        const target = ref ? await this.target(ref) : undefined;
        // Resolving a ref scrolls it into view, so obtain the resulting viewport origin.
        const current = target ? await this.send('Page.getLayoutMetrics') as typeof metrics : metrics;
        const origin = current.cssVisualViewport ?? current.visualViewport ?? viewport;
        const clip = target
            ? { x: target.x + origin.pageX, y: target.y + origin.pageY, width: target.width, height: target.height }
            : { x: viewport.pageX, y: viewport.pageY, width: viewport.clientWidth, height: viewport.clientHeight };
        const pixelRatio = await this.evaluate('window.devicePixelRatio');
        if (typeof pixelRatio !== 'number' || !Number.isFinite(pixelRatio) || pixelRatio <= 0) throw new Error('Browser pixel ratio unavailable');
        const result = await this.send('Page.captureScreenshot', {
            format, ...(format === 'jpeg' ? { quality: 75 } : {}), captureBeyondViewport: true,
            clip: { ...clip, scale: Math.min(1, 1280 / (clip.width * pixelRatio)) },
        }) as { data?: string };
        if (!result.data) throw new Error('Browser screenshot returned no image');
        return { data: result.data, mimeType: format === 'png' ? 'image/png' : 'image/jpeg' };
    }

    private async mouse(target: BrowserDomTarget): Promise<void> {
        if (this.frames) this.inputRevision ??= this.frames.revision;
        const x = this.mouseContext?.x ?? target.x + target.width / 2;
        const y = this.mouseContext?.y ?? target.y + target.height / 2;
        const session = this.mouseContext?.session;
        await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, session);
        await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, session);
        await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, session);
    }

    async click(ref: string): Promise<void> {
        this.inputRevision = this.frames?.revision;
        await this.mouse(await this.target(ref));
    }

    /** Replace an editable field using trusted selection and text insertion. */
    async type(ref: string, text: string, submit = false): Promise<void> {
        this.inputRevision = this.frames?.revision;
        await this.mouse(await this.target(ref, { editable: true }));
        await this.assertFocusedRef(ref);
        await this.pressKey(this.platform === 'darwin' ? 'Meta+a' : 'Control+a');
        await this.assertFocusedRef(ref);
        await this.send('Input.insertText', { text });
        if (submit) await this.pressKey('Enter');
    }

    async selectOption(ref: string, value: string): Promise<void> {
        this.inputRevision = this.frames?.revision;
        const command: BrowserDomCommand = { action: 'target', ref, option: value,
            ...(this.platform === 'darwin' ? { resetTypeAhead: true } : {}) };
        let target = await this.target(ref, { option: value, ...(this.platform === 'darwin' ? { resetTypeAhead: true as const } : {}) });
        if (this.frames) await this.mouse(target);
        await this.assertFocusedRef(ref);
        // macOS arrow keys open an OS menu that CDP cannot drive. Trusted typeahead stays in the page.
        if (this.platform === 'darwin' && target.optionSearch) {
            if (target.optionSearch.selected) return;
            const { text, count } = target.optionSearch;
            if (!text) throw new Error('Option has no searchable label');
            for (let index = 0; index < count; index++) {
                if (target.optionSearch?.selected) return;
                await this.send('Input.dispatchKeyEvent', { type: 'char', text: text[0] });
                target = await this.dom<BrowserDomTarget>(command);
            }
            if (!target.optionSearch?.selected) throw new Error('Option did not respond to trusted keyboard input');
            return;
        }
        // Keyboard selection preserves Chromium's trusted input/change events.
        await this.pressKey('Home');
        for (let index = 0; index < target.optionSteps!; index++) await this.pressKey('ArrowDown');
    }

    async press(shortcut: string, frame?: string): Promise<void> {
        this.inputRevision = this.frames?.revision;
        if (this.frames) {
            const expression = frame ? `(() => {
                let active = document.activeElement;
                let depth = 0;
                while (active?.shadowRoot?.activeElement) {
                    if (++depth > 256) throw new Error('Browser focus depth limit exceeded');
                    active = active.shadowRoot.activeElement;
                }
                return document.hasFocus() && !!active && !active.matches('iframe,frame');
            })()` : 'document.hasFocus()';
            const focused = await this.frames.evaluate<boolean>(expression, this.frameFor(undefined, frame));
            if (!focused) throw new Error('Browser frame focus unavailable');
            if (frame && !await this.visibleFrame(frame)) throw new Error('Browser frame focus unavailable: frame is not visible');
        } else this.frameFor(undefined, frame);
        return this.pressKey(shortcut);
    }

    async pasteHtml(ref: string, write: () => void, signal: AbortSignal): Promise<void> {
        if (!this.frames) throw new Error('Rich paste requires browser frame control');
        const frames = this.frames;
        const frame = this.frameFor(ref)!;
        const revision = frames.revision;
        this.inputRevision = revision;
        const token = randomUUID();
        const run = (phase: Parameters<typeof browserPaste>[2]) => frames.evaluate<boolean>(
            `(${browserPaste.toString()})(${JSON.stringify(ref)},${JSON.stringify(token)},${JSON.stringify(phase)})`, frame);
        if (!await this.visibleFrame(frame)) throw new Error('Browser paste frame is not visible');
        await run('prepare');
        let dispatched = false;
        try {
            signal.throwIfAborted();
            frames.assert(revision);
            await run('check');
            signal.throwIfAborted();
            frames.assert(revision);
            write();
            await run('check');
            signal.throwIfAborted();
            frames.assert(revision);
            dispatched = true;
            await this.pressKey(this.platform === 'darwin' ? 'Meta+v' : 'Control+v');
            const deadline = Date.now() + 1500;
            while (!await run('result')) {
                signal.throwIfAborted();
                frames.assert(revision);
                if (Date.now() >= deadline) throw new Error('Trusted rich paste was not observed; outcome unknown, do not retry automatically');
                await delay(25, undefined, { signal });
            }
            frames.assert(revision);
            signal.throwIfAborted();
            await run('cleanup');
        } catch (error) {
            if (dispatched) throw new Error('Rich paste outcome unknown; do not retry automatically', { cause: error });
            throw error;
        }
    }

    private async pressKey(shortcut: string): Promise<void> {
        const parts = shortcut.split('+');
        let keyName = parts.pop()!;
        if (!keyName && parts.at(-1) === '') { parts.pop(); keyName = '+'; }
        let modifiers = 0;
        const modifierFlags: Record<string, number> = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Cmd: 4, Command: 4, Shift: 8 };
        for (const modifier of parts) {
            if (!modifierFlags[modifier]) throw new Error(`Unknown key modifier: ${modifier}`);
            modifiers |= modifierFlags[modifier];
        }
        const keys: Record<string, [string, string, number, string?]> = {
            Enter: ['Enter', 'Enter', 13, '\r'], Tab: ['Tab', 'Tab', 9, '\t'],
            Escape: ['Escape', 'Escape', 27], Backspace: ['Backspace', 'Backspace', 8], Delete: ['Delete', 'Delete', 46],
            ArrowLeft: ['ArrowLeft', 'ArrowLeft', 37], ArrowUp: ['ArrowUp', 'ArrowUp', 38],
            ArrowRight: ['ArrowRight', 'ArrowRight', 39], ArrowDown: ['ArrowDown', 'ArrowDown', 40],
            Home: ['Home', 'Home', 36], End: ['End', 'End', 35], PageUp: ['PageUp', 'PageUp', 33], PageDown: ['PageDown', 'PageDown', 34],
            Space: [' ', 'Space', 32, ' '],
            '+': ['+', 'Equal', 187, '+'], '-': ['-', 'Minus', 189, '-'], '=': ['=', 'Equal', 187, '='],
            ',': [',', 'Comma', 188, ','], '.': ['.', 'Period', 190, '.'], '/': ['/', 'Slash', 191, '/'],
            ';': [';', 'Semicolon', 186, ';'], "'": ["'", 'Quote', 222, "'"],
            '[': ['[', 'BracketLeft', 219, '['], ']': [']', 'BracketRight', 221, ']'],
            '\\': ['\\', 'Backslash', 220, '\\'], '`': ['`', 'Backquote', 192, '`'],
        };
        let spec = keys[keyName];
        if (!spec && /^[a-zA-Z0-9]$/.test(keyName)) {
            const letter = keyName.toUpperCase();
            spec = [keyName, /[0-9]/.test(keyName) ? `Digit${keyName}` : `Key${letter}`, letter.charCodeAt(0), keyName];
        }
        if (!spec && /^F([1-9]|1[0-2])$/.test(keyName)) spec = [keyName, keyName, 111 + Number(keyName.slice(1))];
        if (!spec) throw new Error(`Unsupported key: ${keyName}`);
        const [baseKey, code, windowsVirtualKeyCode, unmodifiedText] = spec;
        const shifted: Record<string, string> = { '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')', '-': '_', '=': '+', ',': '<', '.': '>', '/': '?', ';': ':', "'": '"', '[': '{', ']': '}', '\\': '|', '`': '~' };
        const key = modifiers & 8 ? shifted[baseKey] ?? (/^[a-z]$/.test(baseKey) ? baseKey.toUpperCase() : baseKey) : baseKey;
        const text = unmodifiedText && unmodifiedText === baseKey ? key : unmodifiedText;
        const params = { key, code, windowsVirtualKeyCode, modifiers };
        await this.send('Input.dispatchKeyEvent', {
            type: 'keyDown', ...params, ...(text && !(modifiers & 7) ? { text, unmodifiedText } : {}),
            ...(this.platform === 'darwin' && baseKey.toLowerCase() === 'a' && modifiers === 4 ? { commands: ['selectAll'] } : {}),
        });
        await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
    }

    async scroll(direction: BrowserScrollDirection, ref?: string, frame?: string): Promise<void> {
        this.inputRevision = this.frames?.revision;
        if (frame) this.frameFor(ref, frame);
        const target = ref ? await this.target(ref) : frame ? await this.viewport(frame) : { x: 0, y: 0, width: 2, height: 2 };
        const deltas = { up: [0, -600], down: [0, 600], left: [-600, 0], right: [600, 0] };
        const [deltaX, deltaY] = deltas[direction];
        await this.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel', x: target.x + target.width / 2, y: target.y + target.height / 2, deltaX, deltaY,
        });
    }

    async wait(textOrMs: string | number, signal?: AbortSignal, frame?: string): Promise<void> {
        signal?.throwIfAborted();
        if (typeof textOrMs === 'number') {
            if (!Number.isFinite(textOrMs) || textOrMs < 0 || textOrMs > 60_000) throw new Error('wait ms must be between 0 and 60000');
            await delay(textOrMs, undefined, { signal });
            return;
        }
        if (!textOrMs.trim()) throw new Error('wait text must not be empty');
        const deadline = Date.now() + 60_000;
        if (this.frames) this.budget = { nodes: 20000, chars: 1000000, refs: 10000 };
        try {
            do {
                signal?.throwIfAborted();
                if (this.frames) {
                    await this.frames.refresh();
                    const entries = frame ? [this.frames.resolve(frame)] : this.frames.list();
                    for (const entry of entries) {
                        if (entry.context === undefined || entry.status === 'loading') continue;
                        if (!this.budget!.nodes || !this.budget!.chars) throw new Error('Browser wait aggregate-work-limit exceeded');
                        if (!await this.visibleFrame(entry.id)) continue;
                        this.executionFrame = entry.id;
                        const match = await this.dom<{ found: boolean; truncated?: string }>({ action: 'text', text: textOrMs });
                        if (match.found) return;
                        if (match.truncated) throw new Error(`Browser wait ${match.truncated}`);
                    }
                } else {
                    this.frameFor(undefined, frame);
                    if (await this.dom<boolean>({ action: 'text', text: textOrMs })) return;
                }
                const remaining = deadline - Date.now();
                if (remaining <= 0) break;
                await delay(Math.min(100, remaining), undefined, { signal });
            } while (Date.now() < deadline);
        } finally { this.executionFrame = undefined; this.budget = undefined; }
        throw new Error('Text not found after 60s');
    }

    private async viewport(frame: string): Promise<BrowserDomTarget> {
        this.executionFrame = this.frameFor(undefined, frame);
        try {
            for (const child of this.ancestors(frame).reverse()) await this.frameOwner(child, true);
            await this.settleGeometry(frame);
            return await this.translate(await this.dom<BrowserDomTarget>({ action: 'viewport' }), frame);
        } finally { this.executionFrame = undefined; }
    }

    private async assertFocusedRef(ref: string): Promise<void> {
        if (!this.frames) return;
        const focused = await this.frames.evaluate<boolean>(`(() => {
            let active = document.activeElement;
            let depth = 0;
            while (active?.shadowRoot?.activeElement) {
                if (++depth > 256) throw new Error('Browser focus depth limit exceeded');
                active = active.shadowRoot.activeElement;
            }
            return document.hasFocus() && active === window.__cocBrowserControl?.refs.get(${JSON.stringify(ref)});
        })()`, this.frameFor(ref));
        if (!focused) throw new Error('Browser target focus unavailable');
    }

    private async target(ref: string, options: { editable?: boolean; option?: string; resetTypeAhead?: true } = {}): Promise<BrowserDomTarget> {
        this.mouseContext = undefined;
        if (!this.frames) return this.dom({ action: 'target', ref, ...options });
        const frame = this.frameFor(ref)!;
        const revision = this.frames.revision;
        const ancestry = this.ancestors(frame);
        for (const child of [...ancestry].reverse()) await this.frameOwner(child, true);
        await this.dom<BrowserDomTarget>({ action: 'target', ref, ...options });
        await this.settleGeometry(frame);
        const target = await this.dom<BrowserDomTarget>({ action: 'target', ref, ...options });
        const result = await this.translate(target, frame, ref);
        this.frames.assert(revision);
        return result;
    }

    private async settleGeometry(frame: string): Promise<void> {
        for (const handle of [...this.ancestors(frame), frame]) {
            await this.frames!.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))', handle, true);
        }
    }

    private ancestors(handle: string): string[] {
        const result: string[] = [];
        let frame = this.frames!.resolve(handle);
        while (frame.parent) {
            if (result.length >= 8) throw new Error('Browser frame depth limit exceeded');
            result.push(frame.id);
            frame = this.frames!.resolve(frame.parent);
        }
        return result;
    }

    private async frameOwner(childHandle: string, scroll: boolean, point?: { x: number; y: number }): Promise<{
        x: number; y: number; width: number; height: number; left: number; top: number; right: number; bottom: number;
    }> {
        const child = this.frames!.resolve(childHandle);
        const parent = this.frames!.resolve(child.parent);
        const owner = await this.send('DOM.getFrameOwner', { frameId: child.rawId }, parent.session) as { backendNodeId?: number };
        if (!owner.backendNodeId) throw new Error('Browser frame owner unavailable');
        const resolved = await this.send('DOM.resolveNode', { backendNodeId: owner.backendNodeId, executionContextId: parent.context }, parent.session) as { object?: { objectId?: string } };
        const objectId = resolved.object?.objectId;
        if (!objectId) throw new Error('Browser frame owner context unavailable');
        try {
            const reply = await this.send('Runtime.callFunctionOn', { objectId, returnByValue: true,
                functionDeclaration: `function(scroll,point){return (${frameOwnerGeometry.toString()}).call(this,scroll,point,(${browserClipRect.toString()}))}`,
                arguments: [{ value: scroll }, { value: point }] }, parent.session) as {
                    result?: { value?: { x: number; y: number; width: number; height: number; left: number; top: number; right: number; bottom: number } };
                    exceptionDetails?: { text?: string; exception?: { description?: string } };
                };
            if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description?.split('\n')[0] ?? 'Browser frame geometry unavailable');
            if (!reply.result?.value) throw new Error('Browser frame geometry unavailable');
            return reply.result.value;
        } finally {
            await this.send('Runtime.releaseObject', { objectId }, parent.session);
        }
    }

    private async visibleFrame(handle: string): Promise<boolean> {
        try {
            for (const ancestor of this.ancestors(handle)) await this.frameOwner(ancestor, false);
            return true;
        } catch (error) {
            if (error instanceof Error && /Browser frame (is hidden|has no visible bounds|execution context unavailable)/.test(error.message)) return false;
            throw error;
        }
    }

    private async translate(target: BrowserDomTarget, handle: string, ref?: string): Promise<BrowserDomTarget> {
        let result = { ...target };
        const transforms: Array<{ child: string; x: number; y: number; scaleX: number; scaleY: number }> = [];
        for (const childHandle of this.ancestors(handle)) {
            const viewport = await this.frames!.evaluate<{ width: number; height: number }>('({width:innerWidth,height:innerHeight})', childHandle);
            const owner = await this.frameOwner(childHandle, false);
            if (!viewport.width || !viewport.height) throw new Error('Browser frame viewport unavailable');
            const scaleX = owner.width / viewport.width, scaleY = owner.height / viewport.height;
            transforms.push({ child: childHandle, x: owner.x, y: owner.y, scaleX, scaleY });
            const x = owner.x + result.x * scaleX, y = owner.y + result.y * scaleY;
            const left = Math.max(x, owner.left), top = Math.max(y, owner.top);
            const right = Math.min(x + result.width * scaleX, owner.right), bottom = Math.min(y + result.height * scaleY, owner.bottom);
            if (right <= left || bottom <= top) throw new Error('Browser frame target is clipped');
            result = { ...result, x: left, y: top, width: right - left, height: bottom - top };
        }
        let point = { x: result.x + result.width / 2, y: result.y + result.height / 2 };
        const session = this.frames!.resolve(handle).session;
        let sessionPoint: { x: number; y: number } | undefined;
        for (const transform of transforms.reverse()) {
            await this.frameOwner(transform.child, false, point);
            point = { x: (point.x - transform.x) / transform.scaleX, y: (point.y - transform.y) / transform.scaleY };
            if (session && !sessionPoint && this.frames!.resolve(transform.child).session === session) sessionPoint = { ...point };
        }
        if (ref && !await this.dom<boolean>({ action: 'hit', ref, ...point })) throw new Error('Browser target is occluded');
        if (ref && session && sessionPoint) this.mouseContext = { session, ...sessionPoint };
        return result;
    }
}

/** Executed on a frame-owner element in its parent's context. */
function frameOwnerGeometry(this: HTMLElement, scroll: boolean, point: { x: number; y: number } | undefined, clipRect: typeof browserClipRect) {
    if (!this.isConnected) throw new Error('stale browser frame owner');
    if (scroll) this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = this.getBoundingClientRect();
    const scaleX = rect.width / this.offsetWidth, scaleY = rect.height / this.offsetHeight;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) throw new Error('Browser frame has no visible bounds');
    let { left, top, right, bottom } = clipRect(this);
    let ancestors = 0;
    for (let node: HTMLElement | null = this; node;) {
        if (++ancestors > 256) throw new Error('Browser frame ancestor limit exceeded');
        const style = getComputedStyle(node);
        if (node.hidden || node.inert || style.display === 'none' || style.visibility !== 'visible' || style.contentVisibility === 'hidden') throw new Error('Browser frame is hidden');
        if (style.transform !== 'none') {
            const matrix = new DOMMatrixReadOnly(style.transform);
            if (!matrix.is2D || matrix.b || matrix.c || matrix.a <= 0 || matrix.d <= 0) throw new Error('Browser frame transform is unsupported');
        }
        const root = node.getRootNode();
        node = node.parentElement ?? (root instanceof ShadowRoot ? root.host as HTMLElement : null);
    }
    const x = rect.x + this.clientLeft * scaleX, y = rect.y + this.clientTop * scaleY;
    const width = this.clientWidth * scaleX, height = this.clientHeight * scaleY;
    left = Math.max(left, x); top = Math.max(top, y); right = Math.min(right, x + width); bottom = Math.min(bottom, y + height);
    if (!(right > left && bottom > top)) throw new Error('Browser frame has no visible bounds');
    if (point) {
        let hit = this.ownerDocument.elementFromPoint(point.x, point.y);
        let shadows = 0;
        while (hit?.shadowRoot) {
            if (++shadows > 256) throw new Error('Browser frame hit depth limit exceeded');
            const nested = hit.shadowRoot.elementFromPoint(point.x, point.y);
            if (!nested || nested === hit) break;
            hit = nested;
        }
        if (hit !== this) throw new Error('Browser frame target is occluded');
    }
    return { x, y, width, height, left, top, right, bottom };
}
