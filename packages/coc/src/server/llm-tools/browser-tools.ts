import { defineTool, type Tool, type ToolResultObject } from '@plusplusoneplusplus/coc-agent-sdk';
import {
    BROWSER_TOOL_DESCRIPTION, BROWSER_TOOL_PARAMETERS, parseBrowserCommand,
    type BrowserCommand, type BrowserCommandResult, type BrowserControlElement, type BrowserControlRuntime,
} from '@plusplusoneplusplus/coc-client';

export { BROWSER_TOOL_DESCRIPTION, BROWSER_SCHEMA_CHAR_BUDGET } from '@plusplusoneplusplus/coc-client';
export const BROWSER_SNAPSHOT_CAP = 6000;
export const BROWSER_READ_CAP = 8000;
export const BROWSER_EVAL_CAP = 4000;
export const BROWSER_DELTA_LINES = 40;

interface BrowserToolState {
    selectedTab?: string;
    snapshots: Map<string, Map<string, string>>;
    tail: Promise<void>;
}

/** Plain owner-qualified conversation data, shared across turns, never provider sessions. */
export class BrowserToolStateStore {
    private readonly states = new Map<string, BrowserToolState>();

    run<T>(workspaceId: string, processId: string, operation: (state: BrowserToolState) => Promise<T>): Promise<T> {
        const key = JSON.stringify([workspaceId, processId]);
        let state = this.states.get(key);
        if (!state) {
            state = { snapshots: new Map(), tail: Promise.resolve() };
            this.states.set(key, state);
        }
        const current = state;
        const result = current.tail.then(() => operation(current));
        current.tail = result.then(() => {}, () => {});
        return result;
    }

    delete(workspaceId: string, processId: string): void {
        this.states.delete(JSON.stringify([workspaceId, processId]));
    }
}

export interface BrowserToolDeps {
    workspaceId: string;
    processId: string;
    runtime: BrowserControlRuntime;
    stateStore: BrowserToolStateStore;
    signal?: AbortSignal;
}

const clean = (text: string) => text.replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
const bounded = (text: string, cap: number, hint: string) => text.length <= cap ? text : text.slice(0, cap - hint.length) + hint;
const line = (element: BrowserControlElement) =>
    `${element.ref} ${element.role} ${JSON.stringify(clean(element.name))}${element.checked === undefined ? '' : element.checked ? ' [checked]' : ' [unchecked]'}`;

export function formatBrowserSnapshot(elements: BrowserControlElement[], all = false): string {
    const lines: string[] = [];
    let length = 0;
    for (const element of elements) {
        const text = `${all ? '  '.repeat(Math.min(element.depth, 8)) : ''}${line(element)}`;
        const hint = `\ntruncated - snapshot ref=${element.ref} to expand`;
        if (length + text.length + (lines.length ? 1 : 0) + hint.length > BROWSER_SNAPSHOT_CAP) {
            return [...lines, text].join('\n').slice(0, BROWSER_SNAPSHOT_CAP - hint.length) + hint;
        }
        lines.push(text);
        length += text.length + (lines.length > 1 ? 1 : 0);
    }
    return lines.join('\n') || '(no matching elements)';
}

function elementMap(elements: BrowserControlElement[]): Map<string, string> {
    return new Map(elements.map(element => [element.ref, line(element)]));
}

export function formatBrowserDelta(previous: Map<string, string>, current: Map<string, string>): string {
    const changes: string[] = [];
    for (const [ref, text] of previous) if (current.get(ref) !== text) changes.push(`- ${text}`);
    for (const [ref, text] of current) if (previous.get(ref) !== text) changes.push(`+ ${text}`);
    const shown = changes.slice(0, BROWSER_DELTA_LINES);
    if (changes.length > BROWSER_DELTA_LINES) shown[shown.length - 1] = 'truncated - snapshot to inspect remaining changes';
    return bounded(shown.join('\n'), BROWSER_SNAPSHOT_CAP - 1024, '\ntruncated - snapshot to inspect remaining changes');
}

