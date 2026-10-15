import { defineTool, type Tool, type ToolResultObject } from '@plusplusoneplusplus/coc-agent-sdk';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRepoDataPath } from '../paths';
import { getServerLogger } from '../logging/server-logger';
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
    deleted?: boolean;
}

/** Plain owner-qualified conversation data, shared across turns, never provider sessions. */
export class BrowserToolStateStore {
    private readonly states = new Map<string, BrowserToolState>();
    private screenshotSequence = 0;

    constructor(private readonly dataDir: string) {}

    screenshotDir(workspaceId: string, processId: string): string {
        if (!processId || processId === '.' || processId === '..' || /[/\\]/.test(processId)) {
            throw new Error('Invalid browser screenshot process ID');
        }
        return path.resolve(getRepoDataPath(this.dataDir, workspaceId, 'browser-screenshots'), processId);
    }

    saveScreenshot(workspaceId: string, processId: string, image: NonNullable<BrowserCommandResult['image']>): string {
        const dir = this.screenshotDir(workspaceId, processId);
        const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
        const extension = image.mimeType === 'image/png' ? 'png' : 'jpg';
        let file: string;
        do {
            file = path.join(dir, `${timestamp}-${++this.screenshotSequence}.${extension}`);
        } while (fs.existsSync(file));
        const temp = `${file}.${randomUUID()}.tmp`;
        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(temp, Buffer.from(image.data, 'base64'), { flag: 'wx' });
            fs.renameSync(temp, file);
        } catch (error) {
            throw new Error(`Failed to save browser screenshot: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            try {
                fs.rmSync(temp, { force: true });
            } catch (error) {
                getServerLogger().warn({ err: error }, 'Failed to remove browser screenshot temporary file');
            }
        }
        return file;
    }

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
        const key = JSON.stringify([workspaceId, processId]);
        const state = this.states.get(key);
        if (state) state.deleted = true;
        this.states.delete(key);
        try {
            fs.rmSync(this.screenshotDir(workspaceId, processId), { recursive: true, force: true });
        } catch (error) {
            getServerLogger().warn({ err: error, workspaceId, processId }, 'Failed to remove browser screenshots');
        }
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
    const turnId = randomUUID();
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
                    if (state.deleted) throw new Error('Browser process was removed');
                    const result = await deps.runtime.execute(deps.workspaceId, deps.processId, command, state.selectedTab, signal, turnId);
                    signal?.throwIfAborted();
                    if (state.deleted) throw new Error('Browser process was removed');
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
                        const total = result.textTotal;
                        if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0 || text.length > BROWSER_READ_CAP) throw new Error('Browser returned an invalid page text result');
                        const hint = `\ntruncated - read${command.ref ? ` ref=${command.ref}` : ''} offset=${offset + BROWSER_READ_CAP - 80} to continue`;
                        const contentCap = BROWSER_READ_CAP - 80;
                        const content = text.slice(0, contentCap);
                        return success(content + (offset + content.length < total ? hint : ''));
                    }
                    if (command.action === 'eval') {
                        if (typeof result.valueJson !== 'string') throw new Error('Browser returned no evaluation result');
                        if (result.valueJson.length > BROWSER_EVAL_CAP || typeof result.valueTruncated !== 'boolean') throw new Error('Browser returned an invalid evaluation result');
                        const hint = '\ntruncated - return a smaller result';
                        return success(result.valueTruncated ? result.valueJson.slice(0, BROWSER_EVAL_CAP - hint.length) + hint : result.valueJson);
                    }
                    if (command.action === 'screenshot') {
                        if (!result.image?.data || !['image/jpeg', 'image/png'].includes(result.image.mimeType)) throw new Error('Browser returned no screenshot');
                        const file = deps.stateStore.saveScreenshot(deps.workspaceId, deps.processId, result.image);
                        const response = success(`${status(result)}\nsaved: ![screenshot](<${file.replace(/\\/g, '/')}>)`);
                        if (command.view === true) {
                            response.binaryResultsForLlm = [{ type: 'image', data: result.image.data, mimeType: result.image.mimeType, description: 'Browser screenshot' }];
                        }
                        return response;
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
