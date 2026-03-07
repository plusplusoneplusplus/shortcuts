/**
 * Tests for RepoChatTab mobile two-level navigation.
 *
 * Validates:
 * - Chat tab uses mobileShowDetail state for two-level nav (list vs detail)
 * - "← Back" button in conversation header and start screen on mobile
 * - Session selection sets mobileShowDetail(true)
 * - New chat sets mobileShowDetail(true)
 * - Deep-link sets mobileShowDetail(true)
 * - Desktop layout is unchanged (sidebar + conversation side-by-side)
 * - No ResponsiveSidebar or hamburger menu in chat
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_CHAT_TAB_PATH = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoChatTab.tsx');
const CHAT_START_PANE_PATH = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'chat', 'ChatStartPane.tsx');
const CHAT_CONVERSATION_PANE_PATH = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'chat', 'ChatConversationPane.tsx');

const REPO_CHAT_TAB_SOURCE = fs.readFileSync(REPO_CHAT_TAB_PATH, 'utf-8');
const START_PANE_SOURCE = fs.readFileSync(CHAT_START_PANE_PATH, 'utf-8');
const CONVERSATION_PANE_SOURCE = fs.readFileSync(CHAT_CONVERSATION_PANE_PATH, 'utf-8');

describe('RepoChatTab mobile: two-level nav state', () => {
    it('has mobileShowDetail state (not mobileSidebarOpen)', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('const [mobileShowDetail, setMobileShowDetail] = useState(false)');
        expect(REPO_CHAT_TAB_SOURCE).not.toContain('mobileSidebarOpen');
    });

    it('destructures isMobile from useBreakpoint', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('const { isMobile } = useBreakpoint()');
    });
});

describe('RepoChatTab mobile: no ResponsiveSidebar or hamburger', () => {
    it('does not import ResponsiveSidebar', () => {
        expect(REPO_CHAT_TAB_SOURCE).not.toContain('ResponsiveSidebar');
    });

    it('does not render hamburger icon', () => {
        expect(REPO_CHAT_TAB_SOURCE).not.toContain('☰');
    });

    it('does not have chat-mobile-sessions-btn test IDs', () => {
        expect(REPO_CHAT_TAB_SOURCE).not.toContain('chat-mobile-sessions-btn');
    });
});

describe('RepoChatTab mobile: two-level conditional render', () => {
    it('renders mobile list vs detail based on mobileShowDetail', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('mobileShowDetail ?');
    });

    it('renders chat-mobile-list test ID for the list view', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('data-testid="chat-mobile-list"');
    });

    it('has early return for mobile layout (separate from desktop)', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('if (isMobile) {');
    });

    it('sidebar content is extracted into sidebarContent variable', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('const sidebarContent = (');
    });

    it('sidebar uses h-full class on mobile', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain("isMobile ? 'h-full'");
    });

    it('sidebar uses w-80 flex-shrink-0 on desktop', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain("w-80 flex-shrink-0 border-r");
    });
});

describe('RepoChatTab mobile: back button', () => {
    it('renders back button with chat-detail-back-btn test ID', () => {
        expect(CONVERSATION_PANE_SOURCE).toContain('data-testid="chat-detail-back-btn"');
    });

    it('back button calls setMobileShowDetail(false)', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('onMobileBack={isMobile ? () => setMobileShowDetail(false) : undefined}');
    });

    it('back button shows ← Back text', () => {
        expect(CONVERSATION_PANE_SOURCE).toContain('← Back');
    });

    it('back button is only shown on mobile', () => {
        expect(CONVERSATION_PANE_SOURCE).toContain('isMobile && onMobileBack &&');
        expect(CONVERSATION_PANE_SOURCE).toContain('chat-detail-back-btn');
    });

    it('back button styled consistently with queue detail back button', () => {
        expect(CONVERSATION_PANE_SOURCE).toContain('text-[#0078d4]');
        expect(CONVERSATION_PANE_SOURCE).toContain('hover:text-[#005a9e]');
    });
});

describe('RepoChatTab mobile: session selection sets detail view', () => {
    it('handleSelectSession calls setMobileShowDetail(true) on mobile', () => {
        const handler = REPO_CHAT_TAB_SOURCE.substring(
            REPO_CHAT_TAB_SOURCE.indexOf('const handleSelectSession'),
            REPO_CHAT_TAB_SOURCE.indexOf('const handleNewChat')
        );
        expect(handler).toContain('if (isMobile) setMobileShowDetail(true)');
    });
});

describe('RepoChatTab mobile: new chat navigates to detail', () => {
    it('handleNewChat calls setMobileShowDetail(true) on mobile', () => {
        const handler = REPO_CHAT_TAB_SOURCE.substring(
            REPO_CHAT_TAB_SOURCE.indexOf('const handleNewChat'),
            REPO_CHAT_TAB_SOURCE.indexOf('// Trigger new chat from external')
        );
        expect(handler).toContain('if (isMobile) setMobileShowDetail(true)');
    });
});

describe('RepoChatTab mobile: deep link support', () => {
    it('sets mobileShowDetail(true) when initialSessionId is provided', () => {
        const autoSelect = REPO_CHAT_TAB_SOURCE.substring(
            REPO_CHAT_TAB_SOURCE.indexOf('// --- auto-select on mount'),
            REPO_CHAT_TAB_SOURCE.indexOf('// Reset auto-select when workspace')
        );
        expect(autoSelect).toContain('if (isMobile) setMobileShowDetail(true)');
    });
});

describe('RepoChatTab desktop: layout unchanged', () => {
    it('right panel uses flex-1 to fill available width', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('"flex-1 min-w-0 overflow-hidden flex flex-col"');
    });

    it('chat-split-panel root is still present', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('data-testid="chat-split-panel"');
    });

    it('desktop renders sidebarContent directly (not in ResponsiveSidebar)', () => {
        // Desktop path: {sidebarContent} directly inside the flex container
        const desktopReturn = REPO_CHAT_TAB_SOURCE.substring(
            REPO_CHAT_TAB_SOURCE.lastIndexOf('data-testid="chat-split-panel"')
        );
        expect(desktopReturn).toContain('{sidebarContent}');
    });
});

describe('RepoChatTab mobile: workspace change resets detail', () => {
    it('resets mobileShowDetail on workspace change', () => {
        const resetBlock = REPO_CHAT_TAB_SOURCE.substring(
            REPO_CHAT_TAB_SOURCE.indexOf('// Reset auto-select when workspace'),
            REPO_CHAT_TAB_SOURCE.indexOf('// Refresh session list')
        );
        expect(resetBlock).toContain('setMobileShowDetail(false)');
    });
});

describe('RepoChatTab: pinned chats wiring', () => {
    it('imports usePinnedChats', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain("import { usePinnedChats } from '../chat/usePinnedChats'");
    });

    it('calls usePinnedChats with workspaceId', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('usePinnedChats(workspaceId)');
    });

    it('destructures pinnedIds and togglePin from usePinnedChats', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('pinnedIds');
        expect(REPO_CHAT_TAB_SOURCE).toContain('togglePin');
    });

    it('passes pinnedIds to ChatSessionSidebar', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('pinnedIds={pinnedIds}');
    });

    it('passes onTogglePin to ChatSessionSidebar', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('onTogglePin={togglePin}');
    });
});
