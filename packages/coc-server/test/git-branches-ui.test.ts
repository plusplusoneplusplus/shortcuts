import { describe, it, expect } from 'vitest';
import { generateSpaHtml } from '../src/wiki/spa/html-template';

describe('SPA HTML template — git branches page', () => {
    const baseOptions = {
        theme: 'auto' as const,
        title: 'Test Wiki',
        enableSearch: true,
        enableAI: false,
        enableGraph: true,
    };

    it('should include git-branches-page div in generated HTML', () => {
        const html = generateSpaHtml(baseOptions);
        expect(html).toContain('id="git-branches-page"');
        expect(html).toContain('id="git-branches-back"');
        expect(html).toContain('id="git-branches-tabs"');
        expect(html).toContain('id="git-branches-tab-local"');
        expect(html).toContain('id="git-branches-tab-remote"');
        expect(html).toContain('id="git-branches-search"');
        expect(html).toContain('id="git-branches-table-container"');
        expect(html).toContain('id="git-branches-pagination"');
        expect(html).toContain('id="git-branch-status-banner"');
    });

    it('should inject workspaceId as null when not provided', () => {
        const html = generateSpaHtml(baseOptions);
        expect(html).toContain('workspaceId: null');
    });

    it('should inject workspaceId when provided', () => {
        const html = generateSpaHtml({ ...baseOptions, workspaceId: 'ws-123' });
        expect(html).toContain('workspaceId: "ws-123"');
    });

    it('should include workspaceId in JSON.stringify output when special chars are present', () => {
        const html = generateSpaHtml({ ...baseOptions, workspaceId: 'ws<test>' });
        // JSON.stringify will produce a valid JSON string — verify it's quoted
        expect(html).toContain('workspaceId: "ws');
    });

    it('should place git-branches-page after admin-page', () => {
        const html = generateSpaHtml(baseOptions);
        const adminIdx = html.indexOf('id="admin-page"');
        const gitIdx = html.indexOf('id="git-branches-page"');
        expect(adminIdx).toBeGreaterThan(-1);
        expect(gitIdx).toBeGreaterThan(adminIdx);
    });

    it('should have git-branches-page initially hidden', () => {
        const html = generateSpaHtml(baseOptions);
        // The div should have class="admin-page hidden"
        const match = html.match(/<div[^>]*id="git-branches-page"[^>]*>/);
        expect(match).not.toBeNull();
        expect(match![0]).toContain('hidden');
    });
});

describe('git-branches module exports', () => {
    it('should export showGitBranches and setupGitBranchesListeners as functions', async () => {
        // Import the source module — it will fail to access DOM/window but we can
        // verify the exports exist by catching the runtime error and checking the
        // module shape. Since the module reads window.__WIKI_CONFIG__ at top level,
        // we need to provide a minimal stub.
        const origWindow = globalThis.window;
        try {
            // Provide minimal stubs for the browser globals the module expects
            (globalThis as any).window = { __WIKI_CONFIG__: { workspaceId: null } };
            (globalThis as any).document = { getElementById: () => null };
            (globalThis as any).history = { pushState: () => {} };
            (globalThis as any).location = { pathname: '/' };

            const mod = await import('../src/wiki/spa/client/git-branches');
            expect(typeof mod.showGitBranches).toBe('function');
            expect(typeof mod.setupGitBranchesListeners).toBe('function');
        } finally {
            if (origWindow !== undefined) {
                (globalThis as any).window = origWindow;
            } else {
                delete (globalThis as any).window;
            }
            delete (globalThis as any).document;
            delete (globalThis as any).history;
            delete (globalThis as any).location;
        }
    });
});
