/**
 * Tests for RepoChatTab mobile conversation header responsiveness.
 *
 * Validates:
 * - Header uses flex-col on mobile to stack title row and action row
 * - Header uses flex-row with justify-between on desktop
 * - Action buttons row allows flex-wrap on mobile
 * - Model badge truncates on mobile instead of whitespace-nowrap
 * - Copy button has flex-shrink-0 to prevent collapse
 * - Header has chat-conversation-header test ID
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CHAT_CONVERSATION_PANE_PATH = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'chat', 'ChatConversationPane.tsx');

const SRC = fs.readFileSync(CHAT_CONVERSATION_PANE_PATH, 'utf-8');

describe('RepoChatTab mobile: conversation header layout', () => {
    it('header uses flex-col on mobile and flex-row justify-between on desktop', () => {
        expect(SRC).toContain('isMobile ? "flex flex-col gap-1.5" : "flex items-center justify-between"');
    });

    it('header has chat-conversation-header test ID', () => {
        expect(SRC).toContain('data-testid="chat-conversation-header"');
    });

    it('action buttons row uses flex-wrap on mobile', () => {
        expect(SRC).toContain('isMobile && "flex-wrap"');
    });
});

describe('RepoChatTab mobile: model badge truncation', () => {
    it('model badge uses truncate and max-w on mobile', () => {
        expect(SRC).toContain('isMobile ? "truncate max-w-[160px]" : "whitespace-nowrap"');
    });

    it('model badge has title attribute with full model name', () => {
        // title should show the full model name (not hardcoded text)
        expect(SRC).toContain('title={task.config?.model || task.metadata?.model}');
    });
});

describe('RepoChatTab mobile: copy button layout stability', () => {
    it('copy button has flex-shrink-0 to prevent collapsing', () => {
        // Extract the copy button section (includes className further down)
        const copyBtnIdx = SRC.indexOf('title="Copy conversation"');
        expect(copyBtnIdx).toBeGreaterThan(-1);
        const btnSection = SRC.substring(copyBtnIdx, copyBtnIdx + 800);
        expect(btnSection).toContain('flex-shrink-0');
    });
});

describe('RepoChatTab desktop: header unchanged', () => {
    it('still uses flex items-center justify-between on desktop', () => {
        expect(SRC).toContain('"flex items-center justify-between"');
    });

    it('model badge uses whitespace-nowrap on desktop', () => {
        expect(SRC).toContain('"whitespace-nowrap"');
    });
});
