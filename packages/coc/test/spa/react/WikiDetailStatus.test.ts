import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'wiki', 'WikiDetail.tsx'),
    'utf-8',
);

describe('WikiDetail generation status handling', () => {
    it('defines isGenerating derived from wikiStatus', () => {
        expect(SOURCE).toContain("wikiStatus === 'generating'");
    });

    it('disables non-admin tabs when generating', () => {
        expect(SOURCE).toContain("isGenerating && tab !== 'admin'");
    });

    it('applies opacity-50 and cursor-not-allowed to disabled tabs', () => {
        expect(SOURCE).toContain('opacity-50');
        expect(SOURCE).toContain('cursor-not-allowed');
    });

    it('shows generating placeholder message for disabled tabs', () => {
        expect(SOURCE).toContain('data-testid="wiki-generating-placeholder"');
        expect(SOURCE).toContain('Generation in progress');
    });

    it('auto-switches to admin tab when generation starts', () => {
        expect(SOURCE).toContain("wikiStatus === 'generating' && activeTab !== 'admin'");
    });

    it('admin tab remains clickable during generation', () => {
        expect(SOURCE).toContain("tab !== 'admin'");
    });
});
