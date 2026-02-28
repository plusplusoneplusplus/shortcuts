/**
 * Tests for the chat-bubble-scoped markdown border CSS rules.
 * Verifies that .chat-message-content .markdown-body gets border/padding/background
 * in both light and dark modes, and that base .markdown-body is unaffected.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const css = readFileSync(
    resolve(__dirname, '../../src/server/spa/client/tailwind.css'),
    'utf-8',
);

describe('chat-message-content .markdown-body border styles', () => {
    it('defines light-mode border rule scoped to .chat-message-content', () => {
        expect(css).toContain('.chat-message-content .markdown-body');
        // Verify key properties exist in the light-mode rule
        const lightRule = css.match(
            /\.chat-message-content\s+\.markdown-body\s*\{([^}]+)\}/,
        );
        expect(lightRule).toBeTruthy();
        const body = lightRule![1];
        expect(body).toContain('border:');
        expect(body).toContain('border-radius:');
        expect(body).toContain('padding:');
        expect(body).toContain('background:');
    });

    it('defines dark-mode border rule scoped to .chat-message-content', () => {
        const darkRule = css.match(
            /\.dark\s+\.chat-message-content\s+\.markdown-body\s*\{([^}]+)\}/,
        );
        expect(darkRule).toBeTruthy();
        const body = darkRule![1];
        expect(body).toContain('border-color:');
        expect(body).toContain('background:');
    });

    it('does not alter the base .markdown-body rule (no border)', () => {
        // The base .markdown-body rule should NOT contain border properties.
        // Match the standalone rule (not preceded by .chat-message-content).
        const baseRuleMatch = css.match(
            /(?<!\.\S+\s)\.markdown-body\s*\{([^}]+)\}/,
        );
        expect(baseRuleMatch).toBeTruthy();
        const body = baseRuleMatch![1];
        expect(body).not.toContain('border:');
        expect(body).not.toContain('border-radius:');
    });
});
