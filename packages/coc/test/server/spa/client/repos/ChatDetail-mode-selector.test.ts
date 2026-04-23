/**
 * @vitest-environment node
 *
 * Static analysis test: ChatDetail must default hideModeSelector to false
 * so the mode selector is visible in existing chat sessions.
 *
 * CommitChatPanel and NoteChatPanel must explicitly pass hideModeSelector
 * to suppress it in their contexts.
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

    it('NoteChatPanel explicitly passes hideModeSelector', () => {
        const source = readFileSync(resolve(SPA_ROOT, 'features/notes/editor/NoteChatPanel.tsx'), 'utf-8');
        expect(source).toMatch(/hideModeSelector/);
    });
});
