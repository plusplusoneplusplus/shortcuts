/**
 * Tests for RepoChatTab chat-input mobile fixes:
 *  - Bottom padding on input container to clear BottomNav (Fix 1)
 *  - Virtual-keyboard dynamic padding via useVisualViewport (Fix 2)
 *  - Scroll-into-view on textarea focus on mobile (Fix 3)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_CHAT_TAB_PATH = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoChatTab.tsx');
const CHAT_CONVERSATION_PANE_PATH = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'chat', 'ChatConversationPane.tsx');

const SRC = fs.readFileSync(REPO_CHAT_TAB_PATH, 'utf-8');
const CONVERSATION_PANE_SRC = fs.readFileSync(CHAT_CONVERSATION_PANE_PATH, 'utf-8');

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
        expect(CONVERSATION_PANE_SRC).toContain('keyboardHeight');
        expect(CONVERSATION_PANE_SRC).toContain('paddingBottom: keyboardHeight');
    });

    it('guards keyboard-height padding behind isMobile check', () => {
        expect(CONVERSATION_PANE_SRC).toContain('isMobile && keyboardHeight > 0');
    });
});

describe('RepoChatTab chat-input-fix: static bottom padding (Fix 1)', () => {
    it('input container uses plain className without mobile pb override (outer shell provides nav clearance)', () => {
        expect(CONVERSATION_PANE_SRC).toContain('className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3 space-y-2"');
    });

    it('does NOT add pb-[calc(0.75rem+56px)] on mobile (outer RepoDetail pb-14 already clears BottomNav)', () => {
        expect(CONVERSATION_PANE_SRC).not.toContain('isMobile && "pb-[calc(0.75rem+56px)]"');
    });
});

describe('RepoChatTab chat-input-fix: scroll-into-view on focus (Fix 3)', () => {
    it('adds onFocus handler to follow-up textarea', () => {
        expect(CONVERSATION_PANE_SRC).toContain('onFocus={isMobile');
    });

    it('calls scrollIntoView with smooth behavior on mobile focus', () => {
        expect(CONVERSATION_PANE_SRC).toContain("scrollIntoView({ behavior: 'smooth', block: 'nearest' })");
    });

    it('onFocus handler is only applied on mobile', () => {
        // Pattern: onFocus={isMobile ? e => e.currentTarget.scrollIntoView(...) : undefined}
        expect(CONVERSATION_PANE_SRC).toMatch(/onFocus=\{isMobile \? .+ : undefined\}/);
    });
});
