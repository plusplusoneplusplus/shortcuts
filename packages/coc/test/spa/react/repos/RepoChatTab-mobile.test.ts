/**
 * Tests for RepoChatTab mobile responsiveness improvements.
 *
 * Validates:
 * - Chat sidebar uses ResponsiveSidebar (drawer on mobile, fixed on desktop)
 * - Mobile sessions toggle button in conversation header and start screen
 * - mobileSidebarOpen state management
 * - Session selection closes mobile drawer
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_CHAT_TAB_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoChatTab.tsx'),
    'utf-8',
);

describe('RepoChatTab mobile: imports', () => {
    it('imports ResponsiveSidebar', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain("import { ResponsiveSidebar } from '../shared/ResponsiveSidebar'");
    });

    it('imports useBreakpoint', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain("import { useBreakpoint } from '../hooks/useBreakpoint'");
    });
});

describe('RepoChatTab mobile: breakpoint and state', () => {
    it('destructures isMobile from useBreakpoint', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('const { isMobile } = useBreakpoint()');
    });

    it('has mobileSidebarOpen state', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)');
    });
});

describe('RepoChatTab mobile: ResponsiveSidebar integration', () => {
    it('renders ResponsiveSidebar on mobile', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('<ResponsiveSidebar');
    });

    it('passes mobileSidebarOpen as isOpen prop', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('isOpen={mobileSidebarOpen}');
    });

    it('passes setMobileSidebarOpen(false) as onClose', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('onClose={() => setMobileSidebarOpen(false)}');
    });

    it('conditionally renders ResponsiveSidebar based on isMobile', () => {
        // On mobile: use ResponsiveSidebar; on desktop: render sidebar directly
        expect(REPO_CHAT_TAB_SOURCE).toContain('isMobile ? (');
        expect(REPO_CHAT_TAB_SOURCE).toContain('sidebarContent');
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

describe('RepoChatTab mobile: sessions toggle button', () => {
    it('renders mobile sessions button in conversation header', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('data-testid="chat-mobile-sessions-btn"');
    });

    it('renders mobile sessions button in start screen', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('data-testid="chat-mobile-sessions-btn-start"');
    });

    it('sessions button opens mobile sidebar', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('setMobileSidebarOpen(true)');
    });

    it('sessions button has hamburger icon', () => {
        const btnIdx = REPO_CHAT_TAB_SOURCE.indexOf('chat-mobile-sessions-btn"');
        const nearby = REPO_CHAT_TAB_SOURCE.substring(btnIdx, btnIdx + 200);
        expect(nearby).toContain('☰');
    });

    it('sessions buttons are only shown on mobile', () => {
        // Both buttons are guarded by isMobile conditional rendering
        // The pattern: {isMobile && (<button ... data-testid="chat-mobile-sessions-btn"
        const normalized = REPO_CHAT_TAB_SOURCE.replace(/\r\n/g, '\n');
        const matches = normalized.match(/\{isMobile && \(\s*<button/g);
        expect(matches).toBeTruthy();
        expect(matches!.length).toBeGreaterThanOrEqual(2);
    });
});

describe('RepoChatTab mobile: session selection closes drawer', () => {
    it('handleSelectSession calls setMobileSidebarOpen(false)', () => {
        const handler = REPO_CHAT_TAB_SOURCE.substring(
            REPO_CHAT_TAB_SOURCE.indexOf('const handleSelectSession'),
            REPO_CHAT_TAB_SOURCE.indexOf('const handleNewChat')
        );
        expect(handler).toContain('setMobileSidebarOpen(false)');
    });
});

describe('RepoChatTab mobile: right panel full-width', () => {
    it('right panel uses flex-1 to fill available width', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('"flex-1 min-w-0 overflow-hidden flex flex-col"');
    });

    it('chat-split-panel root is still present', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('data-testid="chat-split-panel"');
    });
});
