/**
 * SessionTelemetry — token usage accumulation and tool-call tracking.
 *
 * Pure data accumulator. No async, no I/O, no timers.
 */

import type { ToolCall } from './tool-call';
import type { TokenUsage, ToolEvent } from './types';
import { tryConvertImageFileToDataUrl } from './image-converter';

// ============================================================================
// Types
// ============================================================================

/** Active tool call tracking entry. */
export interface ActiveToolCall {
    toolName: string;
    startTime: number;
}

// ============================================================================
// SessionTelemetry
// ============================================================================

export class SessionTelemetry {
    // ── Token usage accumulators ─────────────────────────────────────────────
    private usageInputTokens = 0;
    private usageOutputTokens = 0;
    private usageCacheReadTokens = 0;
    private usageCacheWriteTokens = 0;
    private usageCost: number | undefined;
    private usageDuration: number | undefined;
    private usageTurnCount = 0;
    private usageTokenLimit: number | undefined;
    private usageCurrentTokens: number | undefined;

    // ── Tool call tracking ──────────────────────────────────────────────────
    readonly activeToolCalls = new Map<string, ActiveToolCall>();
    readonly toolCallsMap: Map<string, ToolCall>;

    // ── Response accumulation ───────────────────────────────────────────────
    response = '';
    readonly allMessages: string[] = [];
    turnCount = 0;

    constructor(toolCallsMap?: Map<string, ToolCall>) {
        this.toolCallsMap = toolCallsMap ?? new Map<string, ToolCall>();
    }

    // ── Token usage ─────────────────────────────────────────────────────────

    recordUsage(data: {
        inputTokens?: number;
        outputTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        cost?: number;
        duration?: number;
    }): void {
        this.usageTurnCount++;
        this.usageInputTokens      += data.inputTokens      ?? 0;
        this.usageOutputTokens     += data.outputTokens     ?? 0;
        this.usageCacheReadTokens  += data.cacheReadTokens  ?? 0;
        this.usageCacheWriteTokens += data.cacheWriteTokens ?? 0;
        if (data.cost != null)     { this.usageCost     = (this.usageCost     ?? 0) + data.cost; }
        if (data.duration != null) { this.usageDuration = (this.usageDuration ?? 0) + data.duration; }
    }

    recordUsageInfo(data: {
        tokenLimit?: number;
        currentTokens?: number;
    }): void {
        if (data.tokenLimit    != null) { this.usageTokenLimit    = data.tokenLimit; }
        if (data.currentTokens != null) { this.usageCurrentTokens = data.currentTokens; }
    }

    buildTokenUsage(): TokenUsage | undefined {
        if (this.usageTurnCount === 0) { return undefined; }
        return {
            inputTokens: this.usageInputTokens,
            outputTokens: this.usageOutputTokens,
            cacheReadTokens: this.usageCacheReadTokens,
            cacheWriteTokens: this.usageCacheWriteTokens,
            totalTokens: this.usageInputTokens + this.usageOutputTokens,
            cost: this.usageCost,
            duration: this.usageDuration,
            turnCount: this.usageTurnCount,
            tokenLimit: this.usageTokenLimit,
            currentTokens: this.usageCurrentTokens,
        };
    }

    // ── Tool call tracking ──────────────────────────────────────────────────

