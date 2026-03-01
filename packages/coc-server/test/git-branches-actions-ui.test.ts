import { describe, it, expect } from 'vitest';
import { generateSpaHtml } from '../src/wiki/spa/html-template';

const baseOptions = {
    theme: 'auto' as const,
    title: 'Test Wiki',
    enableSearch: true,
    enableAI: false,
    enableGraph: true,
};

describe('SPA HTML template — branch action buttons', () => {
    it('should include page-level action buttons', () => {
        const html = generateSpaHtml(baseOptions);
        expect(html).toContain('id="git-branch-actions"');
        expect(html).toContain('id="git-branch-btn-create"');
        expect(html).toContain('id="git-branch-btn-push"');
        expect(html).toContain('id="git-branch-btn-pull"');
        expect(html).toContain('id="git-branch-btn-fetch"');
        expect(html).toContain('id="git-branch-btn-stash"');
        expect(html).toContain('id="git-branch-btn-pop"');
        expect(html).toContain('id="git-branch-btn-merge"');
    });

    it('should place action buttons between status banner and tabs', () => {
        const html = generateSpaHtml(baseOptions);
        const bannerIdx = html.indexOf('id="git-branch-status-banner"');
        const actionsIdx = html.indexOf('id="git-branch-actions"');
        const tabsIdx = html.indexOf('id="git-branches-tabs"');
        expect(bannerIdx).toBeGreaterThan(-1);
        expect(actionsIdx).toBeGreaterThan(bannerIdx);
        expect(tabsIdx).toBeGreaterThan(actionsIdx);
    });

    it('should have Create Branch as primary button style', () => {
        const html = generateSpaHtml(baseOptions);
        const match = html.match(/<button[^>]*id="git-branch-btn-create"[^>]*>/);
        expect(match).not.toBeNull();
        expect(match![0]).toContain('admin-btn-save');
    });

    it('should have secondary style for other action buttons', () => {
        const html = generateSpaHtml(baseOptions);
        for (const id of ['git-branch-btn-push', 'git-branch-btn-pull', 'git-branch-btn-fetch', 'git-branch-btn-stash', 'git-branch-btn-pop', 'git-branch-btn-merge']) {
            const re = new RegExp(`<button[^>]*id="${id}"[^>]*>`);
            const match = html.match(re);
            expect(match).not.toBeNull();
            expect(match![0]).toContain('admin-btn-reset');
        }
    });
});

describe('SPA HTML template — modal overlay and dialogs', () => {
    it('should include the modal overlay', () => {
        const html = generateSpaHtml(baseOptions);
        expect(html).toContain('id="git-branch-modal-overlay"');
        expect(html).toContain('id="git-branch-modal-container"');
    });

    it('should have modal overlay initially hidden', () => {
        const html = generateSpaHtml(baseOptions);
        const match = html.match(/<div[^>]*id="git-branch-modal-overlay"[^>]*>/);
        expect(match).not.toBeNull();
        expect(match![0]).toContain('hidden');
    });

    it('should include create branch dialog with all elements', () => {
        const html = generateSpaHtml(baseOptions);
        expect(html).toContain('id="git-branch-dialog-create"');
        expect(html).toContain('id="git-branch-create-name"');
        expect(html).toContain('id="git-branch-create-checkout"');
        expect(html).toContain('id="git-branch-create-submit"');
        expect(html).toContain('id="git-branch-create-cancel"');
        expect(html).toContain('id="git-branch-create-status"');
    });

    it('should include rename branch dialog with all elements', () => {
        const html = generateSpaHtml(baseOptions);
        expect(html).toContain('id="git-branch-dialog-rename"');
        expect(html).toContain('id="git-branch-rename-old"');
        expect(html).toContain('id="git-branch-rename-new"');
        expect(html).toContain('id="git-branch-rename-submit"');
        expect(html).toContain('id="git-branch-rename-cancel"');
        expect(html).toContain('id="git-branch-rename-status"');
    });

    it('should include delete branch dialog with all elements', () => {
        const html = generateSpaHtml(baseOptions);
        expect(html).toContain('id="git-branch-dialog-delete"');
        expect(html).toContain('id="git-branch-delete-name"');
        expect(html).toContain('id="git-branch-delete-force"');
        expect(html).toContain('id="git-branch-delete-confirm"');
        expect(html).toContain('id="git-branch-delete-cancel"');
        expect(html).toContain('id="git-branch-delete-status"');
    });

    it('should have delete confirm button with danger style', () => {
        const html = generateSpaHtml(baseOptions);
        const match = html.match(/<button[^>]*id="git-branch-delete-confirm"[^>]*>/);
        expect(match).not.toBeNull();
        expect(match![0]).toContain('admin-btn-danger');
    });

    it('should include merge branch dialog with all elements', () => {
        const html = generateSpaHtml(baseOptions);
        expect(html).toContain('id="git-branch-dialog-merge"');
        expect(html).toContain('id="git-branch-merge-source"');
        expect(html).toContain('id="git-branch-merge-submit"');
        expect(html).toContain('id="git-branch-merge-cancel"');
        expect(html).toContain('id="git-branch-merge-status"');
    });

    it('should have all dialogs initially hidden', () => {
        const html = generateSpaHtml(baseOptions);
        for (const id of ['git-branch-dialog-create', 'git-branch-dialog-rename', 'git-branch-dialog-delete', 'git-branch-dialog-merge']) {
            const re = new RegExp(`<div[^>]*id="${id}"[^>]*>`);
            const match = html.match(re);
            expect(match).not.toBeNull();
            expect(match![0]).toContain('hidden');
        }
    });

    it('should have dialog status divs with admin-file-status class', () => {
        const html = generateSpaHtml(baseOptions);
        for (const id of ['git-branch-create-status', 'git-branch-rename-status', 'git-branch-delete-status', 'git-branch-merge-status']) {
            const re = new RegExp(`<div[^>]*id="${id}"[^>]*class="admin-file-status"[^>]*>`);
            const match = html.match(re);
            expect(match).not.toBeNull();
        }
    });
});

