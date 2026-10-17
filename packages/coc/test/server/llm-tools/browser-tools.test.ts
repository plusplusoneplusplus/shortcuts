import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { BrowserCommand, BrowserControlElement, BrowserControlRuntime } from '@plusplusoneplusplus/coc-client';
import { BROWSER_TOOL_PARAMETERS } from '@plusplusoneplusplus/coc-client';
import type { ToolResultObject } from '@plusplusoneplusplus/coc-agent-sdk';
import {
    BROWSER_DELTA_LINES, BROWSER_EVAL_CAP, BROWSER_READ_CAP, BROWSER_SCHEMA_CHAR_BUDGET, BROWSER_SNAPSHOT_CAP,
    BROWSER_TOOL_DESCRIPTION, BrowserToolStateStore, createBrowserTool, formatBrowserDelta, formatBrowserSnapshot, formatBrowserFrameSnapshot,
} from '../../../src/server/llm-tools/browser-tools';

vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>() }));

const invocation = { toolName: 'browser', toolCallId: 'call', sessionId: 'session', arguments: {} };
const element = (ref = 'e1', name = 'Save'): BrowserControlElement => ({ ref, name, role: 'button', depth: 0 });
let dataDir: string;
beforeEach(() => { dataDir = path.resolve(`.browser-tool-test-${randomUUID()}`); fs.mkdirSync(dataDir); });
afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dataDir, { recursive: true, force: true });
});
function harness(stateStore = new BrowserToolStateStore(dataDir), workspaceId = 'workspace-a', processId = 'process-a') {
    const execute = vi.fn<BrowserControlRuntime['execute']>(async () => ({
        tab: '1:view', title: 'Fixture', url: 'https://fixture.test/', elements: [element()],
    }));
    const runtime = { getEnabled: () => true, execute };
    const tool = createBrowserTool({ workspaceId, processId, runtime, stateStore });
    const call = async (command: BrowserCommand) => await tool.handler!(command, invocation) as ToolResultObject;
    return { tool, call, execute, runtime, stateStore };
}

