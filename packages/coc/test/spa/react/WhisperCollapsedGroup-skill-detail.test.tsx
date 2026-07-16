/* @vitest-environment jsdom */
/**
 * Tests for the Whisper skill list and panel-centered skill-detail dialog.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { WhisperCollapsedGroup } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperCollapsedGroup';
import { WhisperSkillDetailDialogProvider } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperSkillDetailDialog';
import type { WhisperSummary } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';

const { detailWorkspaceMock, detailGlobalMock } = vi.hoisted(() => ({
    detailWorkspaceMock: vi.fn(),
    detailGlobalMock: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/ui', () => ({
    cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => (
        <div data-testid="markdown-view" dangerouslySetInnerHTML={{ __html: html }} />
    ),
}));

vi.mock('../../../src/server/spa/client/react/features/chat/conversation/commitDetection', () => ({
    detectCommitsInToolGroup: () => [],
}));

vi.mock('../../../src/server/spa/client/react/features/chat/conversation/CommitStrip', () => ({
    CommitStrip: () => null,
}));

vi.mock('../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallGroupView', () => ({
    ToolCallGroupView: () => <div data-testid="tool-call-group-view" />,
}));

vi.mock('../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        groupConsecutiveToolChunks: () => [],
    };
});

vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        getCocClientForWorkspace: () => ({
            skills: {
                detailWorkspace: detailWorkspaceMock,
                detailGlobal: detailGlobalMock,
            },
        }),
    };
});

const DEFAULT_BOUNDARY = {
    top: 50,
    bottom: 530,
    left: 300,
    right: 940,
    width: 640,
    height: 480,
    x: 300,
    y: 50,
    toJSON: () => ({}),
} as DOMRect;

const SAMPLE_SKILL = {
    name: 'submit-commits-as-pr',
    description: 'Submit a single commit or a range of commits as a new GitHub pull request.',
    version: '2.1.0',
    relativePath: '.github/skills/submit-commits-as-pr',
    folderLabel: 'repo',
    promptBody: 'Line one of the body.\nLine two.\n' + 'x'.repeat(400),
};

interface RenderGroupOptions {
    workspaceId?: string;
    omitWorkspaceId?: boolean;
    boundaryRect?: DOMRect;
}

function TestSkillBoundary({
    summary,
    workspaceId,
    omitWorkspaceId,
    boundaryRect = DEFAULT_BOUNDARY,
}: {
    summary: WhisperSummary;
    workspaceId?: string;
    omitWorkspaceId?: boolean;
    boundaryRect?: DOMRect;
}) {
    const boundaryRef = React.useRef<HTMLDivElement | null>(null);

    React.useLayoutEffect(() => {
        if (!boundaryRef.current) return;
        vi.spyOn(boundaryRef.current, 'getBoundingClientRect').mockReturnValue(boundaryRect);
    }, [boundaryRect]);

    return (
        <div ref={boundaryRef} data-testid="skill-dialog-boundary">
            <WhisperSkillDetailDialogProvider boundaryRef={boundaryRef}>
                <WhisperCollapsedGroup
                    precedingChunks={[]}
                    summary={summary}
                    toolById={new Map()}
                    toolsWithChildren={new Set()}
                    toolParentById={new Map()}
                    isStreaming={false}
                    groupSingleLineMessages={false}
                    {...(omitWorkspaceId ? {} : { workspaceId })}
                    renderToolTree={() => null}
                />
            </WhisperSkillDetailDialogProvider>
        </div>
    );
}

function renderGroup(summary: WhisperSummary, options: RenderGroupOptions = {}) {
    return render(
        <TestSkillBoundary
            summary={summary}
            workspaceId={options.workspaceId ?? 'test-ws'}
            omitWorkspaceId={options.omitWorkspaceId}
            boundaryRect={options.boundaryRect}
        />,
    );
}

function hoverSkills(skillNames: string[], options: RenderGroupOptions = {}) {
    const view = renderGroup(
        { toolCallCount: 3, messageCount: 0, skillCount: skillNames.length, skillNames },
        options,
    );
    const span = view.container.querySelector('[data-testid="whisper-skill-hover"]') as HTMLElement;
    fireEvent.mouseEnter(span);
    return { ...view, span };
}

function skillRows(): HTMLElement[] {
    return Array.from(document.body.querySelectorAll('[data-testid="skill-popover-row"]')) as HTMLElement[];
}

function skillDialog(): HTMLElement | null {
    return document.body.querySelector('[data-testid="skill-detail-popover"]') as HTMLElement | null;
}

beforeEach(() => {
    detailWorkspaceMock.mockReset();
    detailGlobalMock.mockReset();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('WhisperCollapsedGroup skill list', () => {
    it('skill rows expose button semantics and are keyboard-focusable', () => {
        hoverSkills(['submit-commits-as-pr', 'impl']);
        const rows = skillRows();
        expect(rows).toHaveLength(2);
        rows.forEach(row => {
            expect(row.getAttribute('role')).toBe('button');
            expect(row.getAttribute('tabindex')).toBe('0');
        });
    });

    it('focus on the skill count opens the anchored list', () => {
        const { span } = hoverSkills(['submit-commits-as-pr']);
        fireEvent.mouseLeave(span);
        fireEvent.focus(span);

        expect(document.body.querySelector('[data-testid="skill-hover-popover"]')).not.toBeNull();
        expect(span.getAttribute('role')).toBe('button');
        expect(span.getAttribute('tabindex')).toBe('0');
    });
});

describe('WhisperCollapsedGroup centered skill detail dialog', () => {
    it('selecting a skill closes the anchored list and opens the panel-scoped dialog', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr']);

        fireEvent.click(skillRows()[0]);

        expect(document.body.querySelector('[data-testid="skill-hover-popover"]')).toBeNull();
        expect(document.body.querySelector('[data-testid="skill-detail-loading"]')).not.toBeNull();
        await waitFor(() => expect(skillDialog()?.querySelector('[data-testid="skill-detail-body"]')).not.toBeNull());
    });

    it('uses the active conversation panel bounds rather than the viewport', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr'], { boundaryRect: DEFAULT_BOUNDARY });

        fireEvent.click(skillRows()[0]);

        const overlay = document.body.querySelector('[data-testid="skill-detail-panel-overlay"]') as HTMLElement;
        expect(overlay.style.top).toBe('50px');
        expect(overlay.style.left).toBe('300px');
        expect(overlay.style.width).toBe('640px');
        expect(overlay.style.height).toBe('480px');
        expect(overlay.dataset.boundaryWidth).toBe('640');
    });

    it('recomputes the panel-scoped overlay when the boundary changes', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        const { getByTestId } = hoverSkills(['submit-commits-as-pr']);
        const boundary = getByTestId('skill-dialog-boundary');
        fireEvent.click(skillRows()[0]);

        vi.mocked(boundary.getBoundingClientRect).mockReturnValue({
            top: 20,
            bottom: 320,
            left: 120,
            right: 520,
            width: 400,
            height: 300,
            x: 120,
            y: 20,
            toJSON: () => ({}),
        } as DOMRect);
        act(() => { window.dispatchEvent(new Event('resize')); });

        await waitFor(() => {
            const overlay = document.body.querySelector('[data-testid="skill-detail-panel-overlay"]') as HTMLElement;
            expect(overlay.style.left).toBe('120px');
            expect(overlay.style.width).toBe('400px');
        });
    });

    it('shows description, source location, version, and the SKILL.md body', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr']);
        fireEvent.click(skillRows()[0]);

        await waitFor(() => expect(skillDialog()?.querySelector('[data-testid="skill-detail-body"]')).not.toBeNull());

        const dialog = skillDialog()!;
        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.querySelector('[data-testid="skill-detail-description"]')?.textContent).toContain('Submit a single commit');
        expect(dialog.querySelector('[data-testid="skill-detail-source"]')?.textContent).toContain('repo');
        expect(dialog.querySelector('[data-testid="skill-detail-version"]')?.textContent).toContain('2.1.0');

        const bodyEl = dialog.querySelector('[data-testid="skill-detail-body"]') as HTMLElement;
        expect(bodyEl.textContent).toContain('Line one of the body.');
        expect(bodyEl.tagName).toBe('PRE');
        expect(bodyEl.className).toMatch(/overflow-auto/);
        expect(bodyEl.className).toMatch(/flex-1/);
    });

    it('close button, Escape, and backdrop close the dialog', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        const { span } = hoverSkills(['submit-commits-as-pr']);
        span.focus();
        fireEvent.click(skillRows()[0]);
        await waitFor(() => expect(document.body.querySelector('[data-testid="skill-detail-close"]')).not.toBeNull());

        fireEvent.click(document.body.querySelector('[data-testid="skill-detail-close"]') as HTMLElement);
        await waitFor(() => expect(skillDialog()).toBeNull());

        fireEvent.mouseEnter(span);
        fireEvent.click(skillRows()[0]);
        await waitFor(() => expect(skillDialog()).not.toBeNull());
        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => expect(skillDialog()).toBeNull());

        fireEvent.mouseEnter(span);
        fireEvent.click(skillRows()[0]);
        await waitFor(() => expect(skillDialog()).not.toBeNull());
        fireEvent.click(document.body.querySelector('[data-testid="skill-detail-backdrop"]') as HTMLElement);
        await waitFor(() => expect(skillDialog()).toBeNull());
    });

    it('clicking inside the dialog does not close it', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr']);
        fireEvent.click(skillRows()[0]);
        await waitFor(() => expect(skillDialog()).not.toBeNull());

        fireEvent.click(skillDialog()!);

        expect(skillDialog()).not.toBeNull();
    });

    it('moves focus to the close button and restores focus to the skill trigger', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        const { span } = hoverSkills(['submit-commits-as-pr']);
        span.focus();
        fireEvent.click(skillRows()[0]);

        const closeButton = await waitFor(() => {
            const button = document.body.querySelector('[data-testid="skill-detail-close"]') as HTMLElement | null;
            expect(button).not.toBeNull();
            expect(document.activeElement).toBe(button);
            return button!;
        });

        fireEvent.click(closeButton);

        await waitFor(() => expect(document.activeElement).toBe(span));
    });
});

describe('WhisperCollapsedGroup skill detail fetch behavior', () => {
    it('does not fetch when the list popover merely opens', () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr', 'impl']);
        expect(detailWorkspaceMock).not.toHaveBeenCalled();
        expect(detailGlobalMock).not.toHaveBeenCalled();
    });

    it('fetches the workspace-scoped endpoint on row selection', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr']);
        fireEvent.keyDown(skillRows()[0], { key: 'Enter' });

        await waitFor(() => expect(detailWorkspaceMock).toHaveBeenCalledTimes(1));
        expect(detailWorkspaceMock).toHaveBeenCalledWith('test-ws', 'submit-commits-as-pr');
    });

    it('Space selects a skill row', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr']);
        fireEvent.keyDown(skillRows()[0], { key: ' ' });

        await waitFor(() => expect(skillDialog()).not.toBeNull());
    });

    it('falls back to the global endpoint when the workspace one fails', async () => {
        detailWorkspaceMock.mockRejectedValue(new Error('404'));
        detailGlobalMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr']);
        fireEvent.click(skillRows()[0]);

        await waitFor(() => expect(skillDialog()?.querySelector('[data-testid="skill-detail-body"]')).not.toBeNull());
        expect(detailWorkspaceMock).toHaveBeenCalledTimes(1);
        expect(detailGlobalMock).toHaveBeenCalledWith('submit-commits-as-pr');
    });

    it('shows a stable not-found state when both endpoints fail', async () => {
        detailWorkspaceMock.mockRejectedValue(new Error('404'));
        detailGlobalMock.mockRejectedValue(new Error('404'));
        hoverSkills(['deleted-skill']);
        fireEvent.click(skillRows()[0]);

        await waitFor(() => expect(skillDialog()?.querySelector('[data-testid="skill-detail-not-found"]')).not.toBeNull());
        expect(skillDialog()?.querySelector('[data-testid="skill-detail-body"]')).toBeNull();
    });

    it('caches the detail per skill name across reopens', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        const { span } = hoverSkills(['submit-commits-as-pr']);

        fireEvent.click(skillRows()[0]);
        await waitFor(() => expect(detailWorkspaceMock).toHaveBeenCalledTimes(1));
        fireEvent.click(document.body.querySelector('[data-testid="skill-detail-close"]') as HTMLElement);
        await waitFor(() => expect(skillDialog()).toBeNull());

        fireEvent.mouseEnter(span);
        fireEvent.click(skillRows()[0]);

        await waitFor(() => expect(skillDialog()?.querySelector('[data-testid="skill-detail-body"]')).not.toBeNull());
        expect(detailWorkspaceMock).toHaveBeenCalledTimes(1);
    });

    it('uses only the global endpoint when there is no workspace id', async () => {
        detailGlobalMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr'], { omitWorkspaceId: true });
        fireEvent.click(skillRows()[0]);

        await waitFor(() => expect(detailGlobalMock).toHaveBeenCalledTimes(1));
        expect(detailWorkspaceMock).not.toHaveBeenCalled();
    });

    it('falls back to relativePath for the source line when folderLabel is absent', async () => {
        detailWorkspaceMock.mockResolvedValue({
            skill: { ...SAMPLE_SKILL, folderLabel: undefined, folderPath: undefined },
        });
        hoverSkills(['submit-commits-as-pr']);
        fireEvent.click(skillRows()[0]);

        await waitFor(() => expect(skillDialog()?.querySelector('[data-testid="skill-detail-source"]')).not.toBeNull());
        expect(skillDialog()?.querySelector('[data-testid="skill-detail-source"]')?.textContent)
            .toContain('.github/skills/submit-commits-as-pr');
    });
});