function status(result: BrowserCommandResult): string {
    return `ok · ${clean(result.title ?? '').slice(0, 160)} · ${clean(result.url ?? '').slice(0, 800)}`;
}

function success(textResultForLlm: string): ToolResultObject {
    return { resultType: 'success', textResultForLlm };
}

export function createBrowserTool(deps: BrowserToolDeps): Tool<BrowserCommand> {
    return defineTool<BrowserCommand>('browser', {
        description: BROWSER_TOOL_DESCRIPTION,
        parameters: BROWSER_TOOL_PARAMETERS,
        handler: async (raw, invocation): Promise<ToolResultObject> => {
            try {
                const command = { ...parseBrowserCommand(raw) };
                const signals = [deps.signal, invocation?.signal].filter((signal): signal is AbortSignal => !!signal);
                const signal = signals.length ? AbortSignal.any(signals) : undefined;
                signal?.throwIfAborted();
                if (!deps.runtime.getEnabled()) throw new Error('Browser control is disabled');
                return await deps.stateStore.run(deps.workspaceId, deps.processId, async state => {
                    signal?.throwIfAborted();
                    const result = await deps.runtime.execute(deps.workspaceId, deps.processId, command, state.selectedTab, signal);
                    signal?.throwIfAborted();
                    if (result.tab) state.selectedTab = result.tab;
                    const tab = result.tab ?? state.selectedTab;
                    if (command.action === 'tabs') {
                        if (!Array.isArray(result.tabs)) throw new Error('Browser returned no tab list');
                        return success(bounded(result.tabs.map(tab =>
                            `${tab.id}${tab.id === state.selectedTab ? ' *' : ''} ${JSON.stringify(clean(tab.title))} · ${clean(tab.url)} · ${tab.engine}`,
                        ).join('\n') || '(no URL tabs)', BROWSER_SNAPSHOT_CAP, '\ntruncated - select a tab'));
                    }
                    if (command.action === 'read') {
                        if (typeof result.text !== 'string') throw new Error('Browser returned no page text');
                        const offset = command.offset ?? 0;
                        const text = result.text;
                        const total = result.textTotal ?? text.length;
                        const hint = `\ntruncated - read${command.ref ? ` ref=${command.ref}` : ''} offset=${offset + BROWSER_READ_CAP - 80} to continue`;
                        const contentCap = BROWSER_READ_CAP - 80;
                        const content = result.textTotal === undefined ? text.slice(offset, offset + contentCap) : text.slice(0, contentCap);
                        return success(content + (offset + content.length < total ? hint : ''));
                    }
                    if (command.action === 'eval') {
                        if (!Object.prototype.hasOwnProperty.call(result, 'value')) throw new Error('Browser returned no evaluation result');
                        const json = JSON.stringify(result.value ?? null);
                        return success(bounded(json, BROWSER_EVAL_CAP, '\ntruncated - return a smaller result'));
                    }
                    if (command.action === 'screenshot') {
                        if (!result.image?.data || result.image.mimeType !== 'image/jpeg') throw new Error('Browser returned no screenshot');
                        return {
                            ...success(status(result)),
                            binaryResultsForLlm: [{ type: 'image', data: result.image.data, mimeType: result.image.mimeType, description: 'Browser screenshot' }],
                        };
                    }
                    if (command.action === 'wait') return success(status(result));
                    if (!Array.isArray(result.elements)) throw new Error('Browser returned no snapshot');
                    const current = elementMap(result.interactiveElements ?? result.elements ?? []);
                    const previous = tab ? state.snapshots.get(tab) ?? new Map<string, string>() : new Map<string, string>();
                    if (tab) state.snapshots.set(tab, current);
                    if (command.action === 'snapshot') return success(formatBrowserSnapshot(result.elements ?? [], command.all));
                    const delta = formatBrowserDelta(previous, current);
                    return success(status(result) + (delta ? `\n${delta}` : ''));
                });
            } catch (error) {
                const message = bounded(error instanceof Error ? error.message : String(error), BROWSER_EVAL_CAP, '\ntruncated error');
                return { resultType: 'failure', textResultForLlm: message, error: message };
            }
        },
    });
}
