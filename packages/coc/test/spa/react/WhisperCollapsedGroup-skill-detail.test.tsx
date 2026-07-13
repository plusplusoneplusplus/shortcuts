/* @vitest-environment jsdom */
/**
 * Tests for the clickable skill rows + nested skill-detail popover in
 * WhisperCollapsedGroup (feature: skill-popup-details).
 *
 * AC-01 — clicking a skill name in the "N skills" popover opens a nested detail
 *         popover in place; Escape / click-outside close it.
 * AC-02 — the detail view shows description, source location, version, and the
 *         full SKILL.md prompt body (scrollable).
 * AC-03 — detail is fetched lazily on click via the remote-clone-safe client,
 *         cached per skill name, with a "not found" fallback on failure/404.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { WhisperCollapsedGroup } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperCollapsedGroup';
import type { WhisperSummary } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';

// ── Mocks ──────────────────────────────────────────────────────────────────────

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

// Route the on-demand skill-detail fetch through controllable mocks. Keep every
// real export (e.g. `lookupCloneBaseUrl`) so unrelated popovers still resolve.
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

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderGroup(summary: WhisperSummary, workspaceId: string | undefined = 'test-ws') {
    return render(
        <WhisperCollapsedGroup
            precedingChunks={[]}
            summary={summary}
            toolById={new Map()}
            toolsWithChildren={new Set()}
            toolParentById={new Map()}
            isStreaming={false}
            groupSingleLineMessages={false}
            workspaceId={workspaceId}
            renderToolTree={() => null}
        />
    );
}

function hoverSkills(skillNames: string[], workspaceId: string | undefined = 'test-ws') {
    const { container } = renderGroup(
        { toolCallCount: 3, messageCount: 0, skillCount: skillNames.length, skillNames },
        workspaceId,
    );
    const span = container.querySelector('[data-testid="whisper-skill-hover"]') as HTMLElement;
    fireEvent.mouseEnter(span);
    return { container, span };
}

function skillRows(): HTMLElement[] {
    return Array.from(document.body.querySelectorAll('[data-testid="skill-popover-row"]')) as HTMLElement[];
}

const SAMPLE_SKILL = {
    name: 'submit-commits-as-pr',
    description: 'Submit a single commit or a range of commits as a new GitHub pull request.',
    version: '2.1.0',
    relativePath: '.github/skills/submit-commits-as-pr',
    folderLabel: 'repo',
    promptBody: 'Line one of the body.\nLine two.\n' + 'x'.repeat(400),
};

beforeEach(() => {
    detailWorkspaceMock.mockReset();
    detailGlobalMock.mockReset();
});

// Unmount each render so portals + their document-level dismissal listeners are
// torn down; otherwise stale trees leak across tests.
afterEach(() => {
    cleanup();
});

// ── AC-01: clickable rows + nested detail popover ────────────────────────────

describe('WhisperCollapsedGroup — skill rows are clickable (AC-01)', () => {
    it('skill rows expose a button role and are keyboard-focusable', () => {
        hoverSkills(['submit-commits-as-pr', 'impl']);
        const rows = skillRows();
        expect(rows).toHaveLength(2);
        rows.forEach(row => {
            expect(row.getAttribute('role')).toBe('button');
            expect(row.getAttribute('tabindex')).toBe('0');
        });
    });

    it('clicking a skill row opens the nested detail popover', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr']);
        expect(document.body.querySelector('[data-testid="skill-detail-popover"]')).toBeNull();

        fireEvent.click(skillRows()[0]);

        expect(document.body.querySelector('[data-testid="skill-detail-popover"]')).not.toBeNull();
        await waitFor(() =>
            expect(document.body.querySelector('[data-testid="skill-detail-body"]')).not.toBeNull(),
        );
    });

    it('Escape closes the open detail popover', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr']);
        fireEvent.click(skillRows()[0]);
        await waitFor(() =>
            expect(document.body.querySelector('[data-testid="skill-detail-body"]')).not.toBeNull(),
        );

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(document.body.querySelector('[data-testid="skill-detail-popover"]')).toBeNull();
    });

    it('click-outside closes the open detail popover', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr']);
        fireEvent.click(skillRows()[0]);
        await waitFor(() =>
            expect(document.body.querySelector('[data-testid="skill-detail-popover"]')).not.toBeNull(),
        );

        act(() => { fireEvent.mouseDown(document.body); });

        expect(document.body.querySelector('[data-testid="skill-detail-popover"]')).toBeNull();
    });

    it('clicking inside the detail popover does NOT close it', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr']);
        fireEvent.click(skillRows()[0]);
        await waitFor(() =>
            expect(document.body.querySelector('[data-testid="skill-detail-body"]')).not.toBeNull(),
        );
        const body = document.body.querySelector('[data-testid="skill-detail-body"]') as HTMLElement;

        act(() => { fireEvent.mouseDown(body); });

        expect(document.body.querySelector('[data-testid="skill-detail-popover"]')).not.toBeNull();
    });

    it('clamps the detail popover within the viewport', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr']);
        const row = skillRows()[0];
        vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
            top: 40, bottom: 64, left: 24, right: 120, width: 96, height: 24, x: 24, y: 40, toJSON: () => ({}),
        } as DOMRect);

        fireEvent.click(row);
        const popover = document.body.querySelector('[data-testid="skill-detail-popover"]') as HTMLElement;
        expect(popover.style.top).toBe('68px'); // rect.bottom + 4
        expect(popover.style.left).toBe('24px');
    });
});

// ── AC-02: detail content ────────────────────────────────────────────────────

describe('WhisperCollapsedGroup — skill detail content (AC-02)', () => {
    it('shows description, source location, version, and the SKILL.md body', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr']);
        fireEvent.click(skillRows()[0]);

        await waitFor(() =>
            expect(document.body.querySelector('[data-testid="skill-detail-body"]')).not.toBeNull(),
        );

        const popover = document.body.querySelector('[data-testid="skill-detail-popover"]') as HTMLElement;
        expect(popover.querySelector('[data-testid="skill-detail-description"]')?.textContent)
            .toContain('Submit a single commit');
        expect(popover.querySelector('[data-testid="skill-detail-source"]')?.textContent).toContain('repo');
        expect(popover.querySelector('[data-testid="skill-detail-version"]')?.textContent).toContain('2.1.0');

        const bodyEl = popover.querySelector('[data-testid="skill-detail-body"]') as HTMLElement;
        expect(bodyEl.textContent).toContain('Line one of the body.');
        // The body is a pre-wrap PRE that flexes to fill the frame and scrolls.
        expect(bodyEl.tagName).toBe('PRE');
        expect(bodyEl.className).toMatch(/overflow-auto/);
        expect(bodyEl.className).toMatch(/flex-1/);
    });

    it('the detail popover is resizable (drag handle + bounded frame) when it has a body', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr']);
        fireEvent.click(skillRows()[0]);
        await waitFor(() =>
            expect(document.body.querySelector('[data-testid="skill-detail-body"]')).not.toBeNull(),
        );

        const popover = document.body.querySelector('[data-testid="skill-detail-popover"]') as HTMLElement;
        // `resize` gives the browser handle; a definite max within the viewport
        // keeps it from being dragged off-screen.
        expect(popover.className).toMatch(/\bresize\b/);
        expect(popover.className).toMatch(/max-h-\[80vh\]/);
        expect(popover.className).toMatch(/max-w-\[90vw\]/);
    });

    it('loading / not-found states stay a small auto box (not the resizable frame)', async () => {
        detailWorkspaceMock.mockRejectedValue(new Error('404'));
        detailGlobalMock.mockRejectedValue(new Error('404'));
        hoverSkills(['deleted-skill']);
        fireEvent.click(skillRows()[0]);
        await waitFor(() =>
            expect(document.body.querySelector('[data-testid="skill-detail-not-found"]')).not.toBeNull(),
        );

        const popover = document.body.querySelector('[data-testid="skill-detail-popover"]') as HTMLElement;
        expect(popover.className).not.toMatch(/\bresize\b/);
    });

    it('falls back to relativePath for the source line when folderLabel is absent', async () => {
        detailWorkspaceMock.mockResolvedValue({
            skill: { ...SAMPLE_SKILL, folderLabel: undefined, folderPath: undefined },
        });
        hoverSkills(['submit-commits-as-pr']);
        fireEvent.click(skillRows()[0]);

        await waitFor(() =>
            expect(document.body.querySelector('[data-testid="skill-detail-source"]')).not.toBeNull(),
        );
        expect(document.body.querySelector('[data-testid="skill-detail-source"]')?.textContent)
            .toContain('.github/skills/submit-commits-as-pr');
    });
});

// ── AC-03: on-demand, remote-clone-safe fetch + fallback + cache ─────────────

describe('WhisperCollapsedGroup — skill detail fetch (AC-03)', () => {
    it('does NOT fetch when the list popover merely opens (lazy)', () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr', 'impl']);
        expect(detailWorkspaceMock).not.toHaveBeenCalled();
        expect(detailGlobalMock).not.toHaveBeenCalled();
    });

    it('fetches the workspace-scoped endpoint on row click', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr']);
        fireEvent.click(skillRows()[0]);

        await waitFor(() => expect(detailWorkspaceMock).toHaveBeenCalledTimes(1));
        expect(detailWorkspaceMock).toHaveBeenCalledWith('test-ws', 'submit-commits-as-pr');
    });

    it('shows a loading state before the fetch resolves', async () => {
        let resolve!: (v: unknown) => void;
        detailWorkspaceMock.mockReturnValue(new Promise(r => { resolve = r; }));
        hoverSkills(['submit-commits-as-pr']);
        fireEvent.click(skillRows()[0]);

        expect(document.body.querySelector('[data-testid="skill-detail-loading"]')).not.toBeNull();
        await act(async () => { resolve({ skill: SAMPLE_SKILL }); });
        expect(document.body.querySelector('[data-testid="skill-detail-loading"]')).toBeNull();
    });

    it('falls back to the global endpoint when the workspace one fails', async () => {
        detailWorkspaceMock.mockRejectedValue(new Error('404'));
        detailGlobalMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr']);
        fireEvent.click(skillRows()[0]);

        await waitFor(() =>
            expect(document.body.querySelector('[data-testid="skill-detail-body"]')).not.toBeNull(),
        );
        expect(detailWorkspaceMock).toHaveBeenCalledTimes(1);
        expect(detailGlobalMock).toHaveBeenCalledWith('submit-commits-as-pr');
    });

    it('shows a "skill not found" note when both endpoints fail', async () => {
        detailWorkspaceMock.mockRejectedValue(new Error('404'));
        detailGlobalMock.mockRejectedValue(new Error('404'));
        hoverSkills(['deleted-skill']);
        fireEvent.click(skillRows()[0]);

        await waitFor(() =>
            expect(document.body.querySelector('[data-testid="skill-detail-not-found"]')).not.toBeNull(),
        );
        expect(document.body.querySelector('[data-testid="skill-detail-body"]')).toBeNull();
    });

    it('caches the detail per skill name across re-opens (fetch once)', async () => {
        detailWorkspaceMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        hoverSkills(['submit-commits-as-pr']);

        fireEvent.click(skillRows()[0]); // open
        await waitFor(() => expect(detailWorkspaceMock).toHaveBeenCalledTimes(1));
        fireEvent.click(skillRows()[0]); // collapse
        fireEvent.click(skillRows()[0]); // re-open

        await waitFor(() =>
            expect(document.body.querySelector('[data-testid="skill-detail-body"]')).not.toBeNull(),
        );
        expect(detailWorkspaceMock).toHaveBeenCalledTimes(1);
    });

    it('uses only the global endpoint when there is no workspace id', async () => {
        detailGlobalMock.mockResolvedValue({ skill: SAMPLE_SKILL });
        // Render with the workspaceId prop omitted (an explicit `undefined` would
        // hit the helper's default parameter, so build the tree inline here).
        const { container } = render(
            <WhisperCollapsedGroup
                precedingChunks={[]}
                summary={{ toolCallCount: 1, messageCount: 0, skillCount: 1, skillNames: ['submit-commits-as-pr'] }}
                toolById={new Map()}
                toolsWithChildren={new Set()}
                toolParentById={new Map()}
                isStreaming={false}
                groupSingleLineMessages={false}
                renderToolTree={() => null}
            />
        );
        fireEvent.mouseEnter(container.querySelector('[data-testid="whisper-skill-hover"]') as HTMLElement);
        fireEvent.click(skillRows()[0]);

        await waitFor(() => expect(detailGlobalMock).toHaveBeenCalledTimes(1));
        expect(detailWorkspaceMock).not.toHaveBeenCalled();
    });
});
