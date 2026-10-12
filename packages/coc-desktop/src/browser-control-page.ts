import { buildBrowserDomExpression, type BrowserDomCommand, type BrowserDomSnapshot, type BrowserDomSnapshotChunk, type BrowserDomReadPage, type BrowserDomTarget } from './browser-control-dom';
import { setTimeout as delay } from 'node:timers/promises';

export type BrowserCdpSender = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
export type BrowserScrollDirection = 'up' | 'down' | 'left' | 'right';

/** One instance per owner-qualified URL view, retained across its navigations. */
export class BrowserControlPage {
    private nextRef = 1;

    constructor(private readonly send: BrowserCdpSender, private readonly platform = process.platform) {}

    private async dom<T>(command: BrowserDomCommand): Promise<T> {
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

    readPage(ref?: string, offset = 0): Promise<BrowserDomReadPage> {
        return this.dom<BrowserDomReadPage>({ action: 'read', ref, paged: true, offset });
    }

    async evaluate(js: string): Promise<unknown> {
        const result = await this.evaluateForTool(js);
        if (result.valueTruncated) throw new Error('Browser evaluation exceeds 4000 characters; return a smaller result');
        return JSON.parse(result.valueJson);
    }

    async evaluateForTool(js: string): Promise<{ valueJson: string; valueTruncated: boolean }> {
        // Serialize and cap in the page before CDP can copy a large object into native transport.
        const expression = `Promise.resolve((0, eval)(${JSON.stringify(js)})).then(value => {
            if (typeof value === 'bigint') value = value.toString() + 'n';
            else if (typeof value === 'number' && !Number.isFinite(value)) value = String(value);
            const json = JSON.stringify(value) ?? 'null';
            return { valueJson: json.slice(0, 4000), valueTruncated: json.length > 4000 };
        })`;
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

    async screenshot(ref?: string): Promise<{ data: string; mimeType: 'image/jpeg' }> {
        const metrics = await this.send('Page.getLayoutMetrics') as { cssVisualViewport?: { clientWidth: number; clientHeight: number; pageX: number; pageY: number }; visualViewport?: { clientWidth: number; clientHeight: number; pageX: number; pageY: number } };
        const viewport = metrics.cssVisualViewport ?? metrics.visualViewport;
        if (!viewport || viewport.clientWidth <= 0 || viewport.clientHeight <= 0) throw new Error('Browser viewport unavailable');
        const target = ref ? await this.dom<BrowserDomTarget>({ action: 'target', ref }) : undefined;
        // Resolving a ref scrolls it into view, so obtain the resulting viewport origin.
        const current = target ? await this.send('Page.getLayoutMetrics') as typeof metrics : metrics;
        const origin = current.cssVisualViewport ?? current.visualViewport ?? viewport;
        const clip = target
            ? { x: target.x + origin.pageX, y: target.y + origin.pageY, width: target.width, height: target.height }
            : { x: viewport.pageX, y: viewport.pageY, width: viewport.clientWidth, height: viewport.clientHeight };
        const pixelRatio = await this.evaluate('window.devicePixelRatio');
        if (typeof pixelRatio !== 'number' || !Number.isFinite(pixelRatio) || pixelRatio <= 0) throw new Error('Browser pixel ratio unavailable');
        const result = await this.send('Page.captureScreenshot', {
            format: 'jpeg', quality: 75, captureBeyondViewport: true,
            clip: { ...clip, scale: Math.min(1, 1280 / (clip.width * pixelRatio)) },
        }) as { data?: string };
        if (!result.data) throw new Error('Browser screenshot returned no image');
        return { data: result.data, mimeType: 'image/jpeg' };
    }

    private async mouse(target: BrowserDomTarget): Promise<void> {
        const x = target.x + target.width / 2;
        const y = target.y + target.height / 2;
        await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    }

    async click(ref: string): Promise<void> {
        await this.mouse(await this.dom<BrowserDomTarget>({ action: 'target', ref }));
    }

    /** Replace an editable field using trusted selection and text insertion. */
    async type(ref: string, text: string, submit = false): Promise<void> {
        await this.mouse(await this.dom<BrowserDomTarget>({ action: 'target', ref, editable: true }));
        await this.press(this.platform === 'darwin' ? 'Meta+a' : 'Control+a');
        await this.send('Input.insertText', { text });
        if (submit) await this.press('Enter');
    }

    async selectOption(ref: string, value: string): Promise<void> {
        const target = await this.dom<BrowserDomTarget>({ action: 'target', ref, option: value });
        // Keyboard selection preserves Chromium's trusted input/change events.
        await this.press('Home');
        for (let index = 0; index < target.optionSteps!; index++) await this.press('ArrowDown');
    }

    async press(shortcut: string): Promise<void> {
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
        await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params, ...(text && !(modifiers & 7) ? { text, unmodifiedText } : {}) });
        await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
    }

    async scroll(direction: BrowserScrollDirection, ref?: string): Promise<void> {
        const target = ref ? await this.dom<BrowserDomTarget>({ action: 'target', ref }) : { x: 0, y: 0, width: 2, height: 2 };
        const deltas = { up: [0, -600], down: [0, 600], left: [-600, 0], right: [600, 0] };
        const [deltaX, deltaY] = deltas[direction];
        await this.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel', x: target.x + target.width / 2, y: target.y + target.height / 2, deltaX, deltaY,
        });
    }

    async wait(textOrMs: string | number, signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        if (typeof textOrMs === 'number') {
            if (!Number.isFinite(textOrMs) || textOrMs < 0 || textOrMs > 30_000) throw new Error('wait ms must be between 0 and 30000');
            await delay(textOrMs, undefined, { signal });
            return;
        }
        if (!textOrMs.trim()) throw new Error('wait text must not be empty');
        const deadline = Date.now() + 30_000;
        do {
            signal?.throwIfAborted();
            if (await this.dom<boolean>({ action: 'text', text: textOrMs })) return;
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            await delay(Math.min(100, remaining), undefined, { signal });
        } while (Date.now() < deadline);
        throw new Error('Text not found after 30s');
    }
}
