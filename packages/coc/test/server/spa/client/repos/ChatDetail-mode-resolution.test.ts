/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isChatMode, resolveLoadedTaskMode } from '../../../../../src/server/spa/client/react/features/chat/chatMode';
import { cycleMode, getVisibleChatModes } from '../../../../../src/server/spa/client/react/repos/modeConfig';

const FOLLOW_UP_INPUT_SOURCE = resolve(
    __dirname,
    '../../../../../src/server/spa/client/react/features/chat/FollowUpInputArea.tsx',
);

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

// Regression: a follow-up in a sentinel chat used to demote it to Ask. The
// composer coerced the mode to 'ask' (sentinel was not in the allowed set) and
// sent it, which rewrote `metadata.mode` and unhooked the sentinel.
describe('Sentinel is a locked follow-up mode', () => {
    it('pins the allowed mode set to sentinel for a sentinel chat', () => {
        const source = readFileSync(CHAT_DETAIL_SOURCE, 'utf-8');
        expect(source).toContain("if (payloadMode === 'sentinel') return ['sentinel'];");
    });

    it('coerces to the first allowed mode instead of hardcoding ask', () => {
        const source = readFileSync(CHAT_DETAIL_SOURCE, 'utf-8');
        expect(source).toContain("setSelectedMode(allowed.includes('ask') ? 'ask' : allowed[0]);");
        expect(source).not.toContain('        if (!allowed.includes(selectedMode)) {\n            setSelectedMode(\'ask\');');
    });

    it('does not offer sentinel as a per-turn mode in ordinary chats', () => {
        expect(getVisibleChatModes({
            surface: 'follow-up',
            featureFlags: { sentinel: true },
        })).not.toContain('sentinel');
    });

    it('renders only the sentinel pill on the follow-up bar when pinned', () => {
        expect(getVisibleChatModes({
            surface: 'follow-up',
            featureFlags: { sentinel: true },
            allowedModes: ['sentinel'],
        })).toEqual(['sentinel']);
    });

    it('renders the pinned sentinel pill through the follow-up feature flags', () => {
        const source = readFileSync(FOLLOW_UP_INPUT_SOURCE, 'utf-8');
        expect(source).toContain('sentinel: true,');
    });

    it('makes the pill click and Shift+Tab shortcut no-ops', () => {
        expect(cycleMode('sentinel', ['sentinel'])).toBe('sentinel');
    });
});
