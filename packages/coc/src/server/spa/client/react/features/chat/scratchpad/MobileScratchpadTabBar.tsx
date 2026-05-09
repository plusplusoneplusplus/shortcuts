import type { MobileTab } from './useScratchpadState';

export interface MobileScratchpadTabBarProps {
    activeTab: MobileTab;
    onTabChange: (tab: MobileTab) => void;
    onClose: () => void;
}

/**
 * A persistent bottom tab bar shown on mobile when the scratchpad is open.
 * Lets the user switch between the Chat and Scratchpad panels with a single tap.
 * Rendered only when `isMobile && scratchpadEnabled && scratchpad.isOpen`.
 */
export function MobileScratchpadTabBar({ activeTab, onTabChange, onClose }: MobileScratchpadTabBarProps) {
    const tabBase = [
        'flex-1 h-full flex items-center justify-center gap-1.5',
        'text-sm font-medium border-t-2 transition-colors',
    ].join(' ');

    const activeTabCls = 'border-[#0078d4] text-[#0078d4]';
    const inactiveTabCls = 'border-transparent text-[#848484] dark:text-[#888] hover:text-[#0078d4]';

    return (
        <div
            className="flex items-stretch border-t border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] flex-shrink-0"
            style={{ height: 44 }}
            data-testid="mobile-scratchpad-tab-bar"
            role="tablist"
            aria-label="Scratchpad tabs"
        >
            <button
                className={`${tabBase} ${activeTab === 'chat' ? activeTabCls : inactiveTabCls}`}
                onClick={() => onTabChange('chat')}
                role="tab"
                aria-selected={activeTab === 'chat'}
                data-testid="mobile-tab-chat"
                type="button"
            >
                <span aria-hidden="true">💬</span>
                Chat
                {activeTab === 'chat' && (
                    <span className="sr-only">(active)</span>
                )}
            </button>
            <button
                className={`${tabBase} ${activeTab === 'scratchpad' ? activeTabCls : inactiveTabCls}`}
                onClick={() => onTabChange('scratchpad')}
                role="tab"
                aria-selected={activeTab === 'scratchpad'}
                data-testid="mobile-tab-scratchpad"
                type="button"
            >
                <span aria-hidden="true">📝</span>
                Scratchpad
                {activeTab === 'scratchpad' && (
                    <span className="sr-only">(active)</span>
                )}
            </button>
            <button
                className="w-11 h-full flex items-center justify-center text-[#848484] dark:text-[#888] hover:text-[#c00] transition-colors border-t-2 border-transparent"
                onClick={onClose}
                aria-label="Close scratchpad"
                data-testid="mobile-scratchpad-close-btn"
                type="button"
            >
                ✕
            </button>
        </div>
    );
}
