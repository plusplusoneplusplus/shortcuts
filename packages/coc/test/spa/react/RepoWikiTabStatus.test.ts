import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoWikiTab.tsx'),
    'utf-8',
);

describe('RepoWikiTab generation status', () => {
    it('renders generating banner with data-testid', () => {
        expect(SOURCE).toContain('data-testid="wiki-generating-banner"');
    });

    it('generating banner shows progress message', () => {
        expect(SOURCE).toContain('Wiki generation in progress');
    });

    it('renders error banner with data-testid', () => {
        expect(SOURCE).toContain('data-testid="wiki-error-banner"');
    });

    it('error banner includes retry button', () => {
        expect(SOURCE).toContain('data-testid="wiki-retry-btn"');
    });

    it('retry button calls handleRetryGeneration', () => {
        expect(SOURCE).toContain('handleRetryGeneration');
    });

    it('retry navigates to wiki admin page with auto-generate', () => {
        expect(SOURCE).toContain('SET_WIKI_AUTO_GENERATE');
        expect(SOURCE).toContain("location.hash = '#wiki/'");
        expect(SOURCE).not.toContain('/api/dw/generate');
    });

    it('error banner displays wiki error message when available', () => {
        expect(SOURCE).toContain('selectedWiki.error');
    });
});
