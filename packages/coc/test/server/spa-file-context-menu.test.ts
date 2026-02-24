/**
 * SPA Dashboard Tests — File right-click context menu feature.
 *
 * Static code inspection tests confirming the files and key symbols
 * exist for the file context menu implementation.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'src', 'server', 'spa', 'client');
const HOOKS_DIR = path.join(CLIENT_DIR, 'react', 'hooks');
const TASKS_DIR = path.join(CLIENT_DIR, 'react', 'tasks');

describe('File context menu — useFileActions hook', () => {
    const hookFile = path.join(HOOKS_DIR, 'useFileActions.ts');

    it('useFileActions.ts exists', () => {
        expect(fs.existsSync(hookFile)).toBe(true);
    });

    it('exports useFileActions function', () => {
        const content = fs.readFileSync(hookFile, 'utf8');
        expect(content).toContain('export function useFileActions');
    });

    it('exports FileActionsResult interface', () => {
        const content = fs.readFileSync(hookFile, 'utf8');
        expect(content).toContain('export interface FileActionsResult');
    });

    it('implements renameFile action', () => {
        const content = fs.readFileSync(hookFile, 'utf8');
        expect(content).toContain('renameFile');
    });

    it('implements archiveFile action', () => {
        const content = fs.readFileSync(hookFile, 'utf8');
        expect(content).toContain('archiveFile');
    });

    it('implements unarchiveFile action', () => {
        const content = fs.readFileSync(hookFile, 'utf8');
        expect(content).toContain('unarchiveFile');
    });

    it('implements deleteFile action', () => {
        const content = fs.readFileSync(hookFile, 'utf8');
        expect(content).toContain('deleteFile');
    });

    it('implements moveFile action', () => {
        const content = fs.readFileSync(hookFile, 'utf8');
        expect(content).toContain('moveFile');
    });
});

describe('File context menu — FileMoveDialog component', () => {
    const dialogFile = path.join(TASKS_DIR, 'FileMoveDialog.tsx');

    it('FileMoveDialog.tsx exists', () => {
        expect(fs.existsSync(dialogFile)).toBe(true);
    });

    it('exports FileMoveDialog component', () => {
        const content = fs.readFileSync(dialogFile, 'utf8');
        expect(content).toContain('export function FileMoveDialog');
    });

    it('uses file-move-destination-list testid', () => {
        const content = fs.readFileSync(dialogFile, 'utf8');
        expect(content).toContain('file-move-destination-list');
    });

    it('renders Tasks Root as a destination option', () => {
        const content = fs.readFileSync(dialogFile, 'utf8');
        expect(content).toContain('Tasks Root');
    });
});

describe('File context menu — TaskTreeItem wiring', () => {
    const itemFile = path.join(TASKS_DIR, 'TaskTreeItem.tsx');

    it('TaskTreeItem accepts onFileContextMenu prop', () => {
        const content = fs.readFileSync(itemFile, 'utf8');
        expect(content).toContain('onFileContextMenu');
    });

    it('TaskTreeItem fires onFileContextMenu for non-folder items', () => {
        const content = fs.readFileSync(itemFile, 'utf8');
        expect(content).toContain('!isFolder');
        expect(content).toContain('onFileContextMenu');
    });

    it('TaskTreeItem does NOT fire onFileContextMenu for context files', () => {
        const content = fs.readFileSync(itemFile, 'utf8');
        expect(content).toContain('!isContext');
    });
});

describe('File context menu — TaskTree wiring', () => {
    const treeFile = path.join(TASKS_DIR, 'TaskTree.tsx');

    it('TaskTree accepts and passes through onFileContextMenu prop', () => {
        const content = fs.readFileSync(treeFile, 'utf8');
        expect(content).toContain('onFileContextMenu');
    });
});

describe('File context menu — TasksPanel integration', () => {
    const panelFile = path.join(TASKS_DIR, 'TasksPanel.tsx');

    it('TasksPanel imports useFileActions', () => {
        const content = fs.readFileSync(panelFile, 'utf8');
        expect(content).toContain('useFileActions');
    });

    it('TasksPanel imports FileMoveDialog', () => {
        const content = fs.readFileSync(panelFile, 'utf8');
        expect(content).toContain('FileMoveDialog');
    });

    it('TasksPanel handles file context menu (handleFileContextMenu)', () => {
        const content = fs.readFileSync(panelFile, 'utf8');
        expect(content).toContain('handleFileContextMenu');
    });

    it('TasksPanel builds file menu items with Rename', () => {
        const content = fs.readFileSync(panelFile, 'utf8');
        expect(content).toContain('\'Rename\'');
    });

    it('TasksPanel builds file menu items with Archive/Unarchive', () => {
        const content = fs.readFileSync(panelFile, 'utf8');
        expect(content).toContain('\'Archive\'');
        expect(content).toContain('\'Unarchive\'');
    });

    it('TasksPanel builds file menu items with Move File', () => {
        const content = fs.readFileSync(panelFile, 'utf8');
        expect(content).toContain('\'Move File\'');
    });

    it('TasksPanel builds file menu items with Delete', () => {
        const content = fs.readFileSync(panelFile, 'utf8');
        expect(content).toContain('\'Delete\'');
    });

    it('TasksPanel has file rename dialog', () => {
        const content = fs.readFileSync(panelFile, 'utf8');
        expect(content).toContain('Rename File');
    });

    it('TasksPanel has file delete confirmation dialog', () => {
        const content = fs.readFileSync(panelFile, 'utf8');
        expect(content).toContain('Delete File');
    });

    it('TasksPanel passes onFileContextMenu to TaskTree', () => {
        const content = fs.readFileSync(panelFile, 'utf8');
        expect(content).toContain('onFileContextMenu={handleFileContextMenu}');
    });
});
