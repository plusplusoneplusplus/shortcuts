/**
 * @vitest-environment node
 *
 * Static analysis tests: verifies that ChatDetail exposes a `disableScratchpad`
 * prop and wires it correctly so the scratchpad is always suppressed when the
 * prop is set to true.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SPA_ROOT = resolve(__dirname, '../../../../../src/server/spa/client/react');

describe('ChatDetail disableScratchpad prop', () => {
    let source: string;

    beforeAll(() => {
        source = readFileSync(resolve(SPA_ROOT, 'features/chat/ChatDetail.tsx'), 'utf-8');
    });

    it('declares disableScratchpad in ChatDetailProps', () => {
        expect(source).toMatch(/disableScratchpad\?:\s*boolean/);
    });

    it('defaults disableScratchpad to false in destructuring', () => {
        expect(source).toMatch(/disableScratchpad\s*=\s*false/);
    });

    it('applies disableScratchpad to scratchpadEnabled derivation', () => {
        // Must combine useScratchpadEnabled() with the prop — both on one expression.
        expect(source).toMatch(/useScratchpadEnabled\(\)\s*&&\s*!disableScratchpad/);
    });

    it('does not use disableScratchpad as a standalone override (keeps global pref intact)', () => {
        // The override happens at the call site, not by mutating the hook or global settings.
        const lines = source.split('\n');
        const overrideLine = lines.find(l => l.includes('disableScratchpad') && l.includes('useScratchpadEnabled'));
        expect(overrideLine).toBeDefined();
        expect(overrideLine).toMatch(/useScratchpadEnabled\(\)\s*&&\s*!disableScratchpad/);
    });
});

describe('NoteChatPanel passes disableScratchpad', () => {
    it('passes disableScratchpad to ChatDetail to suppress scratchpad in notes context', () => {
        const source = readFileSync(
            resolve(SPA_ROOT, 'features/notes/editor/NoteChatPanel.tsx'),
            'utf-8'
        );
        expect(source).toContain('disableScratchpad');
    });
});
