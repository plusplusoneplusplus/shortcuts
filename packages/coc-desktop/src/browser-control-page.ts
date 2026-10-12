import { buildBrowserDomExpression, type BrowserDomCommand, type BrowserDomSnapshot, type BrowserDomTarget } from './browser-control-dom';
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
        const result = await this.dom<BrowserDomSnapshot>({ ...options, action: 'snapshot', nextRef: this.nextRef });
        this.nextRef = result.nextRef;
        return result;
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
