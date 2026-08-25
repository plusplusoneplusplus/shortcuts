/**
 * Regression test: ask_user question markdown must wrap inside its card.
 * A long URL, a long unbroken token, a wide code block or an oversized image
 * would otherwise render past the bordered question card.
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
        const selectorList = match[0].slice(0, match[0].indexOf('{'));
        if (selectorList.includes(selector)) bodies.push(match[1]);
    }
    return bodies;
}

describe('ask-user markdown overflow containment', () => {
    it('breaks long words and URLs instead of widening the card', () => {
        const bodies = ruleBodiesFor('.ask-user-markdown');
        expect(bodies.some(body => /overflow-wrap:\s*(anywhere|break-word)/.test(body))).toBe(true);
    });

    it('lets the markdown block shrink inside its flex row', () => {
        const bodies = ruleBodiesFor('.ask-user-markdown');
        expect(bodies.some(body => /min-width:\s*0/.test(body))).toBe(true);
    });

    it('caps code blocks and images at the card width', () => {
        const preBodies = ruleBodiesFor('.ask-user-markdown pre');
        expect(preBodies.some(body => /max-width:\s*100%/.test(body))).toBe(true);
        // Code blocks keep their own horizontal scroll rather than pushing the card wider.
        expect(preBodies.some(body => /overflow-x:\s*auto/.test(body))).toBe(true);

        const imgBodies = ruleBodiesFor('.ask-user-markdown img');
        expect(imgBodies.some(body => /max-width:\s*100%/.test(body))).toBe(true);
    });
});
