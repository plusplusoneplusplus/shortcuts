/**
 * SPA Dashboard Tests — Miller column navigation (React TaskTree).
 *
 * Tests that the React TaskTree component implements Miller-columns
 * navigation with proper column state management.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'src', 'server', 'spa', 'client');

// ============================================================================
// React TaskTree — Miller columns file structure
// ============================================================================

describe('React TaskTree — Miller columns implementation', () => {
    const taskTreeFile = path.join(CLIENT_DIR, 'react', 'tasks', 'TaskTree.tsx');

    it('TaskTree.tsx exists', () => {
        expect(fs.existsSync(taskTreeFile)).toBe(true);
    });

    it('uses columns state for Miller columns', () => {
        const content = fs.readFileSync(taskTreeFile, 'utf8');
        expect(content).toContain('columns');
        expect(content).toContain('setColumns');
    });

    it('appends column on folder click', () => {
        const content = fs.readFileSync(taskTreeFile, 'utf8');
        expect(content).toContain('handleFolderClick');
        expect(content).toContain('colIndex + 1');
    });

    it('sets openFilePath on file click', () => {
        const content = fs.readFileSync(taskTreeFile, 'utf8');
        expect(content).toContain('handleFileClick');
        expect(content).toContain('setOpenFilePath');
    });

    it('renders miller-column containers', () => {
        const content = fs.readFileSync(taskTreeFile, 'utf8');
        expect(content).toContain('miller-column');
    });

    it('initializes root column from tree using folderToNodes', () => {
        const content = fs.readFileSync(taskTreeFile, 'utf8');
        expect(content).toContain('folderToNodes');
    });

    it('auto-scrolls to rightmost column', () => {
        const content = fs.readFileSync(taskTreeFile, 'utf8');
        expect(content).toContain('scrollLeft');
        expect(content).toContain('scrollWidth');
    });
});

// ============================================================================
// React TaskTreeItem — file and folder rendering
// ============================================================================

describe('React TaskTreeItem — file and folder rendering', () => {
    const itemFile = path.join(CLIENT_DIR, 'react', 'tasks', 'TaskTreeItem.tsx');

    it('TaskTreeItem.tsx exists', () => {
        expect(fs.existsSync(itemFile)).toBe(true);
    });

    it('renders folder arrow indicator', () => {
        const content = fs.readFileSync(itemFile, 'utf8');
        expect(content).toContain('▶');
    });

    it('renders checkbox for file items', () => {
        const content = fs.readFileSync(itemFile, 'utf8');
        expect(content).toContain('task-checkbox');
        expect(content).toContain('checkbox');
    });

    it('renders comment count badge', () => {
        const content = fs.readFileSync(itemFile, 'utf8');
        expect(content).toContain('commentCount');
    });

    it('applies muted styling for context files', () => {
        const content = fs.readFileSync(itemFile, 'utf8');
        expect(content).toContain('isContext');
        expect(content).toContain('opacity-50');
    });

    it('hides context files when showContextFiles is false', () => {
        const content = fs.readFileSync(itemFile, 'utf8');
        expect(content).toContain('showContextFiles');
        expect(content).toContain('return null');
    });
});
