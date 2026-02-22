/**
 * Tests that in-article anchor links (e.g. Table of Contents) scroll to the
 * target heading instead of replacing the hash route in the CoC SPA.
 *
 * The SPA uses hash-based routing (/#/wiki/...). Without interception,
 * clicking <a href="#purpose--scope"> would navigate to /#purpose--scope,
 * breaking the route. The fix adds a delegated click handler on the content
 * container that calls scrollIntoView instead.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => 'http://localhost:4000/api',
    getDashboardConfig: () => ({ apiBase: 'http://localhost:4000/api' }),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useMermaid', () => ({
    useMermaid: vi.fn(),
}));

import { WikiComponent } from '../../../src/server/spa/client/react/wiki/WikiComponent';
import { fetchApi } from '../../../src/server/spa/client/react/hooks/useApi';

const mockFetchApi = vi.mocked(fetchApi);

const MARKDOWN_WITH_TOC = [
    '# Ai Service',
    '',
    '## Table of Contents',
    '- [Purpose & Scope](#purpose--scope)',
    '- [Architecture](#architecture)',
    '',
    '## Purpose & Scope',
    'This component manages AI tasks.',
    '',
    '## Architecture',
    'Uses a queue-based design.',
].join('\n');

const GRAPH = {
    components: [
        {
            id: 'src-shortcuts-ai-service',
            name: 'Ai Service',
            path: 'src/shortcuts/ai-service',
            purpose: 'Manages AI tasks',
            category: 'AI Processing',
            complexity: 'high' as const,
            keyFiles: [],
            dependencies: [],
            dependents: [],
        },
    ],
    categories: [{ id: 'ai-processing', name: 'AI Processing' }],
    project: { name: 'shortcuts', description: 'VS Code extension' },
};

function fakeMarkedParse(md: string): string {
    return md
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/^(?!<)(.+)$/gm, '<p>$1</p>');
}

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchApi.mockReset();

    (globalThis as any).marked = { parse: fakeMarkedParse };
    (globalThis as any).hljs = undefined;
    (globalThis as any).CSS = { escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '\\$&') };
});

afterEach(() => {
    delete (globalThis as any).marked;
    delete (globalThis as any).hljs;
});

function renderWikiComponent() {
    return render(
        <WikiComponent
            wikiId="wiki-test123"
            componentId="src-shortcuts-ai-service"
            graph={GRAPH}
        />
    );
}

function getInArticleTocLink(href: string): HTMLAnchorElement | null {
    const wikiBody = document.querySelector('.wiki-body');
    if (!wikiBody) return null;
    return wikiBody.querySelector(`a[href="${href}"]`);
}

describe('WikiComponent in-article anchor click interception', () => {
    it('prevents default navigation on hash-only anchor clicks', async () => {
        mockFetchApi.mockResolvedValueOnce({ markdown: MARKDOWN_WITH_TOC });
        renderWikiComponent();

        await waitFor(() => {
            expect(getInArticleTocLink('#purpose--scope')).toBeTruthy();
        });

        const tocLink = getInArticleTocLink('#purpose--scope')!;
        expect(tocLink.textContent).toBe('Purpose & Scope');

        const scrollIntoViewMock = vi.fn();
        const headingEl = document.getElementById('purpose--scope');
        expect(headingEl).toBeTruthy();
        headingEl!.scrollIntoView = scrollIntoViewMock;

        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
        tocLink.dispatchEvent(event);

        expect(preventDefaultSpy).toHaveBeenCalled();
        expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    });

    it('heading IDs use GitHub-style slugification preserving consecutive dashes', async () => {
        mockFetchApi.mockResolvedValueOnce({ markdown: MARKDOWN_WITH_TOC });
        renderWikiComponent();

        await waitFor(() => {
            expect(document.getElementById('purpose--scope')).toBeTruthy();
        });

        expect(document.getElementById('purpose--scope')).toBeTruthy();
        expect(document.getElementById('architecture')).toBeTruthy();
        expect(document.getElementById('ai-service')).toBeTruthy();
    });

    it('does not intercept non-hash links', async () => {
        const mdWithExternalLink = '# Title\n\n[External](https://example.com)';
        mockFetchApi.mockResolvedValueOnce({ markdown: mdWithExternalLink });
        renderWikiComponent();

        await waitFor(() => {
            expect(screen.getByText('External')).toBeTruthy();
        });

        const link = screen.getByText('External');
        expect(link.getAttribute('href')).toBe('https://example.com');

        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
        link.dispatchEvent(event);

        expect(preventDefaultSpy).not.toHaveBeenCalled();
    });

    it('does not intercept bare # links', async () => {
        const mdWithBareHash = '# Title\n\n[Top](#)';
        mockFetchApi.mockResolvedValueOnce({ markdown: mdWithBareHash });
        renderWikiComponent();

        await waitFor(() => {
            expect(screen.getByText('Top')).toBeTruthy();
        });

        const link = screen.getByText('Top');
        expect(link.getAttribute('href')).toBe('#');

        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
        link.dispatchEvent(event);

        expect(preventDefaultSpy).not.toHaveBeenCalled();
    });

    it('does not intercept when target heading does not exist', async () => {
        const mdWithBadAnchor = '# Title\n\n[Missing](#nonexistent-heading)';
        mockFetchApi.mockResolvedValueOnce({ markdown: mdWithBadAnchor });
        renderWikiComponent();

        await waitFor(() => {
            expect(screen.getByText('Missing')).toBeTruthy();
        });

        const link = screen.getByText('Missing');
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
        link.dispatchEvent(event);

        expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
});

describe('WikiComponent source code verification', () => {
    it('contains delegated click handler for anchor interception', () => {
        const { readFileSync } = require('fs');
        const { resolve } = require('path');
        const tsxPath = resolve(
            __dirname,
            '../../../src/server/spa/client/react/wiki/WikiComponent.tsx',
        );
        const tsx = readFileSync(tsxPath, 'utf-8');

        expect(tsx).toContain("addEventListener('click'");
        expect(tsx).toContain("closest('a')");
        expect(tsx).toContain("startsWith('#')");
        expect(tsx).toContain('scrollIntoView');
        expect(tsx).toContain('e.preventDefault()');
    });

    it('uses GitHub-style slug that preserves consecutive dashes', () => {
        const { readFileSync } = require('fs');
        const { resolve } = require('path');
        const tsxPath = resolve(
            __dirname,
            '../../../src/server/spa/client/react/wiki/WikiComponent.tsx',
        );
        const tsx = readFileSync(tsxPath, 'utf-8');

        expect(tsx).toContain("[^a-z0-9 -]");
        expect(tsx).toContain("/ /g, '-'");
    });

    it('sidebar TOC also uses scrollToHeading with preventDefault', () => {
        const { readFileSync } = require('fs');
        const { resolve } = require('path');
        const tsxPath = resolve(
            __dirname,
            '../../../src/server/spa/client/react/wiki/WikiComponent.tsx',
        );
        const tsx = readFileSync(tsxPath, 'utf-8');

        expect(tsx).toContain('scrollToHeading');
        expect(tsx).toContain('wiki-toc-sidebar');
    });
});
