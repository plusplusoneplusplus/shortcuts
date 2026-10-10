/**
 * Regression coverage for the chat header overflow menu layout: actions are
 * grouped (conversation → export → CLI → window), every action row carries an
 * SVG icon (no text/emoji placeholders), and duration renders as a
 * non-actionable footer; context usage never appears in the menu.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { buildOverflowItems } from '../../../../src/server/spa/client/react/features/chat/ChatHeader';
import { ChatHeaderOverflowMenu } from '../../../../src/server/spa/client/react/features/chat/ChatHeaderOverflowMenu';

type BuildProps = Parameters<typeof buildOverflowItems>[1];

function props(overrides: Partial<BuildProps> = {}): BuildProps {
    return {
        task: { duration: 5000 },
        loading: false,
        turns: [{ role: 'user', content: 'hi', timeline: [] } as any],
        isPending: false,
        resumeSessionId: 'sess-1',
        onLaunchInteractiveResume: vi.fn(),
        onCopyResumeCommand: vi.fn(),
        planPath: '',
        createdFiles: [],
        variant: 'inline',
        isPopOut: false,
        isMobile: false,
        isFloatingChat: false,
        taskId: 't1',
        onFloat: vi.fn(),
        onPopOut: vi.fn(),
        onCopyHtml: vi.fn(),
        copiedHtml: false,
        onExportPdf: vi.fn(),
        onToggleSelecting: vi.fn(),
        isSelecting: false,
        showScratchpadButton: true,
        onOpenScratchpad: vi.fn(),
        onFork: vi.fn(),
        forking: false,
        onTogglePin: vi.fn(),
        isPinned: false,
        ...overrides,
    };
}

describe('buildOverflowItems', () => {
    it('orders medium-tier rows by group with info last', () => {
        const items = buildOverflowItems('medium', props());
        expect(items.map(i => i.key)).toEqual([
            'pin-conversation', 'open-scratchpad', 'fork',
            'copy-html', 'select-turns', 'export-pdf',
            'resume-cli', 'copy-resume-cli',
            'duration',
        ]);
        expect(items.filter(i => i.info).map(i => i.key)).toEqual(['duration']);
        expect(items.find(i => i.key === 'duration')?.group).toBeUndefined();
    });

    it('keeps Pin plus the export group at wide tier', () => {
        const items = buildOverflowItems('wide', props({ isPinned: true }));
        expect(items.map(i => i.key)).toEqual(['pin-conversation', 'copy-html', 'select-turns', 'export-pdf']);
        expect(items[0].label).toBe('Unpin conversation');
    });

    it('adds the window group at narrow tier', () => {
        const items = buildOverflowItems('narrow', props());
        const keys = items.map(i => i.key);
        expect(keys.indexOf('float')).toBeGreaterThan(keys.indexOf('copy-resume-cli'));
        expect(keys.indexOf('popout')).toBeLessThan(keys.indexOf('duration'));
        expect(items.find(i => i.key === 'popout')?.group).toBe('window');
    });

    it('disables in-flight actions instead of relabelling them as clickable rows', () => {
        const items = buildOverflowItems('medium', props({ forking: true, pinPending: true }));
        expect(items.find(i => i.key === 'fork')).toMatchObject({ label: 'Forking…', disabled: true });
        expect(items.find(i => i.key === 'pin-conversation')?.disabled).toBe(true);
    });

    it('preserves existing conditions (no CLI rows on mobile or while pending)', () => {
        expect(buildOverflowItems('medium', props({ isMobile: true })).map(i => i.key)).not.toContain('resume-cli');
        expect(buildOverflowItems('medium', props({ isPending: true })).map(i => i.key)).not.toContain('resume-cli');
        expect(buildOverflowItems('medium', props({ onTogglePin: undefined })).map(i => i.key)).not.toContain('pin-conversation');
    });

    it.each(['wide', 'medium', 'narrow'] as const)('never adds a context-usage row at %s tier', (tier) => {
        for (const extra of [{}, { isPopOut: true }, { variant: 'floating' as const }, { isMobile: true }]) {
            const items = buildOverflowItems(tier, props(extra));
            expect(items.map(i => i.key)).not.toContain('context-window');
            expect(items.map(i => i.label)).not.toContain('Context window');
        }
    });
});

describe('overflow menu rendering with real header items', () => {
    it('renders every action with an SVG icon and only duration in the info footer', () => {
        render(<ChatHeaderOverflowMenu items={buildOverflowItems('medium', props())} />);
        fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));

        const rows = screen.getAllByRole('menuitem');
        expect(rows.map(r => r.textContent)).toEqual([
            'Pin conversation', 'Open scratchpad', 'Fork conversation',
            'Copy as HTML', 'Select turns', 'Export as PDF',
            'Resume in CLI', 'Copy resume command',
        ]);
        for (const row of rows) {
            expect(row.querySelector('svg')).not.toBeNull();
        }

        const menu = screen.getByTestId('chat-header-overflow-menu');
        expect(menu.querySelectorAll('[role="separator"]').length).toBe(2);
        const footer = screen.getByTestId('chat-header-overflow-info');
        expect(footer.textContent).toContain('Duration');
        expect(footer.textContent).not.toMatch(/ctx|opus/);
        expect(screen.queryByTestId('context-window-indicator')).toBeNull();
        // Footer sits after the last action row, not between rows.
        expect(rows[rows.length - 1].compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
