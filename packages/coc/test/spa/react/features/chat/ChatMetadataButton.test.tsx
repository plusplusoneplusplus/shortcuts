// @vitest-environment jsdom
/**
 * Tests for ChatMetadataButton — the shared conversation "i" button.
 *
 * Covers the gates it owns on behalf of every chat header: nothing rendered
 * while the chat is pending or before a merged process exists, and the
 * desktop-only resume props dropped on mobile.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ChatMetadataButton, type ChatHeaderMetadata } from '../../../../../src/server/spa/client/react/features/chat/conversation/ChatMetadataButton';

const { mockBreakpoint, popoverProps } = vi.hoisted(() => ({
    mockBreakpoint: { isMobile: false, isTablet: false, isDesktop: true },
    popoverProps: [] as any[],
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => mockBreakpoint,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/conversation/ConversationMetadataPopover', () => ({
    ConversationMetadataPopover: (props: any) => {
        popoverProps.push(props);
        return React.createElement('button', { 'data-testid': 'metadata-popover' }, 'i');
    },
}));

const BASE: ChatHeaderMetadata = {
    metadataProcess: { id: 'proc-1', metadata: { model: 'gpt-4' } },
    turnsCount: 3,
    isPending: false,
    resumeSessionId: 'sess-1',
    resumeLaunching: false,
    onLaunchInteractiveResume: vi.fn(),
    onCopyResumeCommand: vi.fn(),
    forking: false,
};

function renderButton(overrides: Partial<React.ComponentProps<typeof ChatMetadataButton>> = {}) {
    return render(<ChatMetadataButton {...BASE} {...overrides} />);
}

beforeEach(() => {
    popoverProps.length = 0;
    mockBreakpoint.isMobile = false;
});

describe('ChatMetadataButton', () => {
    it('renders the popover with the metadata bundle', () => {
        renderButton();
        expect(screen.getByTestId('metadata-popover')).toBeTruthy();
        expect(popoverProps[0].process).toBe(BASE.metadataProcess);
        expect(popoverProps[0].turnsCount).toBe(3);
    });

    it('renders nothing while the chat is pending', () => {
        const { container } = renderButton({ isPending: true });
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing without a merged process', () => {
        const { container } = renderButton({ metadataProcess: null });
        expect(container.innerHTML).toBe('');
    });

    it('drops the resume props on mobile', () => {
        mockBreakpoint.isMobile = true;
        renderButton();
        expect(popoverProps[0].resumeSessionId).toBeUndefined();
        expect(popoverProps[0].onLaunchInteractiveResume).toBeUndefined();
        expect(popoverProps[0].onCopyResumeCommand).toBeUndefined();
    });

    it('keeps the resume props on desktop', () => {
        renderButton();
        expect(popoverProps[0].resumeSessionId).toBe('sess-1');
        expect(popoverProps[0].onLaunchInteractiveResume).toBeTypeOf('function');
        expect(popoverProps[0].onCopyResumeCommand).toBeTypeOf('function');
    });

    it('forwards fork, fresh-context and extra rows untouched on both tiers', () => {
        const onFork = vi.fn();
        const onStartFreshSameContext = vi.fn();
        const extraRows = [{ label: 'Repository', value: 'coc' }];
        mockBreakpoint.isMobile = true;
        renderButton({ onFork, forking: true, onStartFreshSameContext, startingFreshSameContext: true, extraRows });
        expect(popoverProps[0].onFork).toBe(onFork);
        expect(popoverProps[0].forking).toBe(true);
        expect(popoverProps[0].onStartFreshSameContext).toBe(onStartFreshSameContext);
        expect(popoverProps[0].startingFreshSameContext).toBe(true);
        expect(popoverProps[0].extraRows).toBe(extraRows);
    });

    it('passes a custom trigger class through to the popover', () => {
        renderButton({ triggerClassName: 'h-6 w-6' });
        expect(popoverProps[0].triggerClassName).toBe('h-6 w-6');
    });
});
