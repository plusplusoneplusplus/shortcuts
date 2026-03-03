/**
 * Tests for RepoChatTab chat-input mobile fixes:
 *  - Bottom padding on input container to clear BottomNav (Fix 1)
 *  - Virtual-keyboard dynamic padding via useVisualViewport (Fix 2)
 *  - Scroll-into-view on textarea focus on mobile (Fix 3)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoChatTab.tsx'),
    'utf-8',
);

describe('RepoChatTab chat-input-fix: imports', () => {
    it('imports cn utility', () => {
        expect(SRC).toContain("import { cn } from '../shared/cn'");
    });

    it('imports useVisualViewport hook', () => {
        expect(SRC).toContain("import { useVisualViewport } from '../hooks/useVisualViewport'");
    });
});

describe('RepoChatTab chat-input-fix: useVisualViewport usage', () => {
    it('calls useVisualViewport and assigns result to keyboardHeight', () => {
        expect(SRC).toContain('const keyboardHeight = useVisualViewport()');
    });

    it('applies dynamic paddingBottom via keyboardHeight when on mobile', () => {
        expect(SRC).toContain('keyboardHeight');
        expect(SRC).toContain('paddingBottom: keyboardHeight');
    });

    it('guards keyboard-height padding behind isMobile check', () => {
        expect(SRC).toContain('isMobile && keyboardHeight > 0');
    });
});

describe('RepoChatTab chat-input-fix: static bottom padding (Fix 1)', () => {
    it('uses cn() for input container className', () => {
        expect(SRC).toContain('cn("border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3 space-y-2"');
    });

    it('adds pb-[calc(0.75rem+56px)] on mobile to clear BottomNav', () => {
        expect(SRC).toContain('isMobile && "pb-[calc(0.75rem+56px)]"');
    });
});

describe('RepoChatTab chat-input-fix: scroll-into-view on focus (Fix 3)', () => {
    it('adds onFocus handler to follow-up textarea', () => {
        expect(SRC).toContain('onFocus={isMobile');
    });

    it('calls scrollIntoView with smooth behavior on mobile focus', () => {
        expect(SRC).toContain("scrollIntoView({ behavior: 'smooth', block: 'nearest' })");
    });

    it('onFocus handler is only applied on mobile', () => {
        // Pattern: onFocus={isMobile ? e => e.currentTarget.scrollIntoView(...) : undefined}
        expect(SRC).toMatch(/onFocus=\{isMobile \? .+ : undefined\}/);
    });
});
