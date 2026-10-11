import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function fixture(deliverClick = true, clickDelay = 200, timerRunning = true) {
    const module = { exports: {} as { checkDomCompositing: (main: unknown, guest: unknown) => Promise<unknown> } };
    runInNewContext(readFileSync(new URL('./e2e/webview-security-checks.cjs', import.meta.url), 'utf8'), {
        module, setTimeout, __dirname: '',
        require: (name: string) => name === 'electron' ? {} : require(name),
    });
    let windowFocused = false;
    let rendererFocused = false;
    let menuFocused = false;
    let clicked = false;
    const startedAt = Date.now();
    const main = {
        focus() { windowFocused = true; },
        webContents: {
            focus() { rendererFocused = true; },
            async executeJavaScript(source: string) {
                if (source === 'window.__menuClicked') return clicked;
                if (source.includes("getElementById('overlay-menu').focus()")) menuFocused = true;
            },
            async capturePage() {
                return { crop: ({ x }: { x: number }) => ({ toBitmap: () => x === 460 ? [0, 0, 255, 255] : [255, 0, 0, 255] }) };
            },
            sendInputEvent(event: { type: string }) {
                if (event.type === 'mouseUp' && windowFocused && rendererFocused && menuFocused && deliverClick) {
                    // Chromium can acknowledge native input after the old 100 ms sleep.
                    if (clickDelay === 0) clicked = true;
                    else setTimeout(() => { clicked = true; }, clickDelay);
                }
            },
        },
    };
    const guest = { async executeJavaScript(source: string) {
        if (source === 'window.__liveTicks') return timerRunning ? Math.floor((Date.now() - startedAt) / 20) : 0;
    } };
    return () => module.exports.checkDomCompositing(main, guest);
}

afterEach(() => vi.useRealTimers());

describe('DOM compositing native input', () => {
    it('focuses the owner and waits for delayed click delivery', async () => {
        vi.useFakeTimers();
        const result = fixture()();
        await vi.runAllTimersAsync();
        await expect(result).resolves.toMatchObject({ clicked: true, pageStayedLive: true });
    });

    it('fails when native input never reaches the overlay', async () => {
        vi.useFakeTimers();
        const result = fixture(false)();
        const assertion = expect(result).rejects.toThrow('Expected values to be strictly equal');
        await vi.runAllTimersAsync();
        await assertion;
    });

    it('waits for guest timer progress when the click arrives immediately', async () => {
        vi.useFakeTimers();
        const result = fixture(true, 0)();
        await vi.runAllTimersAsync();
        await expect(result).resolves.toMatchObject({ clicked: true, pageStayedLive: true });
    });

    it('fails when the guest timer stops despite successful input', async () => {
        vi.useFakeTimers();
        const result = fixture(true, 0, false)();
        const assertion = expect(result).rejects.toThrow();
        await vi.runAllTimersAsync();
        await assertion;
    });
});
