/**
 * @vitest-environment node
 *
 * Static analysis test: useNotesChat must default createChat mode to 'ask'.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const HOOK_PATH = resolve(
    __dirname,
    '../../../../../src/server/spa/client/react/features/notes/hooks/useNotesChat.ts',
);

describe('useNotesChat — default mode', () => {
    const source = readFileSync(HOOK_PATH, 'utf-8');

    it('createChat accepts a mode parameter', () => {
        expect(source).toMatch(/createChat.*mode/);
    });

    it('defaults mode to ask', () => {
        expect(source).toMatch(/mode.*=\s*'ask'/);
    });

    it('passes mode into the POST payload', () => {
        // The payload must use the mode variable, not a hardcoded string
        expect(source).toMatch(/mode,/);
        // Must NOT contain the old hardcoded 'autopilot' in the payload
        expect(source).not.toMatch(/mode:\s*'autopilot'/);
    });
});
