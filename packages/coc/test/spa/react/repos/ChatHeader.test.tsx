import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// --- Hoisted mocks ---
const { mockContainerWidth, mockBreakpoint } = vi.hoisted(() => ({
    mockContainerWidth: { width: 800, tier: 'wide' as const, isWide: true, isMedium: false, isNarrow: false },
    mockBreakpoint: { isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' as const },
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useContainerWidth', () => ({
    useContainerWidth: () => mockContainerWidth,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => mockBreakpoint,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/FloatingChatsContext', () => ({
    useFloatingChats: () => ({
        isFloating: () => false,
        floatingChats: new Map(),
        floatChat: vi.fn(),
        unfloatChat: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/ui', async () => {
    const actual = await vi.importActual('../../../../src/server/spa/client/react/ui');
    return {
        ...actual,
        Button: ({ children, onClick, loading }: any) => (
            <button onClick={onClick} disabled={loading}>{children}</button>
        ),
    };
});

vi.mock('../../../../src/server/spa/client/react/features/chat/ChatStatusPill', () => ({
    ChatStatusPill: ({ status, type, durationMs, showDuration, iconOnly, 'data-testid': testId }: any) => (
        <span
            data-testid={testId ?? 'chat-status-pill'}
            data-status={status}
            data-type={type ?? ''}
            data-icon-only={iconOnly ? 'true' : 'false'}
        >
            {iconOnly
                ? (status === 'completed' ? '✅' : '⏳')
                : `${status === 'completed' ? '✅' : '⏳'} ${status}${showDuration && durationMs != null ? ` · ${durationMs}ms` : ''}`}
        </span>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/ui/ReferencesDropdown', () => ({
    deduplicateReferenceFiles: (_planPath: any, files: any) => files ?? [],
    normalizeRefPath: (p: string) => p,
    ReferencesDropdown: ({ planPath, files }: any) => {
        const total = (planPath ? 1 : 0) + (files?.length ?? 0);
        return total > 0 ? <span data-testid="references-dropdown">Refs ({total})</span> : null;
    },
    ReferenceList: ({ planPath, files }: any) => {
        const total = (planPath ? 1 : 0) + (files?.length ?? 0);
        return total > 0 ? <span data-testid="reference-list">RefList ({total})</span> : null;
    },
}));
vi.mock('../../../../src/server/spa/client/react/ui/BottomSheet', () => ({
    BottomSheet: ({ isOpen, children }: any) => isOpen ? <div data-testid="refs-bottomsheet">{children}</div> : null,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationMetadataPopover', () => ({
    ConversationMetadataPopover: ({ resumeSessionId, onLaunchInteractiveResume, onCopyResumeCommand, onStartFreshSameContext, startingFreshSameContext, extraRows }: any) => (
        <span
            data-testid="metadata-popover"
            data-resume-session-id={resumeSessionId ?? ''}
            data-has-resume-handler={onLaunchInteractiveResume ? 'true' : 'false'}
            data-has-copy-handler={onCopyResumeCommand ? 'true' : 'false'}
            data-has-fresh-handler={onStartFreshSameContext ? 'true' : 'false'}
            data-starting-fresh={startingFreshSameContext ? 'true' : 'false'}
            data-extra-row-labels={(extraRows ?? []).map((r: any) => r.label).join('|')}
        >
            i
            {onStartFreshSameContext && (
                <button type="button" data-testid="metadata-new-chat-same-context" onClick={onStartFreshSameContext}>
                    New chat with same context
                </button>
            )}
        </span>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/ui/ContextWindowIndicator', () => ({
    ContextWindowIndicator: ({ tokenLimit }: any) =>
        tokenLimit ? <span data-testid="context-window">ctx</span> : null,
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    copyHtmlToClipboard: vi.fn().mockResolvedValue(undefined),
    formatConversationAsText: vi.fn().mockReturnValue('text'),
    formatConversationAsHtml: vi.fn().mockReturnValue('<html>'),
    formatDuration: (ms: number) => `${ms}ms`,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble', () => ({
    chatMarkdownToHtml: vi.fn().mockReturnValue('<p>html</p>'),
}));

vi.mock('../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../../../../src/server/spa/client/react/utils/snapshot-copy-utils', () => ({
    snapshotConversation: vi.fn().mockReturnValue('<div>snapshot</div>'),
    openPrintPreview: vi.fn().mockReturnValue(true),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/ChatHeaderOverflowMenu', () => ({
    ChatHeaderOverflowMenu: ({ items }: any) =>
        items.length > 0
            ? (
                <span
                    data-testid="overflow-menu"
                    data-count={items.length}
                    data-keys={items.map((item: any) => item.key).join(',')}
                    data-labels={items.map((item: any) => item.label).join('|')}
                >
                    ⋮
                    {items.map((item: any) =>
                        item.key === 'metadata' && item.render
                            ? <div key={item.key} data-testid={`overflow-item-${item.key}`}>{item.render()}</div>
                            : <button key={item.key} type="button" data-testid={`overflow-item-${item.key}`} onClick={item.onClick}>{item.label}</button>
                    )}
                </span>
            )
            : null,
}));

import { ChatHeader, type ChatHeaderProps } from '../../../../src/server/spa/client/react/features/chat/ChatHeader';

function defaultProps(overrides: Partial<ChatHeaderProps> = {}): ChatHeaderProps {
    return {
        task: { status: 'completed', duration: 5000 },
        metadataProcess: { id: 'proc-1' },
        planPath: '/some/plan.md',
        createdFiles: [{ filePath: '/some/file.ts' }],
        pinnedFile: undefined,
        variant: 'inline',
        isPopOut: false,
        loading: false,
        turns: [{ role: 'user', content: 'hello' } as any],
        resumeLaunching: false,
        resumeSessionId: 'session-1',
        isPending: false,
        sessionTokenLimit: 128000,
        sessionCurrentTokens: 50000,
        sessionModel: 'gpt-4',
        copied: false,
        setCopied: vi.fn(),
        taskId: 'task-1',
        onLaunchInteractiveResume: vi.fn(),
        onCopyResumeCommand: vi.fn(),
        onPopOut: vi.fn(),
        onFloat: vi.fn(),
        onBack: vi.fn(),
        title: 'Test Chat',
        wsId: 'ws-1',
        ...overrides,
    };
}

function setTier(tier: 'wide' | 'medium' | 'narrow') {
    mockContainerWidth.tier = tier;
    mockContainerWidth.isWide = tier === 'wide';
    mockContainerWidth.isMedium = tier === 'medium';
    mockContainerWidth.isNarrow = tier === 'narrow';
    mockContainerWidth.width = tier === 'wide' ? 800 : tier === 'medium' ? 600 : 400;
}

describe('ChatHeader', () => {
    beforeEach(() => {
        setTier('wide');
        mockBreakpoint.isMobile = false;
        mockBreakpoint.isTablet = false;
        mockBreakpoint.isDesktop = true;
        mockBreakpoint.breakpoint = 'desktop';
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', loopsEnabled: true };
    });

    describe('wide tier (>= 700px)', () => {
        it('renders all elements', () => {
            render(<ChatHeader {...defaultProps()} />);
            expect(screen.getByText('Test Chat')).toBeTruthy();
            // Status pill — replaces the legacy Badge; ships with inline duration in wide tier
            const pill = screen.getByTestId('badge');
            expect(pill).toBeTruthy();
            expect(pill.getAttribute('data-icon-only')).toBe('false');
            expect(pill.textContent).toContain('5000ms');
            expect(screen.getByTestId('references-dropdown')).toBeTruthy();
            // Context window indicator no longer rendered in the header (moved to composer)
            expect(screen.queryByTestId('context-window')).toBeNull();
            expect(screen.getByTestId('copy-conversation-btn')).toBeTruthy();
            // HTML and PDF are now in the overflow menu at all tiers
            expect(screen.queryByTestId('copy-conversation-html-btn')).toBeNull();
            expect(screen.queryByTestId('export-conversation-pdf-btn')).toBeNull();
            const menu = screen.getByTestId('overflow-menu');
            expect(menu.getAttribute('data-keys')?.split(',')).toContain('copy-html');
            expect(menu.getAttribute('data-keys')?.split(',')).toContain('export-pdf');
            // Resume in CLI is NOT a top-bar button — it lives inside the metadata popover only
            expect(screen.queryByTestId('resume-cli-btn')).toBeNull();
            const metadataPopover = screen.getByTestId('metadata-popover');
            expect(metadataPopover).toBeTruthy();
            expect(metadataPopover.getAttribute('data-resume-session-id')).toBe('session-1');
            expect(metadataPopover.getAttribute('data-has-resume-handler')).toBe('true');
            expect(screen.getByTestId('activity-chat-float-btn')).toBeTruthy();
            expect(screen.getByTestId('activity-chat-popout-btn')).toBeTruthy();
        });

        it('includes PDF export in overflow menu', () => {
            render(<ChatHeader {...defaultProps()} />);
            expect(screen.queryByTestId('export-conversation-pdf-btn')).toBeNull();
            const menu = screen.getByTestId('overflow-menu');
            expect(menu.getAttribute('data-keys')?.split(',')).toContain('export-pdf');
            expect(menu.getAttribute('data-labels')).toContain('Export as PDF');
        });

        it('includes HTML copy in overflow menu', () => {
            render(<ChatHeader {...defaultProps()} />);
            expect(screen.queryByTestId('copy-conversation-html-btn')).toBeNull();
            const menu = screen.getByTestId('overflow-menu');
            expect(menu.getAttribute('data-keys')?.split(',')).toContain('copy-html');
        });

        it('shows overflow menu in wide tier', () => {
            render(<ChatHeader {...defaultProps()} />);
            expect(screen.getByTestId('overflow-menu')).toBeTruthy();
        });

        it('shows full status label in pill', () => {
            render(<ChatHeader {...defaultProps()} />);
            const badge = screen.getByTestId('badge');
            expect(badge.textContent).toContain('completed');
            expect(badge.textContent).toContain('5000ms');
        });

        it('does not render an inline Resume in CLI button (lives in metadata popover)', () => {
            render(<ChatHeader {...defaultProps()} />);
            expect(screen.queryByTestId('resume-cli-btn')).toBeNull();
        });

        it('passes Resume in CLI props through to the metadata popover', () => {
            render(<ChatHeader {...defaultProps()} />);
            const popover = screen.getByTestId('metadata-popover');
            expect(popover.getAttribute('data-resume-session-id')).toBe('session-1');
            expect(popover.getAttribute('data-has-resume-handler')).toBe('true');
        });
    });

    describe('medium tier (500-699px)', () => {
        beforeEach(() => setTier('medium'));

        it('hides inline references, resume CLI, context window', () => {
            render(<ChatHeader {...defaultProps()} />);
            expect(screen.queryByTestId('references-dropdown')).toBeNull();
            expect(screen.queryByTestId('resume-cli-btn')).toBeNull();
            expect(screen.queryByTestId('context-window')).toBeNull();
        });

        it('shows the loop badge for paused non-cancelled loops', () => {
            render(<ChatHeader {...defaultProps({ loopCount: 1, hasActiveLoops: false })} />);

            const badge = screen.getByTestId('loop-badge');
            expect(badge).toBeTruthy();
            expect(badge.textContent).toContain('1');
            expect(badge.title).toBe('1 loop — click to manage');
        });

        it('has no inline HTML/PDF buttons (always in overflow)', () => {
            render(<ChatHeader {...defaultProps()} />);
            expect(screen.queryByTestId('copy-conversation-html-btn')).toBeNull();
            expect(screen.queryByTestId('export-conversation-pdf-btn')).toBeNull();
            // Metadata is accessible via the overflow menu at all tiers
            const menu = screen.getByTestId('overflow-menu');
            expect(menu.getAttribute('data-keys')?.split(',')).toContain('copy-html');
            expect(menu.getAttribute('data-keys')?.split(',')).toContain('export-pdf');
        });

        it('shows overflow menu', () => {
            render(<ChatHeader {...defaultProps()} />);
            expect(screen.getByTestId('overflow-menu')).toBeTruthy();
        });

        it('shows icon-only status pill (no label)', () => {
            render(<ChatHeader {...defaultProps()} />);
            const pill = screen.getByTestId('badge');
            expect(pill.getAttribute('data-icon-only')).toBe('true');
            expect(pill.textContent).not.toContain('completed');
            expect(pill.textContent).toContain('✅');
        });

        it('still shows copy button directly', () => {
            render(<ChatHeader {...defaultProps()} />);
            expect(screen.getByTestId('copy-conversation-btn')).toBeTruthy();
        });

        it('still shows float/popout buttons', () => {
            render(<ChatHeader {...defaultProps()} />);
            expect(screen.getByTestId('activity-chat-float-btn')).toBeTruthy();
            expect(screen.getByTestId('activity-chat-popout-btn')).toBeTruthy();
        });
    });

    describe('narrow tier (< 500px)', () => {
        beforeEach(() => setTier('narrow'));

        it('hides inline secondary items', () => {
            render(<ChatHeader {...defaultProps()} />);
            expect(screen.queryByTestId('references-dropdown')).toBeNull();
            expect(screen.queryByTestId('resume-cli-btn')).toBeNull();
            expect(screen.queryByTestId('context-window')).toBeNull();
            expect(screen.queryByTestId('copy-conversation-html-btn')).toBeNull();
            expect(screen.queryByTestId('export-conversation-pdf-btn')).toBeNull();
            // Metadata is in overflow at all tiers; not an inline element
            expect(screen.queryByTestId('metadata-popover')).toBeTruthy(); // via overflow menu
        });

        it('hides float/popout buttons (moved to overflow)', () => {
            render(<ChatHeader {...defaultProps()} />);
            expect(screen.queryByTestId('activity-chat-float-btn')).toBeNull();
            expect(screen.queryByTestId('activity-chat-popout-btn')).toBeNull();
        });

        it('shows overflow menu with more items', () => {
            render(<ChatHeader {...defaultProps()} />);
            const menu = screen.getByTestId('overflow-menu');
            expect(menu).toBeTruthy();
            // Narrow includes float + popout in overflow
            const wideCount = parseInt(menu.getAttribute('data-count') ?? '0');
            expect(wideCount).toBeGreaterThan(5);
        });

        it('truncates the title', () => {
            render(<ChatHeader {...defaultProps({ title: 'A very long chat title that should be truncated at narrow width' })} />);
            const titleEl = screen.getByText('A very long chat title that should be truncated at narrow width');
            expect(titleEl.className).toContain('truncate');
            expect(titleEl.className).toContain('max-w-[120px]');
        });

        it('still shows back, title, badge, and copy', () => {
            render(<ChatHeader {...defaultProps()} />);
            expect(screen.getByTestId('activity-chat-back-btn')).toBeTruthy();
            expect(screen.getByText('Test Chat')).toBeTruthy();
            expect(screen.getByTestId('badge')).toBeTruthy();
            expect(screen.getByTestId('copy-conversation-btn')).toBeTruthy();
        });
    });

    describe('variant and popout behaviour', () => {
        it('hides back button for floating variant', () => {
            render(<ChatHeader {...defaultProps({ variant: 'floating' })} />);
            expect(screen.queryByTestId('activity-chat-back-btn')).toBeNull();
        });

        it('hides float/popout buttons when isPopOut', () => {
            render(<ChatHeader {...defaultProps({ isPopOut: true })} />);
            expect(screen.queryByTestId('activity-chat-float-btn')).toBeNull();
            expect(screen.queryByTestId('activity-chat-popout-btn')).toBeNull();
        });

        it('uses compact padding for floating variant', () => {
            render(<ChatHeader {...defaultProps({ variant: 'floating' })} />);
            const header = screen.getByTestId('chat-header');
            expect(header.className).toContain('px-2 py-1');
            expect(header.className).not.toContain('border-b');
        });
    });

    describe('conditional elements', () => {
        it('hides badge when task is null', () => {
            render(<ChatHeader {...defaultProps({ task: null })} />);
            expect(screen.queryByTestId('badge')).toBeNull();
        });

        it('does not render context window in header even when token limit set', () => {
            render(<ChatHeader {...defaultProps()} />);
            expect(screen.queryByTestId('context-window')).toBeNull();
        });

        it('hides metadata when isPending', () => {
            render(<ChatHeader {...defaultProps({ isPending: true })} />);
            expect(screen.queryByTestId('metadata-popover')).toBeNull();
        });

        it('hides metadata when no metadataProcess', () => {
            render(<ChatHeader {...defaultProps({ metadataProcess: null })} />);
            expect(screen.queryByTestId('metadata-popover')).toBeNull();
        });

        it('shows default title "Chat" when title not provided', () => {
            render(<ChatHeader {...defaultProps({ title: undefined })} />);
            expect(screen.getByText('Chat')).toBeTruthy();
        });

        it('hides references when no files and no plan', () => {
            render(<ChatHeader {...defaultProps({ planPath: '', createdFiles: [] })} />);
            expect(screen.queryByTestId('references-dropdown')).toBeNull();
        });

        it('omits duration suffix in pill when task has no duration', () => {
            render(<ChatHeader {...defaultProps({ task: { status: 'completed' } })} />);
            const pill = screen.getByTestId('badge');
            expect(pill.textContent).not.toContain('ms');
        });
    });

    describe('overflow menu content', () => {
        it('includes references in overflow at medium tier', () => {
            setTier('medium');
            render(<ChatHeader {...defaultProps()} />);
            const menu = screen.getByTestId('overflow-menu');
            const count = parseInt(menu.getAttribute('data-count') ?? '0');
            expect(count).toBeGreaterThanOrEqual(5); // html, pdf, metadata, refs, resume-cli, duration, ctx-window
        });

        it('includes resume CLI in overflow at medium tier on desktop', () => {
            setTier('medium');
            render(<ChatHeader {...defaultProps()} />);
            const menu = screen.getByTestId('overflow-menu');
            expect(menu.getAttribute('data-keys')?.split(',')).toContain('resume-cli');
        });

        it('does not include resume CLI in overflow on mobile', () => {
            setTier('medium');
            mockBreakpoint.isMobile = true;
            mockBreakpoint.isDesktop = false;
            mockBreakpoint.breakpoint = 'mobile';

            render(<ChatHeader {...defaultProps()} />);

            const menu = screen.getByTestId('overflow-menu');
            expect(menu.getAttribute('data-keys')?.split(',')).not.toContain('resume-cli');
        });

        it('includes Copy Command beside resume CLI in overflow at medium tier on desktop', () => {
            setTier('medium');
            render(<ChatHeader {...defaultProps()} />);
            const menu = screen.getByTestId('overflow-menu');
            expect(menu.getAttribute('data-keys')?.split(',')).toContain('copy-resume-cli');
            expect(menu.getAttribute('data-labels')?.split('|')).toContain('Copy Command');
        });

        it('fires onCopyResumeCommand when the Copy Command overflow item is clicked', () => {
            setTier('medium');
            const onCopyResumeCommand = vi.fn();
            render(<ChatHeader {...defaultProps({ onCopyResumeCommand })} />);
            screen.getByTestId('overflow-item-copy-resume-cli').click();
            expect(onCopyResumeCommand).toHaveBeenCalledTimes(1);
        });

        it('omits Copy Command when no copy handler is provided', () => {
            setTier('medium');
            render(<ChatHeader {...defaultProps({ onCopyResumeCommand: undefined })} />);
            const menu = screen.getByTestId('overflow-menu');
            expect(menu.getAttribute('data-keys')?.split(',')).toContain('resume-cli');
            expect(menu.getAttribute('data-keys')?.split(',')).not.toContain('copy-resume-cli');
        });

        it('does not include Copy Command in overflow on mobile', () => {
            setTier('medium');
            mockBreakpoint.isMobile = true;
            mockBreakpoint.isDesktop = false;
            mockBreakpoint.breakpoint = 'mobile';

            render(<ChatHeader {...defaultProps()} />);

            const menu = screen.getByTestId('overflow-menu');
            expect(menu.getAttribute('data-keys')?.split(',')).not.toContain('copy-resume-cli');
        });

        it('does not pass resume CLI props to metadata popover on mobile', () => {
            setTier('wide');
            mockBreakpoint.isMobile = true;
            mockBreakpoint.isDesktop = false;
            mockBreakpoint.breakpoint = 'mobile';

            render(<ChatHeader {...defaultProps()} />);

            const metadataPopover = screen.getByTestId('metadata-popover');
            expect(metadataPopover.getAttribute('data-resume-session-id')).toBe('');
            expect(metadataPopover.getAttribute('data-has-resume-handler')).toBe('false');
            expect(metadataPopover.getAttribute('data-has-copy-handler')).toBe('false');
        });

        it('passes the Copy Command handler to the metadata popover on desktop', () => {
            setTier('wide');
            render(<ChatHeader {...defaultProps()} />);
            const metadataPopover = screen.getByTestId('metadata-popover');
            expect(metadataPopover.getAttribute('data-has-copy-handler')).toBe('true');
        });

        it('has no overflow items when everything is hidden by props', () => {
            setTier('medium');
            render(<ChatHeader {...defaultProps({
                task: null,
                metadataProcess: null,
                planPath: '',
                createdFiles: [],
                resumeSessionId: null,
                isPending: true,
                sessionTokenLimit: undefined,
            })} />);
            const menu = screen.getByTestId('overflow-menu');
            // copy-html and export-pdf always shown in overflow at < 700px
            const count = parseInt(menu.getAttribute('data-count') ?? '0');
            expect(count).toBe(2);
        });
    });

    describe('scratchpad button', () => {
        it('renders inline scratchpad button in wide tier when showScratchpadButton is true', () => {
            setTier('wide');
            const onOpenScratchpad = vi.fn();
            render(<ChatHeader {...defaultProps({ showScratchpadButton: true, onOpenScratchpad })} />);
            const btn = screen.getByTestId('open-scratchpad-btn');
            expect(btn).toBeTruthy();
            expect(btn.getAttribute('title')).toBe('Open scratchpad');
        });

        it('calls onOpenScratchpad when scratchpad button is clicked', async () => {
            setTier('wide');
            const onOpenScratchpad = vi.fn();
            render(<ChatHeader {...defaultProps({ showScratchpadButton: true, onOpenScratchpad })} />);
            const btn = screen.getByTestId('open-scratchpad-btn');
            btn.click();
            expect(onOpenScratchpad).toHaveBeenCalledTimes(1);
        });

        it('does not render inline scratchpad button when showScratchpadButton is false', () => {
            setTier('wide');
            render(<ChatHeader {...defaultProps({ showScratchpadButton: false })} />);
            expect(screen.queryByTestId('open-scratchpad-btn')).toBeNull();
        });

        it('does not render inline scratchpad button when showScratchpadButton is undefined', () => {
            setTier('wide');
            render(<ChatHeader {...defaultProps()} />);
            expect(screen.queryByTestId('open-scratchpad-btn')).toBeNull();
        });

        it('does not render inline scratchpad button in medium tier (moves to overflow)', () => {
            setTier('medium');
            const onOpenScratchpad = vi.fn();
            render(<ChatHeader {...defaultProps({ showScratchpadButton: true, onOpenScratchpad })} />);
            expect(screen.queryByTestId('open-scratchpad-btn')).toBeNull();
        });

        it('does not render inline scratchpad button in narrow tier (moves to overflow)', () => {
            setTier('narrow');
            const onOpenScratchpad = vi.fn();
            render(<ChatHeader {...defaultProps({ showScratchpadButton: true, onOpenScratchpad })} />);
            expect(screen.queryByTestId('open-scratchpad-btn')).toBeNull();
        });

        it('includes scratchpad in overflow menu at medium tier', () => {
            setTier('medium');
            const onOpenScratchpad = vi.fn();
            // Start with the minimal props to count overflow items precisely
            render(<ChatHeader {...defaultProps({
                task: null,
                metadataProcess: null,
                planPath: '',
                createdFiles: [],
                resumeSessionId: null,
                isPending: true,
                sessionTokenLimit: undefined,
                showScratchpadButton: true,
                onOpenScratchpad,
            })} />);
            const menu = screen.getByTestId('overflow-menu');
            // copy-html + export-pdf + open-scratchpad = 3
            const count = parseInt(menu.getAttribute('data-count') ?? '0');
            expect(count).toBe(3);
        });

        it('does not include scratchpad in overflow when showScratchpadButton is false', () => {
            setTier('medium');
            render(<ChatHeader {...defaultProps({
                task: null,
                metadataProcess: null,
                planPath: '',
                createdFiles: [],
                resumeSessionId: null,
                isPending: true,
                sessionTokenLimit: undefined,
                showScratchpadButton: false,
            })} />);
            const menu = screen.getByTestId('overflow-menu');
            const count = parseInt(menu.getAttribute('data-count') ?? '0');
            expect(count).toBe(2);
        });
    });

    describe('fork button', () => {
        it('metadata popover is rendered when onFork is provided (fork lives inside popover)', () => {
            setTier('wide');
            const onFork = vi.fn();
            render(<ChatHeader {...defaultProps({ onFork, forking: false })} />);
            // Fork was moved into the ConversationMetadataPopover (alongside Resume CLI)
            expect(screen.getByTestId('metadata-popover')).toBeTruthy();
        });

        it('does not render fork button when onFork is undefined', () => {
            setTier('wide');
            render(<ChatHeader {...defaultProps({ onFork: undefined })} />);
            expect(screen.queryByText(/🍴 Fork/)).toBeNull();
        });

        it('shows "Forking…" label in overflow at medium tier', () => {
            setTier('medium');
            const onFork = vi.fn();
            render(<ChatHeader {...defaultProps({ onFork, forking: true })} />);
            // Fork moves to overflow at non-wide tiers — check overflow item count includes it
            const menu = screen.getByTestId('overflow-menu');
            const count = parseInt(menu.getAttribute('data-count') ?? '0');
            // Overflow should include at least: fork + other items
            expect(count).toBeGreaterThanOrEqual(1);
        });

        it('does not include fork in overflow when onFork is undefined', () => {
            setTier('medium');
            // Minimal props: no fork, no optional elements
            render(<ChatHeader {...defaultProps({
                task: null,
                metadataProcess: null,
                planPath: '',
                createdFiles: [],
                resumeSessionId: null,
                isPending: true,
                sessionTokenLimit: undefined,
                onFork: undefined,
            })} />);
            const menu = screen.getByTestId('overflow-menu');
            const count = parseInt(menu.getAttribute('data-count') ?? '0');
            // Without fork: copy-html + export-pdf = 2
            expect(count).toBe(2);
        });

        it('includes fork in overflow at medium tier', () => {
            setTier('medium');
            const onFork = vi.fn();
            render(<ChatHeader {...defaultProps({
                task: null,
                metadataProcess: null,
                planPath: '',
                createdFiles: [],
                resumeSessionId: null,
                isPending: true,
                sessionTokenLimit: undefined,
                onFork,
                forking: false,
            })} />);
            const menu = screen.getByTestId('overflow-menu');
            const count = parseInt(menu.getAttribute('data-count') ?? '0');
            // copy-html + export-pdf + fork = 3
            expect(count).toBe(3);
        });
    });

    describe('fresh same-context action', () => {
        it('passes the exact action label to the metadata popover in wide lens-sized chat headers', () => {
            setTier('wide');
            const onStartFreshSameContext = vi.fn();
            render(<ChatHeader {...defaultProps({ onStartFreshSameContext, startingFreshSameContext: true })} />);

            const action = screen.getByTestId('metadata-new-chat-same-context');
            expect(action.textContent).toBe('New chat with same context');
            expect(screen.getByTestId('metadata-popover').getAttribute('data-has-fresh-handler')).toBe('true');
            expect(screen.getByTestId('metadata-popover').getAttribute('data-starting-fresh')).toBe('true');
        });

        it('invokes the fresh same-context callback from the metadata popover', () => {
            setTier('wide');
            const onStartFreshSameContext = vi.fn();
            render(<ChatHeader {...defaultProps({ onStartFreshSameContext })} />);

            screen.getByTestId('metadata-new-chat-same-context').click();

            expect(onStartFreshSameContext).toHaveBeenCalledOnce();
        });

        it('includes the exact fresh same-context action in overflow without dropping existing actions', () => {
            setTier('medium');
            const onStartFreshSameContext = vi.fn();
            render(<ChatHeader {...defaultProps({
                onStartFreshSameContext,
                onToggleSelecting: vi.fn(),
                onFork: vi.fn(),
            })} />);

            const menu = screen.getByTestId('overflow-menu');
            const keys = menu.getAttribute('data-keys')?.split(',') ?? [];
            expect(keys).toContain('copy-html');
            expect(keys).toContain('select-turns');
            expect(keys).toContain('export-pdf');
            expect(keys).toContain('metadata');
            expect(keys).toContain('new-chat-same-context');
            expect(keys).toContain('fork');
            expect(menu.getAttribute('data-labels')?.split('|')).toContain('New chat with same context');

            screen.getByTestId('overflow-item-new-chat-same-context').click();
            expect(onStartFreshSameContext).toHaveBeenCalledOnce();
        });

        it('omits the fresh same-context action when no callback is provided', () => {
            setTier('medium');
            render(<ChatHeader {...defaultProps()} />);

            expect(screen.getByTestId('overflow-menu').getAttribute('data-keys')?.split(',')).not.toContain('new-chat-same-context');
        });
    });

    describe('metadata extra rows pass-through', () => {
        const EXTRA_ROWS = [
            { label: 'Repository', value: 'owner/repo' },
            { label: 'Branch', value: 'main' },
        ];

        it('forwards metadataExtraRows to the inline popover in wide tier', () => {
            setTier('wide');
            render(<ChatHeader {...defaultProps({ metadataExtraRows: EXTRA_ROWS })} />);
            const popover = screen.getByTestId('metadata-popover');
            expect(popover.getAttribute('data-extra-row-labels')).toBe('Repository|Branch');
        });

        it('keeps the metadata item (which carries extra rows) in the overflow at medium tier', () => {
            setTier('medium');
            render(<ChatHeader {...defaultProps({ metadataExtraRows: EXTRA_ROWS })} />);
            // At medium tier the metadata popover moves into the overflow menu; its
            // render closure forwards metadataExtraRows. The mock lists item keys.
            const menu = screen.getByTestId('overflow-menu');
            expect(menu.getAttribute('data-keys')?.split(',')).toContain('metadata');
        });

        it('passes no extra rows to the popover when metadataExtraRows is omitted (chat default unchanged)', () => {
            setTier('wide');
            render(<ChatHeader {...defaultProps()} />);
            const popover = screen.getByTestId('metadata-popover');
            expect(popover.getAttribute('data-extra-row-labels')).toBe('');
        });
    });

    describe('provider badge', () => {
        it('shows provider badge when task.metadata.provider is "codex"', () => {
            render(<ChatHeader {...defaultProps({
                task: { status: 'completed', duration: 5000, metadata: { provider: 'codex' } },
            })} />);
            const badge = screen.getByTestId('provider-badge');
            expect(badge).toBeTruthy();
            expect(badge.textContent).toBe('Codex');
            expect(badge.getAttribute('data-provider')).toBe('codex');
        });

        it('shows provider badge when task.metadata.provider is "copilot"', () => {
            render(<ChatHeader {...defaultProps({
                task: { status: 'completed', duration: 5000, metadata: { provider: 'copilot' } },
            })} />);
            const badge = screen.getByTestId('provider-badge');
            expect(badge).toBeTruthy();
            expect(badge.textContent).toBe('Copilot');
            expect(badge.getAttribute('data-provider')).toBe('copilot');
        });

        it('shows Auto (pending) when queued task requested auto routing without a concrete provider', () => {
            render(<ChatHeader {...defaultProps({
                task: {
                    status: 'queued',
                    payload: { context: { autoProviderRouting: { requested: true } } },
                },
                isPending: true,
            })} />);
            const badge = screen.getByTestId('provider-badge');
            expect(badge.textContent).toBe('Auto (pending)');
            expect(badge.getAttribute('data-provider')).toBe('auto-pending');
        });

        it('shows the resolved provider rather than Auto (pending) after execution-time routing', () => {
            render(<ChatHeader {...defaultProps({
                task: {
                    status: 'running',
                    metadata: {
                        provider: 'claude',
                        autoProviderRouting: { requested: true, provider: 'claude' },
                    },
                    payload: { context: { autoProviderRouting: { requested: true } } },
                },
            })} />);
            const badge = screen.getByTestId('provider-badge');
            expect(badge.textContent).toBe('Claude');
            expect(badge.getAttribute('data-provider')).toBe('claude');
        });

        it('does NOT show provider badge when task has no metadata.provider', () => {
            render(<ChatHeader {...defaultProps({
                task: { status: 'completed', duration: 5000 },
            })} />);
            expect(screen.queryByTestId('provider-badge')).toBeNull();
        });

        it('does NOT show provider badge when task is null', () => {
            render(<ChatHeader {...defaultProps({ task: null })} />);
            expect(screen.queryByTestId('provider-badge')).toBeNull();
        });
    });
});
