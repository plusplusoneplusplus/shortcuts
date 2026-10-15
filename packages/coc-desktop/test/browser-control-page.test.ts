import { describe, expect, it, vi } from 'vitest';
import { BrowserControlPage } from '../src/browser-control-page';

function fixture() {
    const send = vi.fn(async (method: string, _params?: Record<string, unknown>): Promise<unknown> => method === 'Runtime.evaluate'
        ? { result: { value: { x: 10, y: 20, width: 80, height: 30, optionSteps: 2 } } } : {});
    return { send, page: new BrowserControlPage(send, 'linux') };
}

const mouse = [
    ['Input.dispatchMouseEvent', { type: 'mouseMoved', x: 50, y: 35 }],
    ['Input.dispatchMouseEvent', { type: 'mousePressed', x: 50, y: 35, button: 'left', clickCount: 1 }],
    ['Input.dispatchMouseEvent', { type: 'mouseReleased', x: 50, y: 35, button: 'left', clickCount: 1 }],
];
const key = (name: string, code: string, vk: number, modifiers = 0, text?: string, unmodifiedText = text) => [
    ['Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: vk, modifiers, ...(text ? { text, unmodifiedText } : {}) }],
    ['Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: vk, modifiers }],
];

describe('engine-neutral trusted CDP actions', () => {
    it('reads page/subtree markdown and evaluates by value with visible exceptions', async () => {
        const { send, page } = fixture();
        send.mockResolvedValueOnce({ result: { value: { text: '# Page\n\n[link](https://fixture.test/)', textTotal: 41 } } });
        expect(await page.read('e1')).toContain('# Page');
        expect(send.mock.calls[0][1]?.expression).toContain('"action":"read"');
        send.mockResolvedValueOnce({ result: { value: { valueJson: '{"answer":42}', valueTruncated: false } } });
        expect(await page.evaluate('({answer:42})')).toEqual({ answer: 42 });
        expect(send.mock.calls[1]).toEqual(['Runtime.evaluate', { expression: expect.stringContaining(JSON.stringify('({answer:42})')), returnByValue: true, awaitPromise: true }]);
        send.mockResolvedValueOnce({ exceptionDetails: { exception: { description: 'Error: fixture failure' } } });
        await expect(page.evaluate('throw new Error()')).rejects.toThrow('fixture failure');
        send.mockResolvedValueOnce({ result: { value: { valueJson: '"NaN"', valueTruncated: false } } });
        expect(await page.evaluate('NaN')).toBe('NaN');
        send.mockResolvedValueOnce({ result: { value: { valueJson: 'null', valueTruncated: false } } });
        expect(await page.evaluate('undefined')).toBeNull();
        send.mockResolvedValueOnce({});
        await expect(page.evaluate('42')).rejects.toThrow('no valid evaluation result');
    });

    it.each([
        [1, undefined], [2, undefined], [1, 'jpeg'], [2, 'jpeg'], [1, 'png'], [2, 'png'],
    ] as const)('captures binary images inline, bounded to 1280 pixels at ratio %s with format %s', async (pixelRatio, format) => {
        const { send, page } = fixture();
        const data = format === 'png' ? 'iVBORfixture==' : '/9j/fixture==';
        send.mockResolvedValueOnce({ cssVisualViewport: { clientWidth: 1920, clientHeight: 1080, pageX: 0, pageY: 600 } })
            .mockResolvedValueOnce({ result: { value: { valueJson: String(pixelRatio), valueTruncated: false } } })
            .mockResolvedValueOnce({ data });
        expect(await page.screenshot(undefined, format)).toEqual({ data, mimeType: format === 'png' ? 'image/png' : 'image/jpeg' });
        expect(send.mock.calls[2]).toEqual(['Page.captureScreenshot', {
            format: format ?? 'jpeg', ...(format === 'png' ? {} : { quality: 75 }), captureBeyondViewport: true,
            clip: { x: 0, y: 600, width: 1920, height: 1080, scale: 1280 / (1920 * pixelRatio) },
        }]);
        if (format === 'png') expect(send.mock.calls[2][1]).not.toHaveProperty('quality');
    });

    it.each(['jpeg', 'png'] as const)('crops %s screenshot refs in document coordinates after scrolling and reports missing images', async format => {
        const { send, page } = fixture();
        const metrics = { cssVisualViewport: { clientWidth: 800, clientHeight: 600, pageX: 5, pageY: 200 } };
        send.mockResolvedValueOnce(metrics)
            .mockResolvedValueOnce({ result: { value: { x: 10, y: 20, width: 100, height: 40 } } })
            .mockResolvedValueOnce(metrics)
            .mockResolvedValueOnce({ result: { value: { valueJson: '1', valueTruncated: false } } })
            .mockResolvedValueOnce({ data: 'aGVsbG8=' });
        await page.screenshot('e1', format);
        expect(send.mock.calls[4][1]?.clip).toEqual({ x: 15, y: 220, width: 100, height: 40, scale: 1 });
        send.mockResolvedValueOnce(metrics).mockResolvedValueOnce({ result: { value: { valueJson: '1', valueTruncated: false } } }).mockResolvedValueOnce({});
        await expect(page.screenshot()).rejects.toThrow('no image');
    });

    it('resolves/scrolls a ref then emits trusted mouse move, press and release at its center', async () => {
        const { send, page } = fixture();
        await page.click('e12');
        expect(send.mock.calls[0]).toEqual(['Runtime.evaluate', { expression: expect.stringContaining('"ref":"e12"'), returnByValue: true }]);
        expect(send.mock.calls.slice(1)).toEqual(mouse);
        expect(send.mock.calls[0][1]?.expression).not.toContain('.click(');
    });

    it('replaces text using trusted select-all and insertText, and optionally submits Enter', async () => {
        const { send, page } = fixture();
        await page.type('e1', 'quoted "text"\nnext', true);
        expect(send.mock.calls[0][1]?.expression).toContain('"editable":true');
        expect(send.mock.calls.slice(1)).toEqual([
            ...mouse, ...key('a', 'KeyA', 65, 2), ['Input.insertText', { text: 'quoted "text"\nnext' }], ...key('Enter', 'Enter', 13, 0, '\r'),
        ]);
    });

    it('uses the native selectAll editing command on macOS without submitting by default', async () => {
        const { send } = fixture();
        await new BrowserControlPage(send, 'darwin').type('e1', 'new');
        expect(send.mock.calls.slice(4)).toEqual([
            ['Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4, commands: ['selectAll'] }],
            key('a', 'KeyA', 65, 4)[1], ['Input.insertText', { text: 'new' }],
        ]);
    });

    it('cycles macOS native dropdown labels with trusted typeahead and verifies the exact option value', async () => {
        const { send } = fixture();
        const target = { x: 0, y: 0, width: 10, height: 10, optionSteps: 2,
            optionSearch: { text: 'Choice', selected: false, count: 3 } };
        let snapshots = 0;
        send.mockImplementation(async method => method === 'Runtime.evaluate'
            ? { result: { value: { ...target, optionSearch: { ...target.optionSearch, selected: ++snapshots === 3 } } } } : {});
        await new BrowserControlPage(send, 'darwin').selectOption('e1', 'third');
        expect(send.mock.calls.filter(call => call[0] === 'Input.dispatchKeyEvent')).toEqual([
            ['Input.dispatchKeyEvent', { type: 'char', text: 'C' }],
            ['Input.dispatchKeyEvent', { type: 'char', text: 'C' }],
        ]);
        expect(snapshots).toBe(3);
        expect(send.mock.calls[0][1]?.expression).toContain('"resetTypeAhead":true');
    });

    it.each([
        [{ text: 'Choice', selected: true, count: 3 }, undefined],
        [{ text: '', selected: false, count: 3 }, 'no searchable label'],
        [{ text: 'Choice', selected: false, count: 2 }, 'did not respond'],
    ] as const)('bounds macOS typeahead and surfaces unselectable options: %j', async (optionSearch, error) => {
        const { send } = fixture();
        send.mockImplementation(async method => method === 'Runtime.evaluate'
            ? { result: { value: { x: 0, y: 0, width: 10, height: 10, optionSearch } } } : {});
        const selection = new BrowserControlPage(send, 'darwin').selectOption('e1', 'third');
        if (error) await expect(selection).rejects.toThrow(error);
        else await selection;
        expect(send.mock.calls.filter(call => call[0] === 'Input.dispatchKeyEvent')).toHaveLength(error === 'did not respond' ? 2 : 0);
    });

    it('selects a native option through trusted keyboard events', async () => {
        const { send, page } = fixture();
        await page.selectOption('e5', 'third');
        expect(send.mock.calls[0][1]?.expression).toContain('"option":"third"');
        expect(send.mock.calls.slice(1)).toEqual([...key('Home', 'Home', 36), ...key('ArrowDown', 'ArrowDown', 40), ...key('ArrowDown', 'ArrowDown', 40)]);
    });

    it('retains trusted Home/arrow selection for macOS list boxes', async () => {
        const { send } = fixture();
        await new BrowserControlPage(send, 'darwin').selectOption('e5', 'third');
        expect(send.mock.calls.slice(1)).toEqual([...key('Home', 'Home', 36), ...key('ArrowDown', 'ArrowDown', 40), ...key('ArrowDown', 'ArrowDown', 40)]);
    });

    it.each([
        ['Enter', 'Enter', 'Enter', 13, 0, '\r'], ['Shift+Tab', 'Tab', 'Tab', 9, 8, '\t'],
        ['Ctrl+Shift+a', 'A', 'KeyA', 65, 10, undefined], ['Alt+ArrowLeft', 'ArrowLeft', 'ArrowLeft', 37, 1, undefined],
        ['Space', ' ', 'Space', 32, 0, ' '], ['Escape', 'Escape', 'Escape', 27, 0, undefined], ['7', '7', 'Digit7', 55, 0, '7'],
        ['Shift+a', 'A', 'KeyA', 65, 8, 'A', 'a'], ['/', '/', 'Slash', 191, 0, '/'], ['+', '+', 'Equal', 187, 0, '+'],
        ['Ctrl++', '+', 'Equal', 187, 2, undefined],
        ['Shift+7', '&', 'Digit7', 55, 8, '&', '7'], ['Shift+/', '?', 'Slash', 191, 8, '?', '/'], ['F5', 'F5', 'F5', 116, 0, undefined],
    ])('dispatches %s with correct CDP codes/modifiers', async (shortcut, name, code, vk, modifiers, text, unmodifiedText) => {
        const { send, page } = fixture();
        await page.press(shortcut);
        expect(send.mock.calls).toEqual(key(name, code, vk, modifiers, text, unmodifiedText));
    });

    it.each(['Hyper+a', 'BogusKey', '', 'Ctrl+'])('rejects unsupported key %s before sending input', async shortcut => {
        const { send, page } = fixture();
        await expect(page.press(shortcut)).rejects.toThrow(/key/i);
        expect(send).not.toHaveBeenCalled();
    });

    it.each([
        ['up', 0, -600], ['down', 0, 600], ['left', -600, 0], ['right', 600, 0],
    ] as const)('scrolls %s with trusted wheel input', async (direction, deltaX, deltaY) => {
        const { send, page } = fixture();
        await page.scroll(direction, 'e8');
        expect(send.mock.calls.slice(1)).toEqual([['Input.dispatchMouseEvent', { type: 'mouseWheel', x: 50, y: 35, deltaX, deltaY }]]);
    });

    it('scrolls the page without requiring a ref', async () => {
        const { send, page } = fixture();
        await page.scroll('down');
        expect(send.mock.calls).toEqual([['Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1, y: 1, deltaX: 0, deltaY: 600 }]]);
    });

    it('retains the next ref counter on the host across navigations', async () => {
        const { send, page } = fixture();
        send.mockResolvedValue({ result: { value: { title: 'Test', url: 'http://fixture/', elements: [], nextRef: 12 } } });
        await page.snapshot();
        await page.snapshot({ all: true, ref: 'e5' });
        expect(send.mock.calls[0][1]?.expression).toContain('"nextRef":1');
        expect(send.mock.calls[1][1]?.expression).toContain('"nextRef":12');
        expect(send.mock.calls[1][1]?.expression).toContain('"all":true');
    });

    it('reassembles bounded snapshot chunks without losing entries or the next ref counter', async () => {
        const { send, page } = fixture();
        const snapshot = { title: 'Large', url: 'https://fixture.test/', elements: [
            { ref: 'e1', role: 'button', name: 'x'.repeat(140000), depth: 0 },
        ], nextRef: 42 };
        const json = JSON.stringify(snapshot);
        send.mockImplementation(async (_method, params) => {
            const offset = String(params?.expression).includes('"action":"snapshot-chunk"')
                ? Number(String(params?.expression).match(/"offset":(\d+)/)![1]) : 0;
            return { result: { value: { chunk: json.slice(offset, offset + 64000), token: 1, offset, total: json.length, nextRef: 42 } } };
        });
        expect(await page.snapshot()).toEqual(snapshot);
        expect(send).toHaveBeenCalledTimes(3);
        await page.snapshot();
        expect(send.mock.calls[3][1]?.expression).toContain('"nextRef":42');
    });

    it.each([
        { chunk: '', token: 1, offset: 0, total: 64001, nextRef: 7 },
        { chunk: 'tail', token: 2, offset: 4, total: 64001, nextRef: 7 },
    ])('rejects malformed or replaced snapshot chunks instead of returning partial baselines', async bad => {
        const { send, page } = fixture();
        send.mockResolvedValueOnce({ result: { value: { chunk: 'head', token: 1, offset: 0, total: 64001, nextRef: 7 } } })
            .mockResolvedValueOnce({ result: { value: bad } });
        await expect(page.snapshot()).rejects.toThrow('invalid snapshot chunk');
    });

    it('requests markdown pages at their real offsets before transport and exposes explicit eval truncation', async () => {
        const { send, page } = fixture();
        send.mockResolvedValueOnce({ result: { value: { text: 'Tail', textTotal: 1100004 } } });
        expect(await page.readPage('e1', 1100000)).toEqual({ text: 'Tail', textTotal: 1100004 });
        expect(send.mock.calls[0][1]?.expression).toContain('"paged":true,"offset":1100000');
        send.mockResolvedValueOnce({ result: { value: { valueJson: '"x'.padEnd(4000, 'x'), valueTruncated: true } } });
        expect(await page.evaluateForTool("'x'.repeat(1100000)")).toMatchObject({ valueTruncated: true });
        expect(send.mock.calls[1][1]?.expression).toContain('json.slice(0, 4000)');
        send.mockResolvedValueOnce({ result: { value: { valueJson: 'x'.repeat(4001), valueTruncated: true } } });
        await expect(page.evaluateForTool('42')).rejects.toThrow('no valid evaluation result');
    });

    it('surfaces page exceptions and emits no input for a stale ref', async () => {
        const { send, page } = fixture();
        send.mockResolvedValue({ exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: stale ref, re-snapshot\n at browserDom' } } });
        await expect(page.click('e9')).rejects.toThrow('stale ref, re-snapshot');
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('preserves transport errors and rejects malformed evaluation results', async () => {
        const { send, page } = fixture();
        send.mockResolvedValue({ result: { type: 'undefined' } });
        await expect(page.snapshot()).rejects.toThrow('returned no result');
        const error = new Error('Browser tab closed');
        send.mockRejectedValue(error);
        await expect(page.click('e1')).rejects.toBe(error);
    });

    it('stops a multi-command action at the first CDP error', async () => {
        const { send, page } = fixture();
        send.mockResolvedValueOnce({ result: { value: { x: 0, y: 0, width: 10, height: 10 } } }).mockRejectedValueOnce(new Error('crashed'));
        await expect(page.type('e1', 'must not insert')).rejects.toThrow('crashed');
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('polls for text until found without taking a snapshot or screenshot', async () => {
        const { send, page } = fixture();
        send.mockResolvedValueOnce({ result: { value: false } }).mockResolvedValueOnce({ result: { value: true } });
        await page.wait('Ready');
        expect(send).toHaveBeenCalledTimes(2);
        for (const call of send.mock.calls) {
            expect(call[0]).toBe('Runtime.evaluate');
            expect(call[1]?.expression).toContain('"action":"text","text":"Ready"');
        }
    });

    it('reports text timeout at the 30-second deadline', async () => {
        const { send, page } = fixture();
        send.mockResolvedValue({ result: { value: false } });
        const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(30_000);
        try { await expect(page.wait('Missing')).rejects.toThrow('Text not found after 30s'); }
        finally { now.mockRestore(); }
    });

    it.each([-1, 30_001, Infinity, NaN])('rejects invalid wait duration %s', async ms => {
        const { page } = fixture();
        await expect(page.wait(ms)).rejects.toThrow('between 0 and 30000');
    });

    it('waits for a duration without CDP and cancels a pending timer promptly', async () => {
        const { send, page } = fixture();
        await page.wait(0);
        const controller = new AbortController();
        const pending = page.wait(30_000, controller.signal);
        controller.abort();
        await expect(pending).rejects.toThrow(/abort/i);
        expect(send).not.toHaveBeenCalled();
    });

    it('honors cancellation before polling and while sleeping between polls', async () => {
        const { send, page } = fixture();
        const before = new AbortController();
        const reason = new Error('Turn cancelled');
        before.abort(reason);
        await expect(page.wait('Ready', before.signal)).rejects.toBe(reason);
        expect(send).not.toHaveBeenCalled();
        const during = new AbortController();
        send.mockImplementation(async () => { during.abort(reason); return { result: { value: false } }; });
        await expect(page.wait('Ready', during.signal)).rejects.toThrow(/abort/i);
        expect(send).toHaveBeenCalledTimes(1);
        await expect(page.wait('  ')).rejects.toThrow('must not be empty');
    });
});
