/**
 * SPA Dashboard Tests — Miller column navigation path management.
 *
 * Tests that clicking files and folders in the Miller columns view
 * correctly updates __navPath so that stale folder columns are removed
 * when navigating to a file at a different level.
 *
 * Bug scenario: open a subfolder (e.g. "mock-refactor-and-tests"), then
 * click a root-level file — the subfolder column should disappear and
 * only root + preview should remain.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle, generateDashboardHtml } from './spa-test-helpers';

// ============================================================================
// parentFolderPath helper — bundle presence
// ============================================================================

describe('parentFolderPath helper — bundle presence', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines parentFolderPath function', () => {
        expect(script).toContain('function parentFolderPath');
    });

    it('uses lastIndexOf to find separator', () => {
        const fn = script.match(/function parentFolderPath[\s\S]*?\n\s*\}/);
        expect(fn).toBeTruthy();
        expect(fn![0]).toContain('lastIndexOf');
    });

    it('returns empty string for root-level files', () => {
        const fn = script.match(/function parentFolderPath[\s\S]*?\n\s*\}/);
        expect(fn).toBeTruthy();
        expect(fn![0]).toContain('idx > 0');
    });

    it('uses substring to extract parent path', () => {
        const fn = script.match(/function parentFolderPath[\s\S]*?\n\s*\}/);
        expect(fn).toBeTruthy();
        expect(fn![0]).toContain('substring(0, idx)');
    });
});

// ============================================================================
// File click handler — navPath update
// ============================================================================

describe('File click handler — navPath update on file click', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('updates __navPath before calling openTaskFile', () => {
        expect(script).toContain('expandedFolders["__navPath"]');
    });

    it('computes parent path from file path parts in click handler', () => {
        const fileClickSection = script.match(
            /data-file-path[\s\S]{0,800}?openTaskFile\(wsId,\s*filePath\)/
        );
        expect(fileClickSection).toBeTruthy();
        const section = fileClickSection![0];
        expect(section).toContain('split');
        expect(section).toContain('__navPath');
    });

    it('sets empty navPath for root-level files (parts.length <= 1)', () => {
        const fileClickSection = script.match(
            /data-file-path[\s\S]{0,800}?openTaskFile\(wsId,\s*filePath\)/
        );
        expect(fileClickSection).toBeTruthy();
        const section = fileClickSection![0];
        expect(section).toMatch(/parts\.length\s*>\s*1/);
    });

    it('joins parent segments for nested files', () => {
        const fileClickSection = script.match(
            /data-file-path[\s\S]{0,800}?openTaskFile\(wsId,\s*filePath\)/
        );
        expect(fileClickSection).toBeTruthy();
        const section = fileClickSection![0];
        expect(section).toContain('slice(0, -1)');
        expect(section).toMatch(/join\s*\(\s*["']\/["']\s*\)/);
    });
});

// ============================================================================
// openTaskFile — column structure change detection
// ============================================================================

describe('openTaskFile — column structure change detection', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('compares parent folder paths of previous and new file', () => {
        // openTaskFile should check if the column structure changed
        const openTaskFileSection = script.match(
            /function openTaskFile[\s\S]*?renderMillerColumns/
        );
        expect(openTaskFileSection).toBeTruthy();
        const section = openTaskFileSection![0];
        expect(section).toContain('parentFolderPath(previousFilePath)');
        expect(section).toContain('parentFolderPath(filePath)');
    });

    it('does incremental update only when parent paths match', () => {
        const openTaskFileSection = script.match(
            /function openTaskFile[\s\S]*?renderMillerColumns/
        );
        expect(openTaskFileSection).toBeTruthy();
        const section = openTaskFileSection![0];
        // Should compare prevParent === newParent
        expect(section).toMatch(/prevParent\s*===\s*newParent/);
    });

    it('falls through to full re-render when parent paths differ', () => {
        const openTaskFileSection = script.match(
            /function openTaskFile[\s\S]*?renderMillerColumns/
        );
        expect(openTaskFileSection).toBeTruthy();
        const section = openTaskFileSection![0];
        // After the if-block for same parent, there should be a renderMillerColumns call
        expect(section).toContain('renderMillerColumns');
    });

    it('stores previous file path before updating state', () => {
        const openTaskFileSection = script.match(
            /function openTaskFile[\s\S]*?renderMillerColumns/
        );
        expect(openTaskFileSection).toBeTruthy();
        const section = openTaskFileSection![0];
        expect(section).toContain('previousFilePath');
        expect(section).toContain('openFilePath');
    });
});

// ============================================================================
// openTaskFileFromHash — navPath for root-level files
// ============================================================================

describe('openTaskFileFromHash — navPath for all file levels', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines openTaskFileFromHash function', () => {
        expect(script).toContain('openTaskFileFromHash');
    });

    it('sets navPath for root-level files (empty string)', () => {
        const hashSection = script.match(
            /openTaskFileFromHash[\s\S]*?openTaskFile/
        );
        expect(hashSection).toBeTruthy();
        const section = hashSection![0];
        expect(section).toMatch(/expandedFolders\[["']__navPath["']\]/);
        expect(section).toMatch(/parts\.length\s*>\s*1/);
    });

    it('computes parent path from file path parts', () => {
        const hashSection = script.match(
            /openTaskFileFromHash[\s\S]*?openTaskFile/
        );
        expect(hashSection).toBeTruthy();
        const section = hashSection![0];
        expect(section).toContain('split');
        expect(section).toContain('slice(0, -1)');
    });
});

// ============================================================================
// renderMillerColumns — column generation from navPath
// ============================================================================

describe('renderMillerColumns — column generation consistency', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('reads __navPath to determine column count', () => {
        expect(script).toMatch(/expandedFolders\[["']__navPath["']\]/);
    });

    it('splits navPath into segments for column generation', () => {
        const renderSection = script.match(
            /function renderMillerColumns[\s\S]*?innerHTML/
        );
        expect(renderSection).toBeTruthy();
        const section = renderSection![0];
        expect(section).toMatch(/split\s*\(\s*["']\/["']\s*\)/);
    });

    it('always renders root column', () => {
        const renderSection = script.match(
            /function renderMillerColumns[\s\S]*?innerHTML/
        );
        expect(renderSection).toBeTruthy();
        const section = renderSection![0];
        expect(section).toContain('renderColumn');
    });

    it('adds preview column when openFilePath is set', () => {
        const renderSection = script.match(
            /function renderMillerColumns[\s\S]*?innerHTML/
        );
        expect(renderSection).toBeTruthy();
        const section = renderSection![0];
        expect(section).toContain('miller-preview-column');
        expect(section).toContain('openFilePath');
    });

    it('scrolls to rightmost column after render', () => {
        expect(script).toContain('scrollLeft');
        expect(script).toContain('scrollWidth');
    });
});

// ============================================================================
// Folder click handler — clears openFilePath
// ============================================================================

describe('Folder click handler — state management', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('clears openFilePath on folder click', () => {
        // Folder click should set openFilePath = null
        const folderClickSection = script.match(
            /data-nav-folder[\s\S]{0,500}?renderMillerColumns/
        );
        expect(folderClickSection).toBeTruthy();
        const section = folderClickSection![0];
        expect(section).toContain('openFilePath');
    });

    it('updates __navPath on folder click', () => {
        const folderClickSection = script.match(
            /data-nav-folder[\s\S]{0,500}?renderMillerColumns/
        );
        expect(folderClickSection).toBeTruthy();
        const section = folderClickSection![0];
        expect(section).toContain("__navPath");
    });

    it('calls clearSelection on folder click', () => {
        const folderClickSection = script.match(
            /data-nav-folder[\s\S]{0,500}?renderMillerColumns/
        );
        expect(folderClickSection).toBeTruthy();
        const section = folderClickSection![0];
        expect(section).toContain('clearSelection');
    });

    it('re-renders columns after folder click', () => {
        const folderClickSection = script.match(
            /data-nav-folder[\s\S]{0,500}?renderMillerColumns/
        );
        expect(folderClickSection).toBeTruthy();
        const section = folderClickSection![0];
        expect(section).toContain('renderMillerColumns');
    });
});

// ============================================================================
// closeTaskPreview — cleanup
// ============================================================================

describe('closeTaskPreview — state cleanup', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines closeTaskPreview function', () => {
        expect(script).toContain('closeTaskPreview');
    });

    it('clears openFilePath on close', () => {
        const closeSection = script.match(
            /closeTaskPreview[\s\S]*?renderMillerColumns/
        );
        expect(closeSection).toBeTruthy();
        const section = closeSection![0];
        expect(section).toContain('openFilePath');
    });

    it('re-renders columns after closing preview', () => {
        const closeSection = script.match(
            /closeTaskPreview[\s\S]*?renderMillerColumns/
        );
        expect(closeSection).toBeTruthy();
    });
});

// ============================================================================
// Integration: file click + openTaskFile coordination
// ============================================================================

describe('File click + openTaskFile coordination', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('click handler sets navPath BEFORE calling openTaskFile', () => {
        // The order matters: navPath must be set before openTaskFile
        // so that if openTaskFile does a full re-render, columns are correct
        const fileClickSection = script.match(
            /data-file-path[\s\S]{0,1000}?return;\s*\}/
        );
        expect(fileClickSection).toBeTruthy();
        const section = fileClickSection![0];
        const navPathIdx = section.indexOf('__navPath');
        const openTaskIdx = section.indexOf('openTaskFile');
        expect(navPathIdx).toBeGreaterThan(-1);
        expect(openTaskIdx).toBeGreaterThan(-1);
        expect(navPathIdx).toBeLessThan(openTaskIdx);
    });

    it('openTaskFile checks for existing preview column', () => {
        const openTaskFileSection = script.match(
            /function openTaskFile[\s\S]*?renderMillerColumns/
        );
        expect(openTaskFileSection).toBeTruthy();
        const section = openTaskFileSection![0];
        expect(section).toContain('miller-preview-column');
    });

    it('openTaskFile updates hash for URL routing', () => {
        const openTaskFileSection = script.match(
            /function openTaskFile[\s\S]*?renderMillerColumns/
        );
        expect(openTaskFileSection).toBeTruthy();
        const section = openTaskFileSection![0];
        expect(section).toContain('updateTaskHash');
    });
});
