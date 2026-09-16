/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isChatMode, resolveLoadedTaskMode } from '../../../../../src/server/spa/client/react/features/chat/chatMode';

const CHAT_DETAIL_SOURCE = resolve(
    __dirname,
    '../../../../../src/server/spa/client/react/features/chat/ChatDetail.tsx',
);

describe('ChatDetail mode resolution', () => {
    it('normalizes legacy payload plan mode to ask for queued tasks', () => {
        expect(resolveLoadedTaskMode({
            payload: { mode: 'plan' },
            metadata: { mode: 'autopilot' },
        })).toBe('ask');
    });

    it('falls back to metadata mode for persisted conversations', () => {
        expect(resolveLoadedTaskMode({
            payload: {},
            metadata: { mode: 'autopilot' },
        })).toBe('autopilot');
    });

    it('supports ask mode from metadata', () => {
        expect(resolveLoadedTaskMode({
            metadata: { mode: 'ask' },
        })).toBe('ask');
    });

    it('supports Sentinel mode from persisted metadata', () => {
        expect(resolveLoadedTaskMode({
            metadata: { mode: 'sentinel' },
        })).toBe('sentinel');
    });

    it('ignores unknown modes', () => {
        expect(resolveLoadedTaskMode({
            payload: { mode: 'unknown' },
            metadata: { mode: 'also-unknown' },
        })).toBeUndefined();
    });

    it('recognizes valid draft modes for draft priority', () => {
        expect(isChatMode('plan')).toBe(false);
        expect(isChatMode('autopilot')).toBe(true);
        expect(isChatMode('ask')).toBe(true);
        expect(isChatMode('unknown')).toBe(false);
    });

    it('checks the saved draft mode before resolving the task mode', () => {
        const source = readFileSync(CHAT_DETAIL_SOURCE, 'utf-8');
        const draftCheckIndex = source.indexOf('if (normalizeChatMode(draft?.mode))');
        const taskModeIndex = source.indexOf('const taskMode = resolveLoadedTaskMode(task);');

        expect(draftCheckIndex).toBeGreaterThan(-1);
        expect(taskModeIndex).toBeGreaterThan(-1);
        expect(draftCheckIndex).toBeLessThan(taskModeIndex);
    });

    it('exposes check-now only for a feature-enabled Sentinel chat', () => {
        const source = readFileSync(CHAT_DETAIL_SOURCE, 'utf-8');

        expect(source).toContain("const isSentinelChat = isSentinelEnabled() && resolveLoadedTaskMode(task) === 'sentinel';");
        expect(source).toContain('onCheckSentinelNow={isSentinelChat ?');
        expect(source).toContain('client.workspaces.checkSentinelNow(workspaceId)');
    });
});
