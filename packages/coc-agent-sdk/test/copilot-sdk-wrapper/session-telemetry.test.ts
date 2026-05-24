/**
 * Tests for SessionTelemetry
 *
 * Verifies token usage accumulation, tool-call tracking, and response handling.
 */

import { describe, it, expect } from 'vitest';
import { SessionTelemetry } from '../../src/session-telemetry';

describe('SessionTelemetry — token usage', () => {
    it('returns undefined token usage when no usage recorded', () => {
        const t = new SessionTelemetry();
        expect(t.buildTokenUsage()).toBeUndefined();
    });

    it('accumulates token usage across multiple calls', () => {
        const t = new SessionTelemetry();
        t.recordUsage({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 2 });
        t.recordUsage({ inputTokens: 8, outputTokens: 15 });

        const usage = t.buildTokenUsage();
        expect(usage).toBeDefined();
        expect(usage!.inputTokens).toBe(18);
        expect(usage!.outputTokens).toBe(35);
        expect(usage!.cacheReadTokens).toBe(5);
        expect(usage!.cacheWriteTokens).toBe(2);
        expect(usage!.totalTokens).toBe(53);
        expect(usage!.turnCount).toBe(2);
    });

    it('accumulates cost and duration when provided', () => {
        const t = new SessionTelemetry();
        t.recordUsage({ inputTokens: 10, outputTokens: 20, cost: 0.01, duration: 100 });
        t.recordUsage({ inputTokens: 5, outputTokens: 10, cost: 0.005, duration: 50 });

        const usage = t.buildTokenUsage();
        expect(usage!.cost).toBeCloseTo(0.015);
        expect(usage!.duration).toBe(150);
    });

    it('records usage info (token limit and current tokens)', () => {
        const t = new SessionTelemetry();
        t.recordUsage({ inputTokens: 1, outputTokens: 1 });
        t.recordUsageInfo({ tokenLimit: 10000, currentTokens: 500 });

        const usage = t.buildTokenUsage();
        expect(usage!.tokenLimit).toBe(10000);
        expect(usage!.currentTokens).toBe(500);
    });
});

describe('SessionTelemetry — tool call tracking', () => {
    it('records tool start and creates a ToolCall entry', () => {
        const t = new SessionTelemetry();
        const { toolCall, event } = t.recordToolStart({
            toolCallId: 'tc1',
            toolName: 'view',
            arguments: { path: '/tmp/f' },
        });

        expect(toolCall.id).toBe('tc1');
        expect(toolCall.name).toBe('view');
        expect(toolCall.status).toBe('running');
        expect(event.type).toBe('tool-start');
        expect(event.toolCallId).toBe('tc1');
        expect(t.activeToolCalls.has('tc1')).toBe(true);
        expect(t.toolCallsMap.has('tc1')).toBe(true);
    });

    it('records tool complete with success', () => {
        const t = new SessionTelemetry();
        t.recordToolStart({ toolCallId: 'tc1', toolName: 'view', arguments: {} });
        const { event, tracked } = t.recordToolComplete({
            toolCallId: 'tc1',
            success: true,
            result: { content: 'file content' },
        });

        expect(event.type).toBe('tool-complete');
        expect(event.result).toBe('file content');
        expect(tracked?.toolName).toBe('view');
        expect(t.activeToolCalls.has('tc1')).toBe(false);
        expect(t.toolCallsMap.get('tc1')!.status).toBe('completed');
    });

    it('records tool complete with failure', () => {
        const t = new SessionTelemetry();
        t.recordToolStart({ toolCallId: 'tc2', toolName: 'bash', arguments: {} });
        const { event } = t.recordToolComplete({
            toolCallId: 'tc2',
            success: false,
            error: { message: 'permission denied' },
        });

        expect(event.type).toBe('tool-failed');
        expect(event.error).toBe('permission denied');
        expect(t.toolCallsMap.get('tc2')!.status).toBe('failed');
        expect(t.toolCallsMap.get('tc2')!.error).toBe('permission denied');
    });

    it('handles orphaned tool complete (no matching start)', () => {
        const t = new SessionTelemetry();
        const { event } = t.recordToolComplete({
            toolCallId: 'orphan',
            success: false,
            error: { message: 'timeout' },
        });

        expect(event.type).toBe('tool-failed');
        expect(t.toolCallsMap.get('orphan')!.error).toBe('Started outside observation window');
    });

    it('records tool progress', () => {
        const t = new SessionTelemetry();
        t.recordToolStart({ toolCallId: 'tc3', toolName: 'bash', arguments: {} });
        t.recordToolProgress('tc3', 'Running...');

        expect((t.toolCallsMap.get('tc3') as any).progressMessage).toBe('Running...');
    });

    it('uses shared toolCallsMap when provided', () => {
        const shared = new Map();
        const t = new SessionTelemetry(shared);
        t.recordToolStart({ toolCallId: 'tc4', toolName: 'read', arguments: {} });

        expect(shared.size).toBe(1);
        expect(t.toolCallsMap).toBe(shared);
    });

    it('generates unique ID for unknown toolCallId', () => {
        const t = new SessionTelemetry();
        const { toolCall } = t.recordToolStart({ arguments: {} });

        expect(toolCall.id).toMatch(/^tool-/);
        expect(toolCall.name).toBe('unknown');
    });

    it('getCapturedToolCalls returns undefined when empty', () => {
        const t = new SessionTelemetry();
        expect(t.getCapturedToolCalls()).toBeUndefined();
    });

    it('getCapturedToolCalls returns array when populated', () => {
        const t = new SessionTelemetry();
        t.recordToolStart({ toolCallId: 'tc5', toolName: 'view', arguments: {} });
        const calls = t.getCapturedToolCalls();
        expect(calls).toHaveLength(1);
        expect(calls![0].id).toBe('tc5');
    });

    it('getActiveToolDescriptions returns formatted strings', () => {
        const t = new SessionTelemetry();
        t.recordToolStart({ toolCallId: 'tc6', toolName: 'bash', arguments: {} });
        const descs = t.getActiveToolDescriptions();
        expect(descs).toHaveLength(1);
        expect(descs[0]).toContain('bash(tc6');
    });

    it('preserves parentToolCallId from complete event', () => {
        const t = new SessionTelemetry();
        t.recordToolStart({ toolCallId: 'child', toolName: 'view', parentToolCallId: 'parent-start', arguments: {} });
        const { event } = t.recordToolComplete({
            toolCallId: 'child',
            success: true,
            result: { content: 'ok' },
            parentToolCallId: 'parent-complete',
        });

        // Complete event parentToolCallId takes precedence
        expect(event.parentToolCallId).toBe('parent-complete');
    });
});

describe('SessionTelemetry — response accumulation', () => {
    it('accumulates response text', () => {
        const t = new SessionTelemetry();
        t.response += 'foo';
        t.response += 'bar';
        expect(t.response).toBe('foobar');
    });

    it('tracks messages and turn count', () => {
        const t = new SessionTelemetry();
        t.allMessages.push('message 1');
        t.allMessages.push('message 2');
        t.turnCount = 2;

        expect(t.allMessages).toEqual(['message 1', 'message 2']);
        expect(t.turnCount).toBe(2);
    });
});
