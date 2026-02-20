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
        const panelFile = path.join(CLIENT_DIR, 'react', 'tasks', 'TasksPanel.tsx');
        const panelContent = fs.readFileSync(panelFile, 'utf8');
        expect(panelContent).toContain('scrollTo');
        expect(panelContent).toContain('scrollWidth');

        const treeContent = fs.readFileSync(taskTreeFile, 'utf8');
        expect(treeContent).toContain('onColumnsChange');
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

// ============================================================================
// useQueueActivity hook — queue-to-task mapping
// ============================================================================

describe('useQueueActivity — queue execution activity mapping', () => {
    const hookFile = path.join(CLIENT_DIR, 'react', 'hooks', 'useQueueActivity.ts');

    it('useQueueActivity.ts exists', () => {
        expect(fs.existsSync(hookFile)).toBe(true);
    });

    it('exports useQueueActivity hook', () => {
        const content = fs.readFileSync(hookFile, 'utf8');
        expect(content).toContain('export function useQueueActivity');
    });

    it('consumes QueueContext via useQueue', () => {
        const content = fs.readFileSync(hookFile, 'utf8');
        expect(content).toContain('useQueue');
    });

    it('consumes AppContext via useApp for workspace rootPath', () => {
        const content = fs.readFileSync(hookFile, 'utf8');
        expect(content).toContain('useApp');
        expect(content).toContain('rootPath');
    });

    it('extracts planFilePath from payload', () => {
        const content = fs.readFileSync(hookFile, 'utf8');
        expect(content).toContain('planFilePath');
    });

    it('extracts originalTaskPath from payload.data', () => {
        const content = fs.readFileSync(hookFile, 'utf8');
        expect(content).toContain('originalTaskPath');
    });

    it('normalizes backslashes to forward slashes', () => {
        const content = fs.readFileSync(hookFile, 'utf8');
        expect(content).toContain('replace(/\\\\/g');
    });

    it('processes both queued and running items', () => {
        const content = fs.readFileSync(hookFile, 'utf8');
        expect(content).toContain('queueState.queued');
        expect(content).toContain('queueState.running');
    });

    it('uses useMemo for performance', () => {
        const content = fs.readFileSync(hookFile, 'utf8');
        expect(content).toContain('useMemo');
    });

    it('returns a QueueActivityMap record type', () => {
        const content = fs.readFileSync(hookFile, 'utf8');
        expect(content).toContain('QueueActivityMap');
    });
});

// ============================================================================
// Queue indicator in TaskTreeItem
// ============================================================================

describe('TaskTreeItem — queue execution indicator', () => {
    const itemFile = path.join(CLIENT_DIR, 'react', 'tasks', 'TaskTreeItem.tsx');

    it('accepts queueRunning prop', () => {
        const content = fs.readFileSync(itemFile, 'utf8');
        expect(content).toContain('queueRunning');
    });

    it('renders miller-queue-indicator class', () => {
        const content = fs.readFileSync(itemFile, 'utf8');
        expect(content).toContain('miller-queue-indicator');
    });

    it('renders miller-queue-indicator-running class', () => {
        const content = fs.readFileSync(itemFile, 'utf8');
        expect(content).toContain('miller-queue-indicator-running');
    });

    it('shows indicator only when queueRunning > 0', () => {
        const content = fs.readFileSync(itemFile, 'utf8');
        expect(content).toContain('queueRunning > 0');
    });

    it('displays "in progress" text in the indicator', () => {
        const content = fs.readFileSync(itemFile, 'utf8');
        expect(content).toContain('in progress');
    });

    it('includes running count in title tooltip', () => {
        const content = fs.readFileSync(itemFile, 'utf8');
        expect(content).toContain('In progress (');
    });

    it('uses animate-pulse for subtle running animation', () => {
        const content = fs.readFileSync(itemFile, 'utf8');
        expect(content).toContain('animate-pulse');
    });
});

// ============================================================================
// TaskTree — queue activity integration
// ============================================================================

describe('TaskTree — queue activity integration', () => {
    const treeFile = path.join(CLIENT_DIR, 'react', 'tasks', 'TaskTree.tsx');

    it('imports useQueueActivity hook', () => {
        const content = fs.readFileSync(treeFile, 'utf8');
        expect(content).toContain('useQueueActivity');
    });

    it('passes queueRunning prop to TaskTreeItem', () => {
        const content = fs.readFileSync(treeFile, 'utf8');
        expect(content).toContain('queueRunning');
        expect(content).toContain('queueActivity');
    });
});