describe('SPA HTML template — toast container', () => {
    it('should include the toast container', () => {
        const html = generateSpaHtml(baseOptions);
        expect(html).toContain('id="git-toast-container"');
    });

    it('should have toast container with fixed position and high z-index', () => {
        const html = generateSpaHtml(baseOptions);
        const match = html.match(/<div[^>]*id="git-toast-container"[^>]*>/);
        expect(match).not.toBeNull();
        expect(match![0]).toContain('position:fixed');
        expect(match![0]).toContain('z-index:2000');
    });
});

describe('SPA HTML template — CSS classes', () => {
    it('should include admin-btn-danger CSS in the bundled styles', async () => {
        // Read the CSS source directly to verify the new classes were added
        const fs = await import('fs');
        const path = await import('path');
        const css = fs.readFileSync(
            path.join(__dirname, '..', 'src', 'wiki', 'spa', 'client', 'styles.css'), 'utf-8'
        );
        expect(css).toContain('.admin-btn-danger');
        expect(css).toContain('.modal-title');
        expect(css).toContain('.admin-input');
        expect(css).toContain('.branch-row-actions');
    });
});

describe('SPA HTML template — structural integrity', () => {
    it('should place modal overlay inside git-branches-page', () => {
        const html = generateSpaHtml(baseOptions);
        const pageStart = html.indexOf('id="git-branches-page"');
        const overlayStart = html.indexOf('id="git-branch-modal-overlay"');
        // Find the closing div for git-branches-page (it ends before the toast container or next major section)
        expect(pageStart).toBeGreaterThan(-1);
        expect(overlayStart).toBeGreaterThan(pageStart);
    });

    it('should have toast container outside git-branches-page', () => {
        const html = generateSpaHtml(baseOptions);
        const toastIdx = html.indexOf('id="git-toast-container"');
        // Toast is after the git-branches-page closing div
        const pageCloseIdx = html.indexOf('</div>', html.indexOf('id="git-branch-dialog-merge"') + 200);
        expect(toastIdx).toBeGreaterThan(-1);
        expect(toastIdx).toBeGreaterThan(pageCloseIdx);
    });

    it('should place all dialog inputs as type=text or type=checkbox', () => {
        const html = generateSpaHtml(baseOptions);
        // Text inputs
        for (const id of ['git-branch-create-name', 'git-branch-rename-new', 'git-branch-merge-source']) {
            const re = new RegExp(`<input[^>]*id="${id}"[^>]*type="text"[^>]*>`);
            expect(html).toMatch(re);
        }
        // Checkbox inputs
        for (const id of ['git-branch-create-checkout', 'git-branch-delete-force']) {
            const re = new RegExp(`<input[^>]*id="${id}"[^>]*type="checkbox"[^>]*>`);
            expect(html).toMatch(re);
        }
    });

    it('should have admin-input class on text inputs', () => {
        const html = generateSpaHtml(baseOptions);
        for (const id of ['git-branch-create-name', 'git-branch-rename-new', 'git-branch-merge-source']) {
            const re = new RegExp(`<input[^>]*id="${id}"[^>]*class="admin-input"[^>]*>`);
            expect(html).toMatch(re);
        }
    });
});
