/**
 * Tests for ActivityChatDetail pop-out button and ActivityDetailPane pop-out placeholder.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPOS_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos'
);
const CONTEXT_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'context'
);

const CHAT_DETAIL_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'ActivityChatDetail.tsx'), 'utf-8');
const DETAIL_PANE_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'ActivityDetailPane.tsx'), 'utf-8');
const POPOUT_CONTEXT_SOURCE = fs.readFileSync(path.join(CONTEXT_DIR, 'PopOutContext.tsx'), 'utf-8');
const CHAT_HEADER_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'ChatHeader.tsx'), 'utf-8');

const HOOKS_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'hooks'
);
const CHAT_WINDOW_ACTIONS_SOURCE = fs.readFileSync(path.join(HOOKS_DIR, 'useChatWindowActions.ts'), 'utf-8');

// ── ActivityChatDetail pop-out button ─────────────────────────────────────────

describe('ActivityChatDetail: pop-out button', () => {
    it('accepts isPopOut prop', () => {
        expect(CHAT_DETAIL_SOURCE).toContain('isPopOut');
    });

    it('renders a pop-out button with correct data-testid', () => {
        expect(CHAT_HEADER_SOURCE).toContain('data-testid="activity-chat-popout-btn"');
    });

    it('hides pop-out button when isPopOut is true', () => {
        expect(CHAT_HEADER_SOURCE).toContain('!isPopOut');
    });

    it('hides pop-out button on mobile', () => {
        expect(CHAT_HEADER_SOURCE).toContain('!isMobile');
    });

    it('hides pop-out button when variant is floating', () => {
        // The pop-out guard must include variant !== 'floating'
        const popoutBtnIdx = CHAT_HEADER_SOURCE.indexOf('activity-chat-popout-btn');
        // Find the render guard preceding the popout button
        const guardRegion = CHAT_HEADER_SOURCE.slice(Math.max(0, popoutBtnIdx - 200), popoutBtnIdx);
        expect(guardRegion).toContain("variant !== 'floating'");
    });

    it('uses usePopOut context', () => {
        expect(CHAT_WINDOW_ACTIONS_SOURCE).toContain('usePopOut');
    });

    it('uses useGlobalToast for popup-blocked notification', () => {
        expect(CHAT_WINDOW_ACTIONS_SOURCE).toContain('ToastContext');
    });

    it('calls window.open with popout route', () => {
        expect(CHAT_WINDOW_ACTIONS_SOURCE).toContain('window.open');
        expect(CHAT_WINDOW_ACTIONS_SOURCE).toContain('#popout/activity/');
    });

    it('marks task as popped out after successful window.open', () => {
        expect(CHAT_WINDOW_ACTIONS_SOURCE).toContain('markPoppedOut(taskId)');
    });

    it('shows a toast when popup is blocked', () => {
        expect(CHAT_WINDOW_ACTIONS_SOURCE).toContain('addToast');
        expect(CHAT_WINDOW_ACTIONS_SOURCE).toContain('blocked');
    });

    it('uses window name based on taskId to avoid duplicate popups', () => {
        expect(CHAT_WINDOW_ACTIONS_SOURCE).toContain('coc-popout-');
    });

    it('encodes workspaceId in query param', () => {
        expect(CHAT_WINDOW_ACTIONS_SOURCE).toContain('workspace=');
    });
});

// ── ActivityDetailPane pop-out placeholder ────────────────────────────────────

describe('ActivityDetailPane: pop-out placeholder', () => {
    it('imports usePopOut context', () => {
        expect(DETAIL_PANE_SOURCE).toContain("import { usePopOut }");
    });

    it('uses poppedOutTasks from PopOut context', () => {
        expect(DETAIL_PANE_SOURCE).toContain('poppedOutTasks');
    });

    it('checks if selected task is popped out', () => {
        expect(DETAIL_PANE_SOURCE).toContain('poppedOutTasks.has(selectedTaskId)');
    });

    it('renders pop-out placeholder with data-testid', () => {
        expect(DETAIL_PANE_SOURCE).toContain('data-testid="activity-popped-out-placeholder"');
    });

    it('renders restore button with data-testid', () => {
        expect(DETAIL_PANE_SOURCE).toContain('data-testid="activity-chat-restore-btn"');
    });

    it('calls markRestored on restore button click', () => {
        expect(DETAIL_PANE_SOURCE).toContain('markRestored(selectedTaskId)');
    });

    it('shows "Chat is open in a separate window" message', () => {
        expect(DETAIL_PANE_SOURCE).toContain('Chat is open in a separate window');
    });

    it('renders ActivityChatDetail when task is not popped out', () => {
        expect(DETAIL_PANE_SOURCE).toContain('<ActivityChatDetail');
    });
});

// ── PopOutContext structure ────────────────────────────────────────────────────

describe('PopOutContext: structure', () => {
    it('exports PopOutProvider component', () => {
        expect(POPOUT_CONTEXT_SOURCE).toContain('export function PopOutProvider');
    });

    it('exports usePopOut hook', () => {
        expect(POPOUT_CONTEXT_SOURCE).toContain('export function usePopOut');
    });

    it('exports PopOutContextValue interface', () => {
        expect(POPOUT_CONTEXT_SOURCE).toContain('export interface PopOutContextValue');
    });

    it('tracks poppedOutTasks as a Set', () => {
        expect(POPOUT_CONTEXT_SOURCE).toContain('poppedOutTasks: Set<string>');
    });

    it('exposes markPoppedOut method', () => {
        expect(POPOUT_CONTEXT_SOURCE).toContain('markPoppedOut');
    });

    it('exposes markRestored method', () => {
        expect(POPOUT_CONTEXT_SOURCE).toContain('markRestored');
    });

    it('listens for popout-closed to auto-restore', () => {
        expect(POPOUT_CONTEXT_SOURCE).toContain("msg.type === 'popout-closed'");
        expect(POPOUT_CONTEXT_SOURCE).toContain("MARK_RESTORED");
    });

    it('sends popout-restore when markRestored is called', () => {
        expect(POPOUT_CONTEXT_SOURCE).toContain("'popout-restore'");
    });
});
