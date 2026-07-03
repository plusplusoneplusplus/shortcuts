/**
 * Tests for the chat-message-content surface CSS rules after the chat redesign.
 *
 * Background:
 * Before the redesign, every `.chat-message-content .markdown-body` carried an
 * explicit border + white background to give the bubble a "card" feel. The new
 * design removes that inner border because:
 *   - User turns now use a soft-gray rounded bubble (`turn-bubble`) that
 *     supplies its own background; an inner border around the markdown would
 *     look like a nested box-in-box.
 *   - Assistant turns render as borderless flowing text next to a small avatar.
 *
 * These tests lock in the new contract (no inner border) and the parts of the
 * styling that survived (link hover cursor, base markdown body untouched).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const css = readFileSync(
    resolve(__dirname, '../../src/server/spa/client/tailwind.css'),
    'utf-8',
);

describe('chat-message-content .markdown-body redesign — no inner bubble border', () => {
    it('does NOT define a top-level border/background rule on `.chat-message-content .markdown-body`', () => {
        // Match a standalone selector "exactly `.chat-message-content .markdown-body`"
        // followed directly by a brace block. Compound selectors that drill into
        // descendants (e.g. ` h1`, ` code`, ` a`) are out of scope.
        const standaloneRule = css.match(
            /(^|\n)\s*\.chat-message-content\s+\.markdown-body\s*\{([^}]+)\}/,
        );
        if (standaloneRule) {
            const body = standaloneRule[2];
            // If a future regression re-adds the rule, fail loudly.
            expect(body).not.toContain('border:');
            expect(body).not.toContain('border-radius:');
            expect(body).not.toContain('padding:');
            expect(body).not.toContain('background:');
        } else {
            // Preferred state — the rule was removed entirely.
            expect(standaloneRule).toBeNull();
        }
    });

    it('does NOT define a dark-mode background/border rule on `.dark .chat-message-content .markdown-body`', () => {
        const standaloneDarkRule = css.match(
            /(^|\n)\s*\.dark\s+\.chat-message-content\s+\.markdown-body\s*\{([^}]+)\}/,
        );
        if (standaloneDarkRule) {
            const body = standaloneDarkRule[2];
            expect(body).not.toContain('border-color:');
            expect(body).not.toContain('background:');
        } else {
            expect(standaloneDarkRule).toBeNull();
        }
    });

    it('keeps the chat markdown link hover cursor (typography stayed intact)', () => {
        // The selector list may include other surfaces (e.g. the canvas
        // preview) that share the same typography rules.
        const linkHoverRule = css.match(
            /\.chat-message-content\s+\.markdown-body\s+a:hover\s*[^{}]*\{([^}]+)\}/,
        );
        expect(linkHoverRule).toBeTruthy();
        expect(linkHoverRule![1]).toContain('cursor: pointer');
    });

    it('does not alter the base .markdown-body rule (no border)', () => {
        // The base .markdown-body rule should not contain border properties.
        const baseRuleMatch = css.match(
            /(?<!\.\S+\s)\.markdown-body\s*\{([^}]+)\}/,
        );
        expect(baseRuleMatch).toBeTruthy();
        const body = baseRuleMatch![1];
        expect(body).not.toContain('border:');
        expect(body).not.toContain('border-radius:');
    });
});
