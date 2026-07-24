/**
 * @vitest-environment node
 *
 * Static analysis test: after the shared-composer swap (AC-01/03), Notes Chat no
 * longer owns a bespoke ask/autopilot mode control. The empty state uses the
 * shared InitialChatComposer with a compact settings layout and an
 * `allowedModes` filter pinned to Ask + Autopilot; the active chat uses ChatDetail
 * with the same allowed set. The old two-icon NoteModeToggle is gone.
 *
 * These remain source-string assertions; the full rendered-behavior conversion
 * (Verification #2) is a follow-up. They exist to lock the mode restriction and
 * the removal of the bespoke toggle in place.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PANEL_PATH = resolve(
    __dirname,
    '../../../../../src/server/spa/client/react/features/notes/editor/NoteChatPanel.tsx',
);

describe('NoteChatPanel — mode restriction (Ask + Autopilot only)', () => {
    const source = readFileSync(PANEL_PATH, 'utf-8');

    it('no longer defines or renders the bespoke NoteModeToggle', () => {
        expect(source).not.toContain('NoteModeToggle');
        expect(source).not.toContain('note-mode-toggle');
        expect(source).not.toContain('note-mode-ask');
        expect(source).not.toContain('note-mode-autopilot');
    });

    it('no longer owns bespoke selectedMode state', () => {
        expect(source).not.toMatch(/useState<'ask' \| 'autopilot'>/);
        expect(source).not.toContain('setSelectedMode');
    });

    it('defines NOTE_CHAT_ALLOWED_MODES as ask and autopilot', () => {
        expect(source).toMatch(/NOTE_CHAT_ALLOWED_MODES.*ChatMode\[\].*=.*\['ask',\s*'autopilot'\]/);
    });

    it('renders the shared InitialChatComposer for the empty state', () => {
        expect(source).toContain('<InitialChatComposer');
        expect(source).toContain("from '../../chat/NewChatArea'");
    });

    it('pins the shared composer to the allowed modes with a compact settings layout', () => {
        const composerIdx = source.indexOf('<InitialChatComposer');
        expect(composerIdx).toBeGreaterThan(-1);
        const composerBlock = source.slice(composerIdx, source.indexOf('/>', composerIdx));
        expect(composerBlock).toContain('allowedModes={NOTE_CHAT_ALLOWED_MODES}');
        expect(composerBlock).toContain('settingsLayout="compact"');
        // Ralph direct-goal launch is disabled so no workflow can start from Notes.
        expect(composerBlock).toContain('enableRalphDirectGoal={false}');
    });

    it('passes allowedModes to ChatDetail instead of hideModeSelector', () => {
        expect(source).toMatch(/allowedModes=/);
        expect(source).not.toMatch(/hideModeSelector/);
    });

    it('passes compactModeSelector and hideHeader to ChatDetail so the compact header is the only header', () => {
        const chatDetailIdx = source.indexOf('<ChatDetail');
        expect(chatDetailIdx).toBeGreaterThan(-1);
        const chatDetailEnd = source.indexOf('/>', chatDetailIdx);
        expect(chatDetailEnd).toBeGreaterThan(-1);
        const chatDetailBlock = source.slice(chatDetailIdx, chatDetailEnd);
        expect(chatDetailBlock).toContain('compactModeSelector');
        expect(chatDetailBlock).toContain('hideHeader');
        expect(chatDetailBlock).toContain('allowedModes={NOTE_CHAT_ALLOWED_MODES}');
    });
});