    /**
     * Record a tool execution start event.
     * @returns The created ToolCall record and the tool event to emit.
     */
    recordToolStart(data: {
        toolCallId?: string;
        toolName?: string;
        parentToolCallId?: string;
        arguments?: unknown;
    }): { toolCall: ToolCall; event: ToolEvent } {
        const toolCallId       = data.toolCallId       || '(unknown)';
        const toolName         = data.toolName         || '(unknown)';
        const parentToolCallId = data.parentToolCallId;

        this.activeToolCalls.set(toolCallId, { toolName, startTime: Date.now() });

        const toolCall: ToolCall = {
            id:        toolCallId !== '(unknown)' ? toolCallId : `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name:      toolName   !== '(unknown)' ? toolName   : 'unknown',
            status:    'running',
            startTime: new Date(),
            args:      (data.arguments ?? {}) as Record<string, unknown>,
            ...(parentToolCallId ? { parentToolCallId } : {}),
        };
        this.toolCallsMap.set(toolCall.id, toolCall);

        return {
            toolCall,
            event: {
                type:              'tool-start',
                toolCallId:        toolCall.id,
                toolName:          toolCall.name,
                parentToolCallId:  toolCall.parentToolCallId,
                parameters:        toolCall.args,
            },
        };
    }

    /**
     * Record a tool execution complete event.
     * @returns The tool event to emit.
     */
    recordToolComplete(data: {
        toolCallId?: string;
        success?: boolean;
        result?: { content?: string };
        error?: { message?: string; code?: string };
        parentToolCallId?: string;
    }): { event: ToolEvent; tracked?: ActiveToolCall; durationMs?: number } {
        const toolCallId = data.toolCallId || '(unknown)';
        const tracked    = this.activeToolCalls.get(toolCallId);
        const durationMs = tracked ? Date.now() - tracked.startTime : undefined;
        this.activeToolCalls.delete(toolCallId);

        const capturedTool = this.toolCallsMap.get(toolCallId);
        let resultContent  = data.result?.content;

        if (capturedTool) {
            capturedTool.status  = data.success ? 'completed' : 'failed';
            capturedTool.endTime = new Date();
            if (data.success) {
                // For the `view` tool on image files, replace the plain-text result
                // with a base64 data URL so the dashboard can render it inline.
                if (tracked?.toolName === 'view') {
                    const filePath = capturedTool.args?.path as string | undefined;
                    if (filePath) {
                        const dataUrl = tryConvertImageFileToDataUrl(filePath);
                        if (dataUrl) { resultContent = dataUrl; }
                    }
                }
                capturedTool.result = resultContent;
            } else {
                capturedTool.error = data.error?.message || 'Unknown error';
            }
        } else {
            // Orphaned complete event — tool started outside the observation window.
            this.toolCallsMap.set(toolCallId, {
                id:        toolCallId,
                name:      tracked?.toolName || 'unknown',
                status:    'failed',
                startTime: new Date(tracked?.startTime ?? Date.now()),
                endTime:   new Date(),
                args:      {},
                ...(data.parentToolCallId ? { parentToolCallId: data.parentToolCallId } : {}),
                error:     'Started outside observation window',
            });
        }

        const completeParentId = data.parentToolCallId || capturedTool?.parentToolCallId;

        if (data.success) {
            return {
                tracked,
                durationMs,
                event: {
                    type:             'tool-complete',
                    toolCallId,
                    toolName:         tracked?.toolName,
                    parentToolCallId: completeParentId,
                    result:           resultContent,
                },
            };
        } else {
            return {
                tracked,
                durationMs,
                event: {
                    type:             'tool-failed',
                    toolCallId,
                    toolName:         tracked?.toolName,
                    parentToolCallId: completeParentId,
                    error:            data.error?.message || 'Unknown error',
                },
            };
        }
    }

    recordToolProgress(toolCallId: string, progressMessage?: string): void {
        const captured = this.toolCallsMap.get(toolCallId);
        if (captured && progressMessage) {
            (captured as any).progressMessage = progressMessage;
        }
    }

    /** Get captured tool calls as an array (undefined if none). */
    getCapturedToolCalls(): ToolCall[] | undefined {
        return this.toolCallsMap.size > 0
            ? Array.from(this.toolCallsMap.values())
            : undefined;
    }

    /** Get a list of stale active tool call descriptions. */
    getActiveToolDescriptions(): string[] {
        return [...this.activeToolCalls.entries()].map(
            ([id, t]) => `${t.toolName}(${id}, ${Date.now() - t.startTime}ms)`,
        );
    }
}
