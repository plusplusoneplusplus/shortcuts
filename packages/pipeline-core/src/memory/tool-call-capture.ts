/**
 * Tool Call Capture
 *
 * Passive event listener that observes tool execution lifecycle events
 * (ToolEvent) and persists Q&A pairs to the ToolCallCacheStore.
 * Normalizes raw tool arguments into human-readable question strings.
 * Non-blocking: capture errors are logged but never propagated.
 */

import { ToolCallCacheStore, ToolCallFilter, ToolCallQAEntry } from './tool-call-cache-types';
import { ToolEvent } from '../copilot-sdk-wrapper/types';
import { getLogger, LogCategory } from '../logger';

export interface ToolCallCaptureOptions {
    /** Stable hash of the repository root. Used to tag entries. */
    repoHash?: string;
    /** Stable hash of the git remote URL. Used to tag entries. */
    remoteHash?: string;
    /** Current git HEAD hash. Used for cache invalidation. */
    gitHash?: string;
    /** If true, also capture tool-failed events (default: false). */
    captureFailures?: boolean;
}

export class ToolCallCapture {
    private readonly store: ToolCallCacheStore;
    private readonly filter: ToolCallFilter;
    private readonly options: ToolCallCaptureOptions;
    /** In-flight tool calls: toolCallId → { toolName, args } */
    private readonly pending: Map<string, { toolName: string; args: Record<string, unknown> }>;
    private _capturedCount: number;

    constructor(
        store: ToolCallCacheStore,
        filter: ToolCallFilter,
        options?: ToolCallCaptureOptions,
    ) {
        this.store = store;
        this.filter = filter;
        this.options = options ?? {};
        this.pending = new Map();
        this._capturedCount = 0;
    }

    /** Number of Q&A entries successfully written. */
    get capturedCount(): number {
        return this._capturedCount;
    }

    /**
     * Returns a callback compatible with `SendMessageOptions.onToolEvent`.
     * Usage: `sendMessage({ onToolEvent: capture.createToolEventHandler() })`
     */
    createToolEventHandler(): (event: ToolEvent) => void {
        return (event: ToolEvent) => {
            try {
                switch (event.type) {
                    case 'tool-start':
                        this.handleToolStart(event);
                        break;
                    case 'tool-complete':
                        this.handleToolComplete(event);
                        break;
                    case 'tool-failed':
                        this.handleToolFailed(event);
                        break;
                }
            } catch (err) {
                getLogger().warn(LogCategory.Memory, `ToolCallCapture: error handling ${event.type} for ${event.toolName ?? '?'}: ${err}`);
            }
        };
    }

    /**
     * Convert raw tool arguments into a human-readable question string.
     */
    normalizeToolArgs(toolName: string, args: Record<string, unknown>): string {
        switch (toolName) {
            case 'grep': {
                const pattern = String(args.pattern ?? '');
                const path = args.path ? ` in ${args.path}` : '';
                return `Search for '${pattern}'${path}`;
            }
            case 'view': {
                const filePath = String(args.path ?? '');
                const range = args.view_range;
                if (Array.isArray(range) && range.length === 2) {
                    return `View file ${filePath} lines ${range[0]}-${range[1]}`;
                }
                return `View file ${filePath}`;
            }
            case 'glob': {
                const pattern = String(args.pattern ?? '');
                const path = args.path ? ` in ${args.path}` : '';
                return `Find files matching ${pattern}${path}`;
            }
            case 'task': {
                const prompt = String(args.prompt ?? '');
                const agentType = args.agent_type ? ` (${args.agent_type})` : '';
                const truncated = prompt.length > 200 ? prompt.substring(0, 200) + '...' : prompt;
                return truncated || `Task${agentType}`;
            }
            case 'web_search': {
                return String(args.query ?? 'Web search');
            }
            case 'web_fetch': {
                return `Fetch ${String(args.url ?? 'URL')}`;
            }
            case 'powershell': {
                const cmd = String(args.command ?? '');
                const truncated = cmd.length > 150 ? cmd.substring(0, 150) + '...' : cmd;
                return `Run command: ${truncated}`;
            }
            case 'edit': {
                const filePath = String(args.path ?? '');
                return `Edit file ${filePath}`;
            }
            case 'create': {
                const filePath = String(args.path ?? '');
                return `Create file ${filePath}`;
            }
            default: {
                const argsStr = JSON.stringify(args);
                const truncated = argsStr.length > 150 ? argsStr.substring(0, 150) + '...' : argsStr;
                return `${toolName}: ${truncated}`;
            }
        }
    }

    private handleToolStart(event: ToolEvent): void {
        if (!event.toolName) return;
        this.pending.set(event.toolCallId, {
            toolName: event.toolName,
            args: event.parameters ?? {},
        });
    }

    private handleToolComplete(event: ToolEvent): void {
        const pendingEntry = this.pending.get(event.toolCallId);
        this.pending.delete(event.toolCallId);

        if (!pendingEntry) {
            getLogger().debug(LogCategory.Memory, `ToolCallCapture: no pending tool-start for ${event.toolCallId}, skipping`);
            return;
        }

        const { toolName, args } = pendingEntry;

        if (!this.filter(toolName, args)) return;

        const question = this.normalizeToolArgs(toolName, args);
        const entry: ToolCallQAEntry = {
            id: event.toolCallId,
            toolName,
            question,
            answer: event.result ?? '',
            args,
            gitHash: this.options.gitHash,
            timestamp: new Date().toISOString(),
            parentToolCallId: event.parentToolCallId,
        };

        this.store.writeRaw(entry).then(
            () => { this._capturedCount++; },
            (err) => { getLogger().warn(LogCategory.Memory, `ToolCallCapture: failed to write entry ${event.toolCallId}: ${err}`); },
        );
    }

    private handleToolFailed(event: ToolEvent): void {
        const pendingEntry = this.pending.get(event.toolCallId);
        this.pending.delete(event.toolCallId);

        if (!this.options.captureFailures || !pendingEntry) return;

        const { toolName, args } = pendingEntry;
        if (!this.filter(toolName, args)) return;

        const question = this.normalizeToolArgs(toolName, args);
        const entry: ToolCallQAEntry = {
            id: event.toolCallId,
            toolName,
            question,
            answer: `[ERROR] ${event.error ?? 'Unknown error'}`,
            args,
            gitHash: this.options.gitHash,
            timestamp: new Date().toISOString(),
            parentToolCallId: event.parentToolCallId,
        };

        this.store.writeRaw(entry).then(
            () => { this._capturedCount++; },
            (err) => { getLogger().warn(LogCategory.Memory, `ToolCallCapture: failed to write failed entry ${event.toolCallId}: ${err}`); },
        );
    }
}
