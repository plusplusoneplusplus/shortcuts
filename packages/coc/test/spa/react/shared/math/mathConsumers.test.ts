/**
 * Representative-consumer coverage for the Marked renderer family: verifies the
 * shared math extension is actually wired into a live consumer's public render
 * entry point, not just the standalone extension.
 */
import { describe, it, expect } from 'vitest';
import { renderAskUserMarkdown } from '../../../../../src/server/spa/client/react/features/chat/AskUserMarkdown';

describe('AskUserMarkdown consumer — math wiring', () => {
    it('renders inline math through the shared extension', () => {
        const html = renderAskUserMarkdown('when $x = y$ holds');
        expect(html).toContain('class="katex"');
        expect(html).toContain('<math');
    });

    it('renders display math', () => {
        const html = renderAskUserMarkdown('$$\\sum_{i=1}^n i$$');
        expect(html).toContain('katex-display');
    });

    it('still leaves currency literal in the consumer', () => {
        const html = renderAskUserMarkdown('pay $5 now');
        expect(html).not.toContain('class="katex"');
        expect(html).toContain('$5');
    });

    it('preserves existing markdown (headings, code) alongside math', () => {
        const html = renderAskUserMarkdown('# Title\n\nedge case $a$\n\n`plain $b$ code`');
        expect(html).toContain('<h1');
        // math in prose renders...
        expect(html).toContain('class="katex"');
        // ...but math inside inline code stays literal.
        expect(html).toContain('$b$');
    });
});