describe('compact browser tool', () => {
    it('forwards bounded rich paste without reflecting clipboard content in the result', async () => {
        const h = harness();
        const command = { action: 'paste_html', ref: 'e1', html: '<b>Synthetic payload</b>', text: 'Synthetic payload', replaceClipboard: true } as const;
        const result = await h.call(command);
        expect(h.execute.mock.calls[0][2]).toEqual(command);
        expect(result.textResultForLlm).not.toContain('Synthetic payload');
    });
    const frames = [
        { id: 'f-main', origin: 'https://fixture.test', name: '', document: 'd-main', status: 'ready' as const, depth: 0 },
        { id: 'f-child', parent: 'f-main', origin: 'opaque', name: 'editor\nlabel', document: 'd-child', status: 'ready' as const, depth: 1 },
    ];
    const frameResult = () => ({
        tab: '1:view', frame: 'f-main', document: 'd-main', frames,
        elements: [{ ...element('e1', 'Host'), frame: 'f-main' }, { ...element('e2', 'Child'), frame: 'f-child' }],
    });
    it('automatically renders committed frame boundaries with unchanged globally unique refs', async () => {
        const h = harness();
        h.execute.mockResolvedValue(frameResult());
        const result = await h.call({ action: 'snapshot' });
        expect(result.textResultForLlm).toContain('[frame f-main | main | origin "https://fixture.test" | ready | document d-main]');
        expect(result.textResultForLlm).toContain('[frame f-child | name "editor label" | origin "opaque" | ready | document d-child]');
        expect(result.textResultForLlm).toContain('e1 button "Host"');
        expect(result.textResultForLlm).toContain('e2 button "Child"');
        expect(result.textResultForLlm).toMatch(/\[\/frame f-child\]\n\[\/frame f-main\]$/);
        h.execute.mockResolvedValue({ ...frameResult(), elements: [] });
        const inventory = await h.call({ action: 'frames' });
        expect(inventory.textResultForLlm).toContain('origin "opaque"');
        expect(inventory.textResultForLlm).not.toContain('e2 button');
    });
    it('rechecks frame policy before publishing or updating the snapshot baseline', async () => {
        let enabled = true;
        const execute = vi.fn<BrowserControlRuntime['execute']>(async () => {
            enabled = false;
            return frameResult();
        });
        const runtime = { getEnabled: () => true, getFramesEnabled: () => enabled, execute };
        const tool = createBrowserTool({ workspaceId: 'w', processId: 'p', runtime, stateStore: new BrowserToolStateStore(dataDir) });
        expect((await tool.handler({ action: 'snapshot' }) as ToolResultObject).error).toBe('Browser frame policy changed during command');
    });
    it('reserves closing markers and explicit incompleteness within the snapshot cap', () => {
        const result = frameResult();
        result.elements = Array.from({ length: 100 }, (_, index) => ({ ...element(`e${index + 1}`, 'x'.repeat(300)), frame: 'f-child' }));
        const output = formatBrowserFrameSnapshot({ ...result, truncated: 'frame-limit; inspected 32 frames' });
        expect(output.length).toBeLessThanOrEqual(BROWSER_SNAPSHOT_CAP);
        expect(output).toContain('[truncated: output-limit;');
        expect(output).toContain('[truncated: frame-limit; inspected 32 frames]');
        expect(output).toContain('[/frame f-child]\n[/frame f-main]');
    });
    it('paginates frame inventories by rendered handles without skipping entries at the output cap', async () => {
        const h = harness();
        const inventory = Array.from({ length: 32 }, (_, i) => ({ ...frames[0], id: `f-${i}`, name: 'n'.repeat(160),
            origin: 'https://' + 'o'.repeat(240), document: 'd'.repeat(240), parent: 'f-parent', depth: 1 }));
        h.execute.mockResolvedValue({ frames: inventory, frame: 'f-main', document: 'd-main', truncated: 'frame-limit' });
        const result = await h.call({ action: 'frames', offset: 32 });
        expect(result.textResultForLlm.length).toBeLessThanOrEqual(BROWSER_SNAPSHOT_CAP);
        const shown = (result.textResultForLlm.match(/\[frame f-/g) ?? []).length;
        expect(shown).toBeGreaterThan(0);
        expect(shown).toBeLessThan(inventory.length);
        expect(result.textResultForLlm).toContain(`frames offset=${32 + shown} to continue`);
        h.execute.mockResolvedValue({ frames: [frames[1]], frame: 'f-main', document: 'd-main' });
        expect((await h.call({ action: 'frames', offset: 255 })).textResultForLlm).not.toContain('offset=');
    });
    it('isolates baselines by document, selected frame and included child generations', async () => {
        const h = harness();
        h.execute.mockResolvedValue(frameResult());
        await h.call({ action: 'snapshot' });
        h.execute.mockResolvedValue({ ...frameResult(), elements: [frameResult().elements[0]] });
        expect((await h.call({ action: 'press', key: 'Enter' })).textResultForLlm).toContain('- [frame f-child] e2');
        h.execute.mockResolvedValue({ ...frameResult(), document: 'd-next' });
        const newDocument = await h.call({ action: 'press', key: 'Enter' });
        expect(newDocument.textResultForLlm).not.toContain('- [frame');
        expect(newDocument.textResultForLlm).toContain('+ [frame f-main] e1');
        h.execute.mockResolvedValue({ ...frameResult(), frame: 'f-child', document: 'd-child' });
        expect((await h.call({ action: 'press', frame: 'f-child', key: 'Enter' })).textResultForLlm).toContain('+ [frame f-child] e2');
        h.execute.mockResolvedValue({ ...frameResult(), frames: [frames[0], { ...frames[1], document: 'd-new-child' }] });
        expect((await h.call({ action: 'press', key: 'Enter' })).textResultForLlm).toContain('+ [frame f-main] e1');
    });
    it('bounds frame reads, preserves nested closing boundaries and advances exactly the consumed text', async () => {
        const h = harness();
        const text = '[frame f-child | origin opaque]\n' + 'x'.repeat(7900) + '\n[/frame f-child]';
        h.execute.mockResolvedValue({ ...frameResult(), text, textTotal: 20_000 });
        const first = await h.call({ action: 'read', frame: 'f-main' });
        expect(first.textResultForLlm.length).toBeLessThanOrEqual(BROWSER_READ_CAP);
        expect(first.textResultForLlm).toContain('[/frame f-child]\n[/frame f-main]');
        const offset = Number(first.textResultForLlm.match(/offset=(\d+)/)![1]);
        const shown = first.textResultForLlm.split('\n').slice(1, 3).join('\n');
        expect(shown).toBe(text.slice(0, offset));
        expect(first.textResultForLlm).toContain('read frame=f-main');
        h.execute.mockResolvedValue({ ...frameResult(), text: 'partial', textTotal: 20_000, truncated: 'node-limit; inspected 20000 nodes' });
        const partial = await h.call({ action: 'read' });
        expect(partial.textResultForLlm).toContain('[truncated: node-limit; inspected 20000 nodes]');
        expect(partial.textResultForLlm).not.toContain('offset=');
    });
    it('includes execution document scope in bounded eval output', async () => {
        const h = harness();
        h.execute.mockResolvedValue({ frame: 'f-child', document: 'd-child', valueJson: 'x'.repeat(4000), valueTruncated: true });
        const result = await h.call({ action: 'eval', frame: 'f-child', js: 'document.title' });
        expect(result.textResultForLlm).toHaveLength(BROWSER_EVAL_CAP);
        expect(result.textResultForLlm).toMatch(/^\[frame f-child \| document d-child\]/);
        expect(result.textResultForLlm).toContain('truncated - return a smaller result');
        h.execute.mockResolvedValue({ frame: 'f-child', document: 'd-child', valueJson: 'x'.repeat(4000), valueTruncated: false });
        expect((await h.call({ action: 'eval', frame: 'f-child', js: '1' })).textResultForLlm).toContain('truncated - return a smaller result');
    });
    it('uses one controlling-turn token across command signals and a fresh token for follow-up factories', async () => {
        const execute = vi.fn<BrowserControlRuntime['execute']>(async () => ({ text: 'fixture', textTotal: 7 }));
        const deps = { workspaceId: 'w', processId: 'p', runtime: { getEnabled: () => true, execute }, stateStore: new BrowserToolStateStore(dataDir) };
        const first = createBrowserTool(deps);
        await first.handler({ action: 'read' }, { ...invocation, signal: new AbortController().signal });
        await first.handler({ action: 'read' }, { ...invocation, signal: new AbortController().signal });
        const next = createBrowserTool(deps);
        await next.handler({ action: 'read' });
        expect(execute.mock.calls[0][5]).toBe(execute.mock.calls[1][5]);
        expect(execute.mock.calls[0][5]).not.toBe(execute.mock.calls[2][5]);
    });
    it('measures one tool description/schema under the fixed 1600-character budget', () => {
        const { tool } = harness();
        expect(tool.name).toBe('browser');
        expect(tool.parameters).toEqual(BROWSER_TOOL_PARAMETERS);
        const chars = JSON.stringify(tool.parameters).length + BROWSER_TOOL_DESCRIPTION.length;
        console.log(`browser description+schema budget: ${chars}/${BROWSER_SCHEMA_CHAR_BUDGET} characters`);
        expect(chars).toBeLessThanOrEqual(BROWSER_SCHEMA_CHAR_BUDGET);
        expect(tool.description).toContain('otherwise never call');
    });

    it('uses owner-bound arguments and inline structured success results', async () => {
        const h = harness();
        const result = await h.call({ action: 'snapshot' });
        expect(result).toEqual({ resultType: 'success', textResultForLlm: 'e1 button "Save"' });
        expect(h.execute).toHaveBeenCalledWith('workspace-a', 'process-a', { action: 'snapshot' }, undefined, undefined, expect.any(String));
    });
    it('formats a snapshot without a selected tab without creating a baseline', async () => {
        const h = harness();
        h.execute.mockResolvedValue({ elements: [element()] });
        expect((await h.call({ action: 'snapshot' })).textResultForLlm).toBe('e1 button "Save"');
        expect((await h.call({ action: 'press', key: 'Enter' })).textResultForLlm).toContain('+ e1 button "Save"');
    });

    it('executes without a browser-mode guard inside the enabled feature', async () => {
        const h = harness();
        expect((await h.call({ action: 'click', ref: 'e1' })).resultType).toBe('success');
        expect(h.execute).toHaveBeenCalledOnce();
    });

    it('rejects disabled feature and invalid parameters before relaying', async () => {
        const h = harness();
        h.runtime.getEnabled = () => false;
        expect((await h.call({ action: 'tabs' })).error).toBe('Browser control is disabled');
        expect(h.execute).not.toHaveBeenCalled();
        const invalid = await h.tool.handler!({ action: 'click' }, invocation) as ToolResultObject;
        expect(invalid.error).toBe('click: ref is required');
    });

    it('caps default/full/subtree snapshots with an actionable expansion ref', () => {
        const elements = Array.from({ length: 500 }, (_, index) => element(`e${index + 1}`, 'Name '.repeat(20)));
        for (const all of [false, true]) {
            const output = formatBrowserSnapshot(elements, all);
            expect(output.length).toBeLessThanOrEqual(BROWSER_SNAPSHOT_CAP);
            expect(output).toMatch(/truncated - snapshot ref=e\d+ to expand$/);
        }
        expect(formatBrowserSnapshot([element('e1', 'x'.repeat(10_000))]).length).toBe(BROWSER_SNAPSHOT_CAP);
    });

    it('keeps one line per element and JSON-escapes names with full-tree indentation', () => {
        expect(formatBrowserSnapshot([{ ...element('e1', 'line\n"quoted"'), depth: 2, checked: true }], true))
            .toBe('    e1 button "line \\"quoted\\"" [checked]');
    });

    it('emits only added/removed changes after actions and updates the next delta baseline', async () => {
        const h = harness();
        await h.call({ action: 'snapshot' });
        h.execute.mockResolvedValue({ tab: '1:view', title: 'Fixture', url: 'https://fixture.test/', elements: [element('e2', 'Done')] });
        const first = await h.call({ action: 'click', ref: 'e1' });
        expect(first.textResultForLlm).toBe('ok · Fixture · https://fixture.test/\n- e1 button "Save"\n+ e2 button "Done"');
        const second = await h.call({ action: 'press', key: 'Enter' });
        expect(second.textResultForLlm).toBe('ok · Fixture · https://fixture.test/');
        expect(second.binaryResultsForLlm).toBeUndefined();
    });

    it.each<BrowserCommand>([
        { action: 'open', url: 'https://fixture.test/' }, { action: 'select', tab: '1:view' },
        { action: 'click', ref: 'e1' }, { action: 'type', ref: 'e1', text: 'new' },
        { action: 'press', key: 'Enter' }, { action: 'navigate', direction: 'reload' },
        { action: 'scroll', direction: 'down' }, { action: 'select_option', ref: 'e1', value: 'a' },
    ])('returns a status/delta only for $action, never a repeated full snapshot or screenshot', async command => {
        const h = harness();
        await h.call({ action: 'snapshot' });
        const result = await h.call(command);
        expect(result.textResultForLlm).toBe('ok · Fixture · https://fixture.test/');
        expect(result.binaryResultsForLlm).toBeUndefined();
        expect(h.execute).toHaveBeenCalledTimes(2);
    });

    it('caps deltas at 40 lines and bounded characters even for huge names/status', async () => {
        const current = new Map(Array.from({ length: 100 }, (_, index) => [`e${index}`, `e${index} button "${'x'.repeat(500)}"`]));
        const delta = formatBrowserDelta(new Map(), current);
        expect(delta.split('\n').length).toBeLessThanOrEqual(BROWSER_DELTA_LINES);
        expect(delta.length).toBeLessThanOrEqual(BROWSER_SNAPSHOT_CAP - 1024);
        expect(delta).toContain('truncated');
        const h = harness();
        h.execute.mockResolvedValue({ title: 'x'.repeat(10_000), url: 'x'.repeat(10_000), tab: '1:view', elements: Array.from({ length: 500 }, (_, index) => element(`e${index + 1}`)) });
        const result = await h.call({ action: 'open', url: 'https://fixture.test/' });
        expect(result.textResultForLlm.length).toBeLessThanOrEqual(BROWSER_SNAPSHOT_CAP);
        expect(result.textResultForLlm.split('\n').length).toBeLessThanOrEqual(BROWSER_DELTA_LINES + 1);
    });

    it('uses the full interactive baseline after expanded or all snapshots', async () => {
        const h = harness();
        h.execute.mockResolvedValue({ tab: '1:view', elements: [element()], interactiveElements: [element(), element('e2', 'Other')] });
        await h.call({ action: 'snapshot', ref: 'e1', all: true });
        h.execute.mockResolvedValue({ tab: '1:view', elements: [element(), element('e2', 'Other')] });
        expect((await h.call({ action: 'click', ref: 'e1' })).textResultForLlm).not.toContain('+');
    });

    it('does not replace snapshot state during waits', async () => {
        const h = harness();
        await h.call({ action: 'snapshot' });
        h.execute.mockResolvedValueOnce({ tab: '1:view' });
        await h.call({ action: 'wait', ms: 0 });
        expect((await h.call({ action: 'press', key: 'Enter' })).textResultForLlm).not.toContain('+');
    });

    it('caps and pages read output without skipping characters, retaining a subtree ref', async () => {
        const h = harness();
        const text = '0123456789'.repeat(2000);
        h.execute.mockImplementation(async (_workspace, _process, command) => {
            const offset = command.offset ?? 0;
            return { text: text.slice(offset, offset + BROWSER_READ_CAP), textTotal: text.length };
        });
        const first = await h.call({ action: 'read', ref: 'e1' });
        expect(first.textResultForLlm.length).toBeLessThanOrEqual(BROWSER_READ_CAP);
        const offset = Number(first.textResultForLlm.match(/offset=(\d+)/)![1]);
        const content = first.textResultForLlm.split('\ntruncated')[0];
        expect(offset).toBe(content.length);
        expect(first.textResultForLlm).toContain('read ref=e1');
        const second = await h.call({ action: 'read', ref: 'e1', offset });
        expect(second.textResultForLlm.startsWith(text.slice(offset, offset + 100))).toBe(true);
    });

    it('accepts transport-paged reads without applying offset twice', async () => {
        const h = harness();
        h.execute.mockResolvedValue({ text: 'second page', textTotal: 8011 });
        expect((await h.call({ action: 'read', offset: 8000 })).textResultForLlm).toBe('second page');
    });

    it('JSON-serializes eval results under 4000 characters with an explicit truncation hint', async () => {
        const h = harness();
        h.execute.mockResolvedValue({ valueJson: JSON.stringify({ value: 'x'.repeat(5000) }).slice(0, BROWSER_EVAL_CAP), valueTruncated: true });
        const result = await h.call({ action: 'eval', js: 'document.title' });
        expect(result.textResultForLlm.length).toBe(BROWSER_EVAL_CAP);
        expect(result.textResultForLlm).toContain('truncated');
        h.execute.mockResolvedValue({ valueJson: 'false', valueTruncated: false });
        expect((await h.call({ action: 'eval', js: 'false' })).textResultForLlm).toBe('false');
    });

    it('formats page-bounded eval JSON once and preserves truncation hints within the cap', async () => {
        const h = harness();
        h.execute.mockResolvedValue({ valueJson: '{"answer":42}', valueTruncated: false });
        expect((await h.call({ action: 'eval', js: '({answer:42})' })).textResultForLlm).toBe('{"answer":42}');
        h.execute.mockResolvedValue({ valueJson: '"' + 'x'.repeat(3999), valueTruncated: true });
        const result = await h.call({ action: 'eval', js: "'x'.repeat(1100000)" });
        expect(result.textResultForLlm).toHaveLength(BROWSER_EVAL_CAP);
        expect(result.textResultForLlm).toMatch(/\ntruncated - return a smaller result$/);
        h.execute.mockResolvedValue({ valueJson: 'x'.repeat(4001), valueTruncated: true });
        expect((await h.call({ action: 'eval', js: '42' })).error).toBe('Browser returned an invalid evaluation result');
        h.execute.mockResolvedValue({ value: 'x'.repeat(1100000) });
        expect((await h.call({ action: 'eval', js: '42' })).error).toBe('Browser returned no evaluation result');
    });

    it('rejects unpaged or oversized read replies instead of applying a late transport cap', async () => {
        const h = harness();
        h.execute.mockResolvedValue({ text: 'unpaged' });
        expect((await h.call({ action: 'read' })).error).toBe('Browser returned an invalid page text result');
        h.execute.mockResolvedValue({ text: 'x'.repeat(8001), textTotal: 1100000 });
        expect((await h.call({ action: 'read' })).error).toBe('Browser returned an invalid page text result');
    });

    it.each(['jpeg', 'png'] as const)('saves %s screenshots atomically with a repo-scoped markdown path, without pixels by default', async format => {
        const h = harness();
        const image = { data: Buffer.from('fixture image').toString('base64'), mimeType: `image/${format}` as const };
        h.execute.mockResolvedValue({ title: 'Chart', url: 'https://fixture.test/', image });
        const result = await h.call({ action: 'screenshot', format });
        const dir = path.join(dataDir, 'repos', 'workspace-a', 'browser-screenshots', 'process-a');
        expect(h.stateStore.screenshotDir('workspace-a', 'process-a')).toBe(dir);
        const files = fs.readdirSync(dir);
        expect(files).toHaveLength(1);
        expect(files[0]).toMatch(new RegExp(`^\\d{8}-\\d{6}-\\d+\\.${format === 'jpeg' ? 'jpg' : 'png'}$`));
        const file = path.join(dir, files[0]);
        expect(fs.readFileSync(file).toString()).toBe('fixture image');
        expect(result).toEqual({
            resultType: 'success',
            textResultForLlm: `ok · Chart · https://fixture.test/\nsaved: ![screenshot](<${file.replace(/\\/g, '/')}>)`,
        });
        expect(result.binaryResultsForLlm).toBeUndefined();
        const again = await h.call({ action: 'screenshot', format, view: false });
        expect(again.binaryResultsForLlm).toBeUndefined();
        expect(fs.readdirSync(dir)).toHaveLength(2);
    });

    it.each(['image/jpeg', 'image/png'] as const)('attaches %s pixels only with view true and also saves the file', async mimeType => {
        const h = harness();
        h.execute.mockResolvedValue({ image: { data: 'anBlZw==', mimeType } });
        const result = await h.call({ action: 'screenshot', view: true });
        expect(result.binaryResultsForLlm).toEqual([{ type: 'image', data: 'anBlZw==', mimeType, description: 'Browser screenshot' }]);
        expect(result.textResultForLlm).toContain('saved: ![screenshot](<');
        expect(fs.readdirSync(h.stateStore.screenshotDir('workspace-a', 'process-a'))).toHaveLength(1);
    });

    it('rejects missing screenshots and unsupported MIME types without creating files', async () => {
        const h = harness();
        h.execute.mockResolvedValue({});
        expect((await h.call({ action: 'screenshot' })).error).toBe('Browser returned no screenshot');
        h.execute.mockResolvedValue(JSON.parse('{"image":{"data":"anBlZw==","mimeType":"image/gif"}}'));
        expect((await h.call({ action: 'screenshot' })).error).toBe('Browser returned no screenshot');
        expect(fs.existsSync(h.stateStore.screenshotDir('workspace-a', 'process-a'))).toBe(false);
    });

    it('reports write failure without a saved path or pixel result', async () => {
        const h = harness();
        fs.writeFileSync(path.join(dataDir, 'repos'), 'not a directory');
        h.execute.mockResolvedValue({ image: { data: 'anBlZw==', mimeType: 'image/jpeg' } });
        const result = await h.call({ action: 'screenshot', view: true });
        expect(result.resultType).toBe('failure');
        expect(result.error).toContain('Failed to save browser screenshot:');
        expect(result.textResultForLlm).not.toContain('saved:');
        expect(result.binaryResultsForLlm).toBeUndefined();
    });

    it('cleans the temporary file when atomic rename fails', async () => {
        const h = harness();
        h.execute.mockResolvedValue({ image: { data: 'anBlZw==', mimeType: 'image/jpeg' } });
        vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('rename denied'); });
        const result = await h.call({ action: 'screenshot' });
        expect(result.error).toBe('Failed to save browser screenshot: rename denied');
        expect(fs.readdirSync(h.stateStore.screenshotDir('workspace-a', 'process-a'))).toEqual([]);
    });

    it('preserves saved captures when a fresh store writes in the same second', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
            const image = { data: 'anBlZw==', mimeType: 'image/jpeg' as const };
            const first = new BrowserToolStateStore(dataDir).saveScreenshot('workspace-a', 'process-a', image);
            const second = new BrowserToolStateStore(dataDir).saveScreenshot('workspace-a', 'process-a', image);
            expect(first).not.toBe(second);
            expect(fs.readFileSync(first).toString()).toBe('jpeg');
            expect(fs.readFileSync(second).toString()).toBe('jpeg');
        } finally {
            vi.useRealTimers();
        }
    });

    it('returns an absolute angle-bracket path when the configured data directory contains spaces', async () => {
        const h = harness(new BrowserToolStateStore(path.join(dataDir, 'data with spaces')));
        h.execute.mockResolvedValue({ image: { data: 'anBlZw==', mimeType: 'image/png' } });
        const result = await h.call({ action: 'screenshot', format: 'png' });
        const file = result.textResultForLlm.match(/!\[screenshot\]\(<(.+)>\)/)![1];
        expect(path.isAbsolute(file)).toBe(true);
        expect(file).toContain('data with spaces');
        expect(fs.readFileSync(file).toString()).toBe('jpeg');
    });

    it('does not write a screenshot when aborted after capture', async () => {
        const h = harness();
        const controller = new AbortController();
        h.execute.mockImplementation(async () => {
            controller.abort(new Error('Turn stopped'));
            return { image: { data: 'anBlZw==', mimeType: 'image/jpeg' } };
        });
        const result = await h.tool.handler({ action: 'screenshot' }, { ...invocation, signal: controller.signal }) as ToolResultObject;
        expect(result.error).toBe('Turn stopped');
        expect(fs.existsSync(h.stateStore.screenshotDir('workspace-a', 'process-a'))).toBe(false);
    });

    it('deletes only the owning process screenshots and prevents late captures from recreating them', async () => {
        const store = new BrowserToolStateStore(dataDir);
        const image = { data: 'anBlZw==', mimeType: 'image/jpeg' as const };
        const file = store.saveScreenshot('workspace-a', 'process-a', image);
        const otherProcess = store.saveScreenshot('workspace-a', 'process-b', image);
        const otherWorkspace = store.saveScreenshot('workspace-b', 'process-a', image);
        const h = harness(store);
        h.execute.mockImplementation(async () => {
            store.delete('workspace-a', 'process-a');
            return { image };
        });
        expect((await h.call({ action: 'screenshot' })).error).toBe('Browser process was removed');
        expect(fs.existsSync(file)).toBe(false);
        expect(fs.existsSync(path.dirname(file))).toBe(false);
        expect(fs.existsSync(otherProcess)).toBe(true);
        expect(fs.existsSync(otherWorkspace)).toBe(true);
    });

    it('retains selected tabs and snapshot state across tool factories but never crosses workspace/process', async () => {
        const store = new BrowserToolStateStore(dataDir);
        const first = harness(store);
        await first.call({ action: 'select', tab: '1:view' });
        const resumed = harness(store);
        await resumed.call({ action: 'snapshot' });
        expect(resumed.execute.mock.calls[0][3]).toBe('1:view');
        for (const h of [harness(store, 'workspace-b'), harness(store, 'workspace-a', 'process-b')]) {
            await h.call({ action: 'snapshot' });
            expect(h.execute.mock.calls[0][3]).toBeUndefined();
        }
        store.delete('workspace-a', 'process-a');
        const cleared = harness(store);
        await cleared.call({ action: 'snapshot' });
        expect(cleared.execute.mock.calls[0][3]).toBeUndefined();
    });

    it('lists selected owner-qualified tabs compactly, never emits automatic screenshots', async () => {
        const h = harness();
        await h.call({ action: 'select', tab: '1:view' });
        h.execute.mockResolvedValue({ tabs: [{ id: '1:view', title: 'Fixture', url: 'https://fixture.test/', engine: 'electron' }] });
        expect((await h.call({ action: 'tabs' })).textResultForLlm).toBe('1:view * "Fixture" · https://fixture.test/ · electron');
        expect(h.execute.mock.calls.every(call => call[2].action !== 'screenshot')).toBe(true);
    });

    it('surfaces stale refs and relay errors without pretending success', async () => {
        const h = harness();
        h.execute.mockRejectedValue(new Error('stale ref, re-snapshot'));
        expect(await h.call({ action: 'click', ref: 'e1' })).toEqual({
            resultType: 'failure', textResultForLlm: 'stale ref, re-snapshot', error: 'stale ref, re-snapshot',
        });

    });

    it.each<BrowserCommand>([
        { action: 'tabs' }, { action: 'snapshot' }, { action: 'read' }, { action: 'eval', js: '1' },
    ])('rejects malformed relay payloads for $action instead of empty success', async command => {
        const h = harness();
        h.execute.mockResolvedValue({});
        expect((await h.call(command)).resultType).toBe('failure');
    });

    it('combines invocation and turn abort signals and does not dispatch an already stopped turn', async () => {
        const h = harness();
        const controller = new AbortController();
        const tool = createBrowserTool({ workspaceId: 'workspace-a', processId: 'process-a', runtime: h.runtime, stateStore: h.stateStore, signal: controller.signal });
        controller.abort(new Error('Turn stopped'));
        const result = await tool.handler!({ action: 'tabs' }, invocation) as ToolResultObject;
        expect(result.error).toBe('Turn stopped');
        expect(h.execute).not.toHaveBeenCalled();
    });

    it('serializes selection and following commands within one conversation', async () => {
        const h = harness();
        let release!: (value: { tab: string; elements: BrowserControlElement[] }) => void;
        h.execute.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const selected = h.call({ action: 'select', tab: '2:view' });
        const following = h.call({ action: 'click', ref: 'e1' });
        await vi.waitFor(() => expect(h.execute).toHaveBeenCalledOnce());
        release({ tab: '2:view', elements: [] });
        await Promise.all([selected, following]);
        expect(h.execute.mock.calls[1][3]).toBe('2:view');
    });
});
