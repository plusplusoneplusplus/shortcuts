/**
 * Unit tests for the exported `repoRelative` helper — absolute → repo-relative
 * path conversion used by the untracked-file preview.
 */

import { describe, it, expect } from 'vitest';
import { repoRelative } from '../../../../src/server/spa/client/react/features/git/working-tree/WorkingTree';

describe('repoRelative', () => {
    it('converts an absolute path under the root to a repo-relative path', () => {
        expect(repoRelative('/home/user/RSL/AGENTS.md', '/home/user/RSL')).toBe('AGENTS.md');
    });

    it('handles nested paths under the root', () => {
        expect(repoRelative('/home/user/RSL/src/lib/new.ts', '/home/user/RSL')).toBe('src/lib/new.ts');
    });

    it('tolerates a trailing separator on the root', () => {
        expect(repoRelative('/home/user/RSL/AGENTS.md', '/home/user/RSL/')).toBe('AGENTS.md');
    });

    it('normalizes Windows-style backslashes to forward slashes', () => {
        expect(repoRelative('C:\\repos\\RSL\\src\\a.ts', 'C:\\repos\\RSL')).toBe('src/a.ts');
    });

    it('returns the input unchanged when it is not under the root', () => {
        expect(repoRelative('/other/place/AGENTS.md', '/home/user/RSL')).toBe('/other/place/AGENTS.md');
    });

    it('does not treat a sibling directory with a shared prefix as inside the root', () => {
        // "/home/user/RSL2" shares the "/home/user/RSL" prefix but is a different repo.
        expect(repoRelative('/home/user/RSL2/AGENTS.md', '/home/user/RSL')).toBe('/home/user/RSL2/AGENTS.md');
    });
});
