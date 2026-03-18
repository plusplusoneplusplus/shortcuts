/**
 * Regression tests: mobile horizontal overflow fixes for ConversationArea and ActivityChatDetail.
 * Ensures overflow-x and min-w-0 constraints are in place to prevent content bleeding
 * beyond the viewport on small screens.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPOS_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos'
);
const CSS_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'tailwind.css'
);

const CONVERSATION_AREA_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'ConversationArea.tsx'), 'utf-8');
const ACTIVITY_CHAT_DETAIL_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'ActivityChatDetail.tsx'), 'utf-8');
const CSS_SOURCE = fs.readFileSync(CSS_PATH, 'utf-8');

// ── ConversationArea ──────────────────────────────────────────────────────────

describe('ConversationArea: mobile overflow', () => {
    it('outer container has overflow-x-hidden to prevent horizontal bleed', () => {
        expect(CONVERSATION_AREA_SOURCE).toContain('overflow-x-hidden');
    });

    it('outer container has min-w-0 so flex child can shrink', () => {
        // The outer container needs min-w-0 alongside overflow-x-hidden
        expect(CONVERSATION_AREA_SOURCE).toMatch(/overflow-x-hidden[^"]*min-w-0|min-w-0[^"]*overflow-x-hidden/);
    });

    it('scroll container has min-w-0 to avoid flex child overflow', () => {
        // The inner scrollable div must also carry min-w-0
        expect(CONVERSATION_AREA_SOURCE).toMatch(/overflow-y-auto[^"]*min-w-0|min-w-0[^"]*overflow-y-auto/);
    });
});

// ── ActivityChatDetail ────────────────────────────────────────────────────────

describe('ActivityChatDetail: mobile overflow', () => {
    it('conversation wrapper flex container has overflow-x-hidden', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toMatch(/relative flex-1 min-h-0 flex[^"]*overflow-x-hidden/);
    });

    it('conversation wrapper has min-w-0 to prevent flex child overflow', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toMatch(/relative flex-1 min-h-0 flex[^"]*min-w-0/);
    });
});

// ── CSS: table container ──────────────────────────────────────────────────────

describe('tailwind.css: md-table-container mobile', () => {
    it('does not use calc(100vw) for table max-width (causes overflow when nested)', () => {
        // Extract the .md-table-container rule block
        const tableMatch = CSS_SOURCE.match(/\.md-table-container\s*\{[^}]+\}/g);
        expect(tableMatch).not.toBeNull();
        const allRules = tableMatch!.join('\n');
        expect(allRules).not.toContain('100vw');
    });

    it('uses max-width: 100% for table container so it respects parent bounds', () => {
        const tableMatch = CSS_SOURCE.match(/\.md-table-container\s*\{[^}]+\}/g);
        expect(tableMatch).not.toBeNull();
        const allRules = tableMatch!.join('\n');
        expect(allRules).toContain('max-width: 100%');
    });
});
