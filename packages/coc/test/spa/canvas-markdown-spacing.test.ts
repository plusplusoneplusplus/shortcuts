/**
 * Regression test: the canvas markdown preview (.canvas-mermaid-preview)
 * must share the semantic-HTML block spacing rules that chat messages get,
 * otherwise headings/paragraphs/lists/tables render tightly packed with no
 * vertical spacing between blocks.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const css = readFileSync(
    resolve(__dirname, '../../src/server/spa/client/tailwind.css'),
    'utf-8',
);

/** Return the bodies of all rules whose selector list includes `selector`. */
function ruleBodiesFor(selector: string): string[] {
    const bodies: string[] = [];
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`[^{}]*${escaped}\\s*[^{}]*\\{([^}]*)\\}`, 'g');
    for (const match of css.matchAll(re)) {
        // Only count it when the selector appears in the selector list part.
        const selectorList = match[0].slice(0, match[0].indexOf('{'));
        if (selectorList.includes(selector)) bodies.push(match[1]);
    }
    return bodies;
}

function hasVerticalSpacing(bodies: string[]): boolean {
    return bodies.some(b => /margin(-top|-bottom)?\s*:/.test(b));
}

describe('canvas markdown preview block spacing', () => {
    it.each(['h1', 'h2', 'h3', 'p', 'ul', 'ol', 'li', 'table', 'blockquote', 'hr'])(
        'styles .canvas-mermaid-preview .markdown-body %s with vertical margin',
        tag => {
            const bodies = ruleBodiesFor(`.canvas-mermaid-preview .markdown-body ${tag}`);
            expect(bodies.length).toBeGreaterThan(0);
            expect(hasVerticalSpacing(bodies)).toBe(true);
        },
    );

    it('keeps canvas spacing in sync with chat message spacing for paragraphs', () => {
        // The canvas selector must live in the same rule as the chat selector so
        // the two surfaces cannot drift apart silently.
        const paragraphRule = css.match(
            /\.chat-message-content \.markdown-body p,\s*\.canvas-mermaid-preview \.markdown-body p\s*\{([^}]*)\}/,
        );
        expect(paragraphRule).toBeTruthy();
        expect(paragraphRule![1]).toContain('margin');
    });

    it('has dark-mode heading colors for the canvas preview', () => {
        expect(css).toContain('.dark .canvas-mermaid-preview .markdown-body h1');
    });
});
