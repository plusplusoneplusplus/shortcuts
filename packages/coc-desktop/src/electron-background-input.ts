import type { KeyboardInputEvent, MouseInputEvent, MouseWheelInputEvent } from 'electron';

/**
 * Electron routes CDP keyboard input for a `<webview>` guest to the embedder's focused frame, so a
 * background tab would type into the workspace on screen. Background input instead goes to the guest
 * WebContents itself (`sendInputEvent` / `insertText`), translated from the page engine's CDP calls.
 */
export type ElectronInputStep =
    | { kind: 'event'; event: MouseInputEvent | MouseWheelInputEvent | KeyboardInputEvent }
    | { kind: 'insertText'; text: string }
    | { kind: 'selectAll' };

type Modifier = NonNullable<KeyboardInputEvent['modifiers']>[number];

const MODIFIERS: [number, Modifier][] = [[1, 'alt'], [2, 'control'], [4, 'meta'], [8, 'shift']];
const KEY_NAMES: Record<string, string> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'Space' };
const MOUSE_TYPES: Record<string, MouseInputEvent['type']> = { mouseMoved: 'mouseMove', mousePressed: 'mouseDown', mouseReleased: 'mouseUp' };

function modifiers(mask: unknown): Modifier[] {
    const value = typeof mask === 'number' ? mask : 0;
    return MODIFIERS.filter(([flag]) => value & flag).map(([, name]) => name);
}

function coordinate(value: unknown): number {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error('Browser input coordinate is invalid');
    return Math.round(number);
}

function unsupported(detail: string): Error {
    return new Error(`foreground-required: ${detail} needs the workspace on screen`);
}

export function translateBackgroundInput(method: string, params: Record<string, unknown> = {}, sessionId?: string): ElectronInputStep[] {
    // Cross-process frames have their own coordinate space and input target.
    if (sessionId !== undefined) throw unsupported('input to a cross-process frame');
    const mask = modifiers(params.modifiers);
    switch (method) {
        case 'Input.insertText':
            return [{ kind: 'insertText', text: String(params.text ?? '') }];
        case 'Input.dispatchMouseEvent': {
            const x = coordinate(params.x), y = coordinate(params.y);
            if (params.type === 'mouseWheel') {
                // CDP deltas follow scroll direction; Chromium wheel events use the opposite sign.
                return [{ kind: 'event', event: { type: 'mouseWheel', x, y, deltaX: -Number(params.deltaX ?? 0), deltaY: -Number(params.deltaY ?? 0), canScroll: true, modifiers: mask } }];
            }
            const type = MOUSE_TYPES[String(params.type)];
            if (!type) throw unsupported(`mouse event ${String(params.type)}`);
            const button = params.button === 'right' || params.button === 'middle' ? params.button : 'left';
            return [{ kind: 'event', event: { type, x, y, button, clickCount: Number(params.clickCount ?? 0) || undefined, modifiers: mask } }];
        }
        case 'Input.dispatchKeyEvent': {
            if (params.type === 'char') {
                const text = String(params.text ?? '');
                if (!text) return [];
                return [{ kind: 'event', event: { type: 'char', keyCode: KEY_NAMES[text] ?? text, modifiers: mask } }];
            }
            const key = String(params.key ?? '');
            if (!key) throw unsupported('a key without a name');
            const keyCode = KEY_NAMES[key] ?? key;
            if (params.type === 'keyUp') return [{ kind: 'event', event: { type: 'keyUp', keyCode, modifiers: mask } }];
            if (params.type !== 'keyDown' && params.type !== 'rawKeyDown') throw unsupported(`key event ${String(params.type)}`);
            const steps: ElectronInputStep[] = [{ kind: 'event', event: { type: 'keyDown', keyCode, modifiers: mask } }];
            if (params.type === 'keyDown' && typeof params.text === 'string' && params.text) {
                steps.push({ kind: 'event', event: { type: 'char', keyCode, modifiers: mask } });
            }
            // macOS select-all is a browser command, not a key binding the renderer handles.
            if (Array.isArray(params.commands) && params.commands.includes('selectAll')) steps.push({ kind: 'selectAll' });
            return steps;
        }
        default:
            throw unsupported(method);
    }
}
