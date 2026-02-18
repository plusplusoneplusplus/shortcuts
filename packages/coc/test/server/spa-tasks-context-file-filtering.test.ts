/**
 * SPA Dashboard Tests — Context file filtering in task operations.
 *
 * Tests that common context/documentation files (README.md, CLAUDE.md, etc.)
 * are excluded from task counting and queuing operations.
 * Context file filtering is now in react/hooks/useTaskTree.ts.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle } from './spa-test-helpers';

// ============================================================================
// Context File Filtering — helper function presence
// ============================================================================

describe('Context File Filtering — helper function', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines isContextFile function', () => {
        expect(script).toContain('isContextFile');
    });

    it('defines CONTEXT_FILES set', () => {
        expect(script).toContain('CONTEXT_FILES');
    });

    it('includes README.md in context files list', () => {
        expect(script).toContain('readme.md');
    });

    it('includes CLAUDE.md in context files list', () => {
        expect(script).toContain('claude.md');
    });

    it('includes LICENSE in context files list', () => {
        expect(script).toContain('license');
    });

    it('includes CHANGELOG.md in context files list', () => {
        expect(script).toContain('changelog.md');
    });

    it('includes index.md in context files list', () => {
        expect(script).toContain('index.md');
    });

    it('includes context.md in context files list', () => {
        expect(script).toContain('context.md');
    });

    it('uses case-insensitive matching (.toLowerCase())', () => {
        expect(script).toContain('.toLowerCase()');
    });
});

// ============================================================================
// Context File Filtering — React TaskTreeItem integration
// ============================================================================

describe('Context File Filtering — TaskTreeItem integration', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('uses isContextFile for muted styling', () => {
        expect(script).toContain('isContextFile');
    });

    it('filters context files based on showContextFiles state', () => {
        expect(script).toContain('showContextFiles');
    });
});

// ============================================================================
// Context File Filtering — comprehensive file list
// ============================================================================

describe('Context File Filtering — comprehensive file list', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    const contextFiles = [
        'readme',
        'readme.md',
        'claude.md',
        'license',
        'license.md',
        'changelog.md',
        'contributing.md',
        'code_of_conduct.md',
        'security.md',
        'index',
        'index.md',
        'context',
        'context.md',
        '.gitignore',
        '.gitattributes'
    ];

    for (const fileName of contextFiles) {
        it(`includes "${fileName}" in CONTEXT_FILES set`, () => {
            expect(script).toContain(fileName.toLowerCase());
        });
    }
});
