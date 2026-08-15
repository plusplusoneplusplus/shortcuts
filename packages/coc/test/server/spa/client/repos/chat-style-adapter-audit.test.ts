/**
 * @vitest-environment node
 *
 * Adapter audit: every consumer of `InitialChatComposerSubmission` must forward
 * `chatStyle` on to the enqueue payload it rebuilds.
 *
 * This is the failure mode the shared composer invites — a new compact chat
 * surface copies the six fields it remembers and quietly drops the seventh, so
 * the user picks a style and the chat runs without it. The test discovers the
 * consumer list from source rather than hardcoding it, so a NEW adapter added
 * later fails here instead of shipping a silent gap.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, join } from 'path';

const REACT_ROOT = resolve(__dirname, '../../../../../src/server/spa/client/react');
const COMPOSER_PATH = join(REACT_ROOT, 'features/chat/NewChatArea.tsx');

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
}

/** Files that reference the submission type but are not the composer itself. */
function findAdapters(): Array<{ path: string; source: string }> {
    return walk(REACT_ROOT)
        .filter(p => p !== COMPOSER_PATH)
        .map(path => ({ path, source: readFileSync(path, 'utf-8') }))
        .filter(f => f.source.includes('InitialChatComposerSubmission'));
}

describe('chat style — InitialChatComposerSubmission adapter audit', () => {
    const adapters = findAdapters();

    it('finds the known adapter surfaces (Notes, commit, PR, Work Item)', () => {
        const names = adapters.map(a => a.path.replace(REACT_ROOT, '')).sort();
        expect(names.length).toBeGreaterThanOrEqual(4);
        expect(names.some(n => n.includes('NoteChatPanel'))).toBe(true);
        expect(names.some(n => n.includes('CommitChatPanel'))).toBe(true);
        expect(names.some(n => n.includes('WorkItemChatPanel'))).toBe(true);
        expect(names.some(n => n.includes('ChatPanel') && n.includes('pull-requests'))).toBe(true);
    });

    it.each(findAdapters().map(a => [a.path.replace(REACT_ROOT, ''), a.source] as const))(
        '%s forwards submission.chatStyle',
        (_name, source) => {
            expect(source).toContain('submission.chatStyle');
        },
    );

    it('the composer only sends chatStyle when the flag is on and the mode is supported', () => {
        const source = readFileSync(COMPOSER_PATH, 'utf-8');
        expect(source).toContain('chatStyleSelectorEnabled && isChatStyleSupportedMode(mode) ? { chatStyle: selectedChatStyle }');
        // Ask + Autopilot only; Ralph and the workflow modes stay out of scope.
        expect(source).toMatch(/isChatStyleSupportedMode[\s\S]{0,200}mode === 'ask' \|\| mode === 'autopilot'/);
    });

    it('the composer keeps the style per-send — no preference seed, no browser key', () => {
        const source = readFileSync(COMPOSER_PATH, 'utf-8');
        expect(source).not.toContain('lastChatStyle');
        expect(source).not.toMatch(/localStorage\.[gs]etItem\([^)]*chat-style/);
    });
});
