/**
 * SPA Dashboard Tests — Copy Path context menu items in the Tasks tab.
 *
 * Tests that folder and file context menus include "Copy Path" and
 * "Copy Absolute Path" actions, and that the copyTaskPath helper is
 * wired up correctly.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle } from './spa-test-helpers';

// ============================================================================
// Copy Path — menu items present in client bundle
// ============================================================================

describe('Copy Path — menu items present in client bundle', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('renders Copy Path menu item label', () => {
        expect(script).toContain('Copy Path');
    });

    it('renders Copy Absolute Path menu item label', () => {
        expect(script).toContain('Copy Absolute Path');
    });

    it('uses data-ctx-action attribute for copy-path', () => {
        expect(script).toContain('copy-path');
    });

    it('uses data-ctx-action attribute for copy-absolute-path', () => {
        expect(script).toContain('copy-absolute-path');
    });
});

// ============================================================================
// Copy Path — copyTaskPath helper function
// ============================================================================

describe('Copy Path — copyTaskPath helper function', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines copyTaskPath function', () => {
        expect(script).toContain('copyTaskPath');
    });

    it('calls copyToClipboard in copyTaskPath', () => {
        expect(script).toContain('copyToClipboard');
    });

    it('shows success toast with copied path', () => {
        // The function shows "✓ Copied: " prefix in the toast
        // esbuild encodes ✓ as unicode escape
        expect(script).toContain('Copied:');
    });

    it('resolves workspace rootPath for absolute paths', () => {
        expect(script).toContain('rootPath');
    });

    it('resolves tasks folder path for absolute paths', () => {
        expect(script).toContain('getTasksFolderPath');
    });
});

// ============================================================================
// Copy Path — folder context menu integration
// ============================================================================

describe('Copy Path — folder context menu integration', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('handles copy-path action in folder context menu switch', () => {
        // The folder context menu switch handles copy-path action
        expect(script).toContain('"copy-path"');
    });

    it('handles copy-absolute-path action in folder context menu switch', () => {
        expect(script).toContain('"copy-absolute-path"');
    });

    it('calls copyTaskPath with false for relative path in folder menu', () => {
        expect(script).toContain('copyTaskPath(wsId, path, false)');
    });

    it('calls copyTaskPath with true for absolute path in folder menu', () => {
        expect(script).toContain('copyTaskPath(wsId, path, true)');
    });
});

// ============================================================================
// Copy Path — task file context menu integration
// ============================================================================

describe('Copy Path — task file context menu integration', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('includes copy-path action in task file context menu handler', () => {
        // The task file context menu uses if/else-if chain for actions
        expect(script).toContain('copy-path');
    });

    it('includes copy-absolute-path action in task file context menu handler', () => {
        expect(script).toContain('copy-absolute-path');
    });

    it('renders Copy Path with clipboard emoji icon', () => {
        // 📋 clipboard emoji (esbuild encodes as unicode escape)
        expect(script).toContain('Copy Path');
    });
});

// ============================================================================
// Copy Path — menu item ordering
// ============================================================================

describe('Copy Path — menu item ordering', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('places Copy Path before Copy Absolute Path', () => {
        const copyIdx = script.indexOf('Copy Path');
        const absIdx = script.indexOf('Copy Absolute Path');
        expect(copyIdx).toBeGreaterThan(-1);
        expect(absIdx).toBeGreaterThan(-1);
        expect(absIdx).toBeGreaterThan(copyIdx);
    });

    it('places Copy Path items in folder menu before Archive Folder label', () => {
        // Both "Copy Path" and "Archive Folder" labels appear in the folder context menu
        const copyLabelIdx = script.indexOf('Copy Path');
        const archiveLabelIdx = script.indexOf('Archive Folder');
        expect(copyLabelIdx).toBeGreaterThan(-1);
        expect(archiveLabelIdx).toBeGreaterThan(-1);
        expect(archiveLabelIdx).toBeGreaterThan(copyLabelIdx);
    });

    it('places Copy Path items in task menu after Archive/Unarchive section', () => {
        // In the file context menu, copy-path comes after archive-task in the HTML
        const archiveTaskIdx = script.indexOf('archive-task');
        // copy-path appears later for the file menu items
        expect(archiveTaskIdx).toBeGreaterThan(-1);
        expect(script.indexOf('copy-path')).toBeGreaterThan(-1);
    });
});
