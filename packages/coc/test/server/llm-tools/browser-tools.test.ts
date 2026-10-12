import { describe, expect, it, vi } from 'vitest';
import type { BrowserCommand, BrowserControlElement, BrowserControlRuntime } from '@plusplusoneplusplus/coc-client';
import { BROWSER_TOOL_PARAMETERS } from '@plusplusoneplusplus/coc-client';
import type { ToolResultObject } from '@plusplusoneplusplus/coc-agent-sdk';
import {
    BROWSER_DELTA_LINES, BROWSER_EVAL_CAP, BROWSER_READ_CAP, BROWSER_SCHEMA_CHAR_BUDGET, BROWSER_SNAPSHOT_CAP,
    BROWSER_TOOL_DESCRIPTION, BrowserToolStateStore, createBrowserTool, formatBrowserDelta, formatBrowserSnapshot,
} from '../../../src/server/llm-tools/browser-tools';

const invocation = { toolName: 'browser', toolCallId: 'call', sessionId: 'session', arguments: {} };
const element = (ref = 'e1', name = 'Save'): BrowserControlElement => ({ ref, name, role: 'button', depth: 0 });
function harness(stateStore = new BrowserToolStateStore(), workspaceId = 'workspace-a', processId = 'process-a') {
    const execute = vi.fn<BrowserControlRuntime['execute']>(async () => ({
        tab: '1:view', title: 'Fixture', url: 'https://fixture.test/', elements: [element()],
    }));
    const runtime = { getEnabled: () => true, execute };
    const tool = createBrowserTool({ workspaceId, processId, runtime, stateStore });
    const call = async (command: BrowserCommand) => await tool.handler!(command, invocation) as ToolResultObject;
    return { tool, call, execute, runtime, stateStore };
}

describe('compact browser tool', () => {
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
        expect(h.execute).toHaveBeenCalledWith('workspace-a', 'process-a', { action: 'snapshot' }, undefined, undefined);
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
        h.execute.mockResolvedValue({ text });
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
        h.execute.mockResolvedValue({ value: { value: 'x'.repeat(5000) } });
        const result = await h.call({ action: 'eval', js: 'document.title' });
        expect(result.textResultForLlm.length).toBe(BROWSER_EVAL_CAP);
        expect(result.textResultForLlm).toContain('truncated');
        h.execute.mockResolvedValue({ value: false });
        expect((await h.call({ action: 'eval', js: 'false' })).textResultForLlm).toBe('false');
    });

    it('returns screenshots only inline through binaryResultsForLlm without file references', async () => {
        const h = harness();
        h.execute.mockResolvedValue({ image: { data: 'anBlZw==', mimeType: 'image/jpeg' } });
        const result = await h.call({ action: 'screenshot' });
        expect(result.binaryResultsForLlm).toEqual([{ type: 'image', data: 'anBlZw==', mimeType: 'image/jpeg', description: 'Browser screenshot' }]);
        expect(JSON.stringify(result)).not.toMatch(/file:|\/tmp\/|screenshot\.jpg/);
        h.execute.mockResolvedValue({});
        expect((await h.call({ action: 'screenshot' })).error).toBe('Browser returned no screenshot');
    });

    it('retains selected tabs and snapshot state across tool factories but never crosses workspace/process', async () => {
        const store = new BrowserToolStateStore();
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
