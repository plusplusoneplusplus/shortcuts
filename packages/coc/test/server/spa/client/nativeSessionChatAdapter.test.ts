/**
 * Unit tests for the native-session → chat `task`/`metadataProcess` adapters
 * that let the read-only CLI Sessions detail view reuse `ChatHeader` and
 * `ConversationMetadataPopover` without a fork.
 */
import { describe, it, expect } from 'vitest';
import type { NativeCliSessionDetail } from '@plusplusoneplusplus/coc-client';
import {
    buildNativeSessionMetadataExtraRows,
    deriveNativeSessionModel,
    formatNativeSessionTimestamp,
    nativeSessionTitle,
    toNativeSessionHeaderTask,
    toNativeSessionMetadataProcess,
} from '../../../../src/server/spa/client/react/features/native-copilot-sessions/nativeSessionChatAdapter';

function makeDetail(overrides: Partial<NativeCliSessionDetail> = {}): NativeCliSessionDetail {
    return {
        id: 'session-aaaa-bbbb',
        repository: 'owner/repo',
        cwd: '/workspace/path',
        hostType: 'github',
        branch: 'main',
        summary: 'Full stored summary',
        createdAt: '2026-06-11T17:56:21.130Z',
        updatedAt: '2026-06-11T17:56:22.081Z',
        turns: [],
        conversation: [
            { role: 'user', content: 'hi', timeline: [] },
            { role: 'assistant', content: 'hello', timeline: [], model: 'gpt-5.5' },
        ],
        provider: 'copilot',
        storePath: '/home/me/.copilot/session-store.db',
        searchIndexAvailable: true,
        ...overrides,
    };
}

describe('nativeSessionTitle', () => {
    it('uses the session id as the header title', () => {
        expect(nativeSessionTitle(makeDetail())).toBe('session-aaaa-bbbb');
    });
});

describe('toNativeSessionHeaderTask', () => {
    it('carries the provider for the header provider badge and no run status', () => {
        const task = toNativeSessionHeaderTask(makeDetail({ provider: 'claude' }));
        expect(task).toEqual({ type: 'chat', metadata: { provider: 'claude' } });
        // No status field — native sessions have no CoC run lifecycle.
        expect('status' in task).toBe(false);
    });
});

describe('deriveNativeSessionModel', () => {
    it('returns the most recent assistant turn model', () => {
        const detail = makeDetail({
            conversation: [
                { role: 'assistant', content: 'a', timeline: [], model: 'old-model' },
                { role: 'user', content: 'q', timeline: [] },
                { role: 'assistant', content: 'b', timeline: [], model: 'new-model' },
            ],
        });
        expect(deriveNativeSessionModel(detail)).toBe('new-model');
    });

    it('skips assistant turns without a model and trims whitespace', () => {
        const detail = makeDetail({
            conversation: [
                { role: 'assistant', content: 'a', timeline: [], model: '  spaced-model  ' },
                { role: 'assistant', content: 'b', timeline: [] },
            ],
        });
        expect(deriveNativeSessionModel(detail)).toBe('spaced-model');
    });

    it('returns undefined when no assistant turn carries a model', () => {
        const detail = makeDetail({
            conversation: [
                { role: 'user', content: 'q', timeline: [] },
                { role: 'assistant', content: 'a', timeline: [], model: '   ' },
            ],
        });
        expect(deriveNativeSessionModel(detail)).toBeUndefined();
    });

    it('returns undefined for an empty conversation', () => {
        expect(deriveNativeSessionModel(makeDetail({ conversation: [] }))).toBeUndefined();
    });
});

describe('toNativeSessionMetadataProcess', () => {
    it('includes the derived model when an assistant turn recorded one', () => {
        expect(toNativeSessionMetadataProcess(makeDetail())).toEqual({
            metadata: { provider: 'copilot', model: 'gpt-5.5' },
        });
    });

    it('omits the model when no assistant turn recorded one', () => {
        const process = toNativeSessionMetadataProcess(makeDetail({ conversation: [] }));
        expect(process).toEqual({ metadata: { provider: 'copilot' } });
        expect('model' in process.metadata).toBe(false);
    });
});

describe('formatNativeSessionTimestamp', () => {
    it('returns null for null/blank values', () => {
        expect(formatNativeSessionTimestamp(null)).toBeNull();
        expect(formatNativeSessionTimestamp(undefined)).toBeNull();
        expect(formatNativeSessionTimestamp('   ')).toBeNull();
    });

    it('returns the raw value when unparseable', () => {
        expect(formatNativeSessionTimestamp('not-a-date')).toBe('not-a-date');
    });

    it('returns a locale string for a valid ISO timestamp', () => {
        const iso = '2026-06-11T17:56:21.130Z';
        expect(formatNativeSessionTimestamp(iso)).toBe(new Date(Date.parse(iso)).toLocaleString());
    });
});

describe('buildNativeSessionMetadataExtraRows', () => {
    it('surfaces repository, branch, cwd, host, created/updated, and summary', () => {
        const rows = buildNativeSessionMetadataExtraRows(makeDetail());
        const byLabel = new Map(rows.map(r => [r.label, r.value]));
        expect(byLabel.get('Repository')).toBe('owner/repo');
        expect(byLabel.get('Branch')).toBe('main');
        expect(byLabel.get('Working Directory')).toBe('/workspace/path');
        expect(byLabel.get('Host')).toBe('github');
        expect(byLabel.get('Created')).toBe(formatNativeSessionTimestamp('2026-06-11T17:56:21.130Z'));
        expect(byLabel.get('Updated')).toBe(formatNativeSessionTimestamp('2026-06-11T17:56:22.081Z'));
        expect(byLabel.get('Summary')).toBe('Full stored summary');
        // Long / path-like values are marked break-all for layout.
        expect(rows.find(r => r.label === 'Repository')?.breakAll).toBe(true);
        expect(rows.find(r => r.label === 'Working Directory')?.breakAll).toBe(true);
        expect(rows.find(r => r.label === 'Summary')?.breakAll).toBe(true);
    });

    it('omits rows whose source field is null or blank', () => {
        const rows = buildNativeSessionMetadataExtraRows(makeDetail({
            repository: null,
            branch: null,
            cwd: null,
            hostType: null,
            createdAt: null,
            updatedAt: null,
            summary: '   ',
        }));
        expect(rows).toEqual([]);
    });

    it('preserves a stable display order', () => {
        const labels = buildNativeSessionMetadataExtraRows(makeDetail()).map(r => r.label);
        expect(labels).toEqual(['Repository', 'Branch', 'Working Directory', 'Host', 'Created', 'Updated', 'Summary']);
    });
});
