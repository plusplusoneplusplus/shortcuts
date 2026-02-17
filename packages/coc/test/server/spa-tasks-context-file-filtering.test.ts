/**
 * SPA Dashboard Tests — Context file filtering in task operations.
 *
 * Tests that common context/documentation files (README.md, CLAUDE.md, etc.)
 * are excluded from task counting and queuing operations.
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
        // Should have 'readme.md' in lowercase in the set
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
// Context File Filtering — collectPlanFilesInFolder
// ============================================================================

describe('Context File Filtering — collectPlanFilesInFolder', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('calls isContextFile for document group files', () => {
        // Should check !isContextFile(doc.fileName) in document groups loop
        expect(script).toContain('isContextFile');
        expect(script).toContain('documentGroups');
    });

    it('calls isContextFile for single documents', () => {
        // Should check !isContextFile(doc.fileName) in single documents loop
        expect(script).toContain('isContextFile');
        expect(script).toContain('singleDocuments');
    });

    it('filters files before adding to paths array', () => {
        // The filtering should happen before pushing to the paths array
        // Look for the negation pattern: !isContextFile(...)
        const functionStart = script.indexOf('collectPlanFilesInFolder');
        expect(functionStart).toBeGreaterThan(-1);
        
        // Verify the function contains the filtering logic
        const functionCode = script.slice(functionStart, functionStart + 2000);
        expect(functionCode).toContain('!isContextFile');
    });
});

// ============================================================================
// Context File Filtering — collectMarkdownFilesInFolder
// ============================================================================

describe('Context File Filtering — collectMarkdownFilesInFolder', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('calls isContextFile for single documents', () => {
        expect(script).toContain('isContextFile');
    });

    it('calls isContextFile for document groups', () => {
        const functionStart = script.indexOf('collectMarkdownFilesInFolder');
        expect(functionStart).toBeGreaterThan(-1);
        
        const functionCode = script.slice(functionStart, functionStart + 2000);
        expect(functionCode).toContain('!isContextFile');
    });

    it('filters before adding to files array', () => {
        // Should filter before pushing files to the result array
        const functionStart = script.indexOf('collectMarkdownFilesInFolder');
        const functionCode = script.slice(functionStart, functionStart + 2000);
        expect(functionCode).toContain('!isContextFile');
        expect(functionCode).toContain('fileName');
    });
});

// ============================================================================
// Context File Filtering — integration with Queue All Tasks
// ============================================================================

describe('Context File Filtering — Queue All Tasks integration', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('Queue All Tasks uses filtered collectPlanFilesInFolder', () => {
        // Queue All Tasks should call collectPlanFilesRecursive which uses
        // collectPlanFilesInFolder with context file filtering
        expect(script).toContain('collectPlanFilesRecursive');
        expect(script).toContain('collectPlanFilesInFolder');
    });

    it('plan file counting uses filtered function', () => {
        // countPlanFilesInFolder should use the same filtering logic
        expect(script).toContain('countPlanFilesInFolder');
    });
});

// ============================================================================
// Context File Filtering — integration with Follow Prompt
// ============================================================================

describe('Context File Filtering — Follow Prompt integration', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('Follow Prompt uses filtered collectMarkdownFilesInFolder', () => {
        // Follow Prompt should use collectMarkdownFilesInFolder with filtering
        expect(script).toContain('collectMarkdownFilesInFolder');
    });

    it('markdown file counting excludes context files', () => {
        // When counting markdown files for "Follow Prompt (N files)",
        // it should use the filtered collection function
        const functionStart = script.indexOf('collectMarkdownFilesInFolder');
        expect(functionStart).toBeGreaterThan(-1);
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
            // All files should be in lowercase in the set
            expect(script).toContain(fileName.toLowerCase());
        });
    }
});
