/**
 * @vitest-environment node
 *
 * Static analysis test: ChatDetail must default hideModeSelector to false
 * so the mode selector is visible in existing chat sessions.
 *
 * CommitChatPanel must explicitly pass hideModeSelector to suppress it.
 * NoteChatPanel must pass allowedModes to restrict to ask/autopilot.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SPA_ROOT = resolve(__dirname, '../../../../../src/server/spa/client/react');

describe('ChatDetail hideModeSelector default', () => {
    it('defaults hideModeSelector to false (visible)', () => {
        const source = readFileSync(resolve(SPA_ROOT, 'features/chat/ChatDetail.tsx'), 'utf-8');
        // The destructuring default must be `hideModeSelector = false`
        expect(source).toMatch(/hideModeSelector\s*=\s*false/);
        expect(source).not.toMatch(/hideModeSelector\s*=\s*true/);
    });

    it('CommitChatPanel explicitly passes hideModeSelector', () => {
        const source = readFileSync(resolve(SPA_ROOT, 'features/git/commits/CommitChatPanel.tsx'), 'utf-8');
        expect(source).toMatch(/hideModeSelector/);
    });

    it('NoteChatPanel passes allowedModes (ask/autopilot only)', () => {
        const source = readFileSync(resolve(SPA_ROOT, 'features/notes/editor/NoteChatPanel.tsx'), 'utf-8');
        expect(source).toMatch(/allowedModes/);
        // Should not use hideModeSelector anymore
        expect(source).not.toMatch(/hideModeSelector/);
    });
});

describe('ChatDetail allowedModes prop', () => {
    it('ChatDetail accepts allowedModes prop', () => {
        const source = readFileSync(resolve(SPA_ROOT, 'features/chat/ChatDetail.tsx'), 'utf-8');
        expect(source).toMatch(/allowedModes\??: ChatMode\[\]/);
    });

    it('FollowUpInputArea accepts allowedModes prop', () => {
        const source = readFileSync(resolve(SPA_ROOT, 'features/chat/FollowUpInputArea.tsx'), 'utf-8');
        expect(source).toMatch(/allowedModes\??: ChatMode\[\]/);
    });

    it('ChatDetail passes effective allowedModes to FollowUpInputArea', () => {
        const source = readFileSync(resolve(SPA_ROOT, 'features/chat/ChatDetail.tsx'), 'utf-8');
        // The prop is now passed through `effectiveAllowedModes`, which
        // appends 'ralph' to the inbound `allowedModes` on eligible chats
        // (completed ask-mode without a ralph context).
        expect(source).toMatch(/allowedModes=\{effectiveAllowedModes\}/);
    });
});
