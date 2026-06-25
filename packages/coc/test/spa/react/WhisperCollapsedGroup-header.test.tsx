/**
 * Tests for WhisperCollapsedGroup — commit count in collapsed header.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { WhisperCollapsedGroup } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperCollapsedGroup';
import type { WhisperSummary, FileEdit } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../../src/server/spa/client/react/ui', () => ({
    cn: (...args: string[]) => args.filter(Boolean).join(' '),
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

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderHeader(summary: WhisperSummary) {
    return render(
        <WhisperCollapsedGroup
            precedingChunks={[]}
            summary={summary}
            toolById={new Map()}
            toolsWithChildren={new Set()}
            toolParentById={new Map()}
            isStreaming={false}
            groupSingleLineMessages={false}
            workspaceId="test-ws"
            renderToolTree={() => null}
        />
    );
}

function getHeaderText(container: HTMLElement): string {
    const btn = container.querySelector('button');
    return btn?.textContent?.trim() ?? '';
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('WhisperCollapsedGroup — header text', () => {
    it('shows commit count when commitCount > 1 (plural)', () => {
        const { container } = renderHeader({
            toolCallCount: 5,
            messageCount: 1,
            commitCount: 3,
            startTime: 1000,
            endTime: 3500,
        });
        const text = getHeaderText(container);
        expect(text).toContain('3 commits');
        expect(text).toContain('5 tool calls');
        expect(text).toContain('1 message');
    });

    it('shows singular "commit" when commitCount === 1', () => {
        const { container } = renderHeader({
            toolCallCount: 2,
            messageCount: 0,
            commitCount: 1,
            startTime: 1000,
            endTime: 2000,
        });
        const text = getHeaderText(container);
        expect(text).toContain('1 commit');
        expect(text).not.toContain('1 commits');
    });

    it('omits commit segment when commitCount is 0', () => {
        const { container } = renderHeader({
            toolCallCount: 3,
            messageCount: 1,
            commitCount: 0,
        });
        const text = getHeaderText(container);
        expect(text).not.toContain('commit');
    });

    it('omits commit segment when commitCount is undefined', () => {
        const { container } = renderHeader({
            toolCallCount: 3,
            messageCount: 1,
        });
        const text = getHeaderText(container);
        expect(text).not.toContain('commit');
    });

    it('dot-separates all parts: tool calls · messages · commits', () => {
        const { container } = renderHeader({
            toolCallCount: 4,
            messageCount: 2,
            commitCount: 2,
        });
        const text = getHeaderText(container);
        // Should have "4 tool calls · 2 messages · 2 commits"
        expect(text).toMatch(/4 tool calls\s*·\s*2 messages\s*·\s*2 commits/);
    });

    it('shows singular "PR" when prCount === 1', () => {
        const { container } = renderHeader({
            toolCallCount: 2,
            messageCount: 1,
            prCount: 1,
        });
        const text = getHeaderText(container);
        expect(text).toContain('1 PR');
        expect(text).not.toContain('1 PRs');
    });

    it('shows plural "PRs" when prCount > 1', () => {
        const { container } = renderHeader({
            toolCallCount: 3,
            messageCount: 1,
            prCount: 2,
        });
        const text = getHeaderText(container);
        expect(text).toContain('2 PRs');
    });

    it('omits PR segment when prCount is 0', () => {
        const { container } = renderHeader({
            toolCallCount: 3,
            messageCount: 1,
            prCount: 0,
        });
        const text = getHeaderText(container);
        expect(text).not.toContain('PR');
    });

    it('omits PR segment when prCount is undefined', () => {
        const { container } = renderHeader({
            toolCallCount: 3,
            messageCount: 1,
        });
        const text = getHeaderText(container);
        expect(text).not.toContain('PR');
    });

    it('dot-separates PRs after commits and before duration', () => {
        const { container } = renderHeader({
            toolCallCount: 4,
            messageCount: 2,
            fileEditCount: 1,
            commitCount: 1,
            prCount: 1,
            startTime: 1000,
            endTime: 2000,
        });
        const text = getHeaderText(container);
        expect(text).toMatch(/2 messages\s*·\s*1 file\s*·\s*1 commit\s*·\s*1 PR\s*\(1\.0s\)/);
    });

    it('renders PR hover span with data-testid when pull request metadata is available', () => {
        const { container } = renderHeader({
            toolCallCount: 2,
            messageCount: 1,
            prCount: 1,
            pullRequests: [
                {
                    number: 101,
                    url: 'https://github.com/org/repo/pull/101',
                    provider: 'github',
                    owner: 'org',
                    repo: 'repo',
                    toolCallId: 'tool-1',
                },
            ],
        });
        const span = container.querySelector('[data-testid="whisper-pr-hover"]');
        expect(span).not.toBeNull();
        expect(span?.textContent).toContain('1 PR');
    });

    it('shows duration when start and end times are set', () => {
        const { container } = renderHeader({
            toolCallCount: 1,
            messageCount: 0,
            commitCount: 1,
            startTime: 1000,
            endTime: 3500,
        });
        const text = getHeaderText(container);
        expect(text).toContain('(2.5s)');
    });
});

// ── PullRequestHoverPopover tests ──────────────────────────────────────────

describe('WhisperCollapsedGroup — PullRequestHoverPopover', () => {
    function renderAndHoverPullRequests() {
        const { container } = renderHeader({
            toolCallCount: 3,
            messageCount: 0,
            prCount: 2,
            pullRequests: [
                {
                    number: 101,
                    url: 'https://github.com/org/repo/pull/101',
                    provider: 'github',
                    owner: 'org',
                    repo: 'repo',
                    toolCallId: 'tool-1',
                },
                {
                    number: 102,
                    url: 'https://github.com/org/repo/pull/102',
                    provider: 'github',
                    owner: 'org',
                    repo: 'repo',
                    toolCallId: 'tool-2',
                },
            ],
        });
        const span = container.querySelector('[data-testid="whisper-pr-hover"]') as HTMLElement;
        if (span) {
            fireEvent.mouseEnter(span);
        }
        return { container, body: document.body, span };
    }

    it('popover renders linked PR rows', () => {
        const { body } = renderAndHoverPullRequests();
        const popover = body.querySelector('[data-testid="pr-hover-popover"]');
        expect(popover).not.toBeNull();
        const rows = body.querySelectorAll('[data-testid^="pr-popover-row-"]');
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('org/repo#101');
        expect(rows[1].textContent).toContain('org/repo#102');
    });

    it('PR rows open external pull request URLs in a new tab', () => {
        const { body } = renderAndHoverPullRequests();
        const row = body.querySelector('[data-testid="pr-popover-row-101"]') as HTMLAnchorElement;
        expect(row).not.toBeNull();
        expect(row.href).toBe('https://github.com/org/repo/pull/101');
        expect(row.target).toBe('_blank');
        expect(row.rel).toContain('noopener');
        expect(row.rel).toContain('noreferrer');
    });

    it('popover disappears on mouse leave', () => {
        vi.useFakeTimers();
        const { body, span } = renderAndHoverPullRequests();
        expect(body.querySelector('[data-testid="pr-hover-popover"]')).not.toBeNull();

        fireEvent.mouseLeave(span);
        act(() => { vi.advanceTimersByTime(200); });

        expect(body.querySelector('[data-testid="pr-hover-popover"]')).toBeNull();
        vi.useRealTimers();
    });

    it('renders the PR popover in a document.body portal at viewport coordinates', () => {
        const { container } = renderHeader({
            toolCallCount: 1,
            messageCount: 0,
            prCount: 1,
            pullRequests: [
                {
                    number: 101,
                    url: 'https://github.com/org/repo/pull/101',
                    provider: 'github',
                    owner: 'org',
                    repo: 'repo',
                    toolCallId: 'tool-1',
                },
            ],
        });
        const span = container.querySelector('[data-testid="whisper-pr-hover"]') as HTMLElement;
        vi.spyOn(span, 'getBoundingClientRect').mockReturnValue({
            top: 70,
            bottom: 92,
            left: 44,
            right: 88,
            width: 44,
            height: 22,
            x: 44,
            y: 70,
            toJSON: () => ({}),
        } as DOMRect);

        fireEvent.mouseEnter(span);

        const popover = document.body.querySelector('[data-testid="pr-hover-popover"]') as HTMLElement;
        expect(popover).not.toBeNull();
        expect(container.querySelector('[data-testid="pr-hover-popover"]')).toBeNull();
        expect(popover.style.top).toBe('96px');
        expect(popover.style.left).toBe('44px');
    });
});

// ── File count header tests ────────────────────────────────────────────────

describe('WhisperCollapsedGroup — file count in header', () => {
    it('shows plural "3 files" when fileEditCount > 1', () => {
        const { container } = renderHeader({
            toolCallCount: 5,
            messageCount: 1,
            fileEditCount: 3,
        });
        const text = getHeaderText(container);
        expect(text).toContain('3 files');
    });

    it('shows singular "1 file" when fileEditCount === 1', () => {
        const { container } = renderHeader({
            toolCallCount: 2,
            messageCount: 0,
            fileEditCount: 1,
        });
        const text = getHeaderText(container);
        expect(text).toContain('1 file');
        expect(text).not.toContain('1 files');
    });

    it('omits file segment when fileEditCount is 0', () => {
        const { container } = renderHeader({
            toolCallCount: 3,
            messageCount: 1,
            fileEditCount: 0,
        });
        const text = getHeaderText(container);
        expect(text).not.toMatch(/\bfile/);
    });

    it('omits file segment when fileEditCount is undefined', () => {
        const { container } = renderHeader({
            toolCallCount: 3,
            messageCount: 1,
        });
        const text = getHeaderText(container);
        expect(text).not.toMatch(/\bfile/);
    });

    it('files appear between messages and commits in order', () => {
        const { container } = renderHeader({
            toolCallCount: 4,
            messageCount: 2,
            fileEditCount: 3,
            commitCount: 1,
        });
        const text = getHeaderText(container);
        expect(text).toMatch(/2 messages\s*·\s*3 files\s*·\s*1 commit/);
    });

    it('renders file hover span with data-testid', () => {
        const fileEdits: FileEdit[] = [
            { path: 'src/a.ts', insertions: 5, deletions: 2, isCreate: false },
        ];
        const { container } = renderHeader({
            toolCallCount: 1,
            messageCount: 0,
            fileEditCount: 1,
            fileEdits,
        });
        const span = container.querySelector('[data-testid="whisper-file-hover"]');
        expect(span).not.toBeNull();
        expect(span?.textContent).toContain('1 file');
    });
});

// ── FileHoverPopover tests ─────────────────────────────────────────────────

describe('WhisperCollapsedGroup — FileHoverPopover', () => {
    function renderAndHoverFiles(fileEdits: FileEdit[]) {
        const { container } = renderHeader({
            toolCallCount: 3,
            messageCount: 0,
            fileEditCount: fileEdits.length,
            fileEdits,
        });
        const span = container.querySelector('[data-testid="whisper-file-hover"]') as HTMLElement;
        if (span) {
            fireEvent.mouseEnter(span);
        }
        return document.body;
    }

    it('popover renders file rows with correct icon and basename', () => {
        const container = renderAndHoverFiles([
            { path: 'src/utils.ts', insertions: 12, deletions: 3, isCreate: false },
            { path: 'src/new-file.ts', insertions: 25, deletions: 0, isCreate: true },
        ]);
        const popover = container.querySelector('[data-testid="file-hover-popover"]');
        expect(popover).not.toBeNull();
        const rows = container.querySelectorAll('[data-testid="file-popover-row"]');
        expect(rows).toHaveLength(2);
        // Check icons
        expect(rows[0].textContent).toContain('✏️');
        expect(rows[1].textContent).toContain('📄');
        // Check basenames
        expect(rows[0].textContent).toContain('utils.ts');
        expect(rows[1].textContent).toContain('new-file.ts');
    });

    it('popover shows +N and −N stats', () => {
        const container = renderAndHoverFiles([
            { path: 'src/a.ts', insertions: 4, deletions: 2, isCreate: false },
        ]);
        const row = container.querySelector('[data-testid="file-popover-row"]');
        expect(row?.textContent).toContain('+4');
        expect(row?.textContent).toContain('−2');
    });

    it('created files show no deletion count', () => {
        const container = renderAndHoverFiles([
            { path: 'src/b.ts', insertions: 10, deletions: 0, isCreate: true },
        ]);
        const row = container.querySelector('[data-testid="file-popover-row"]');
        expect(row?.textContent).toContain('+10');
        expect(row?.textContent).not.toContain('−');
    });

    it('keeps file popover open on inside click and dismisses it on outside click', () => {
        const container = renderAndHoverFiles([
            { path: 'src/a.ts', insertions: 4, deletions: 2, isCreate: false },
        ]);
        const popover = container.querySelector('[data-testid="file-hover-popover"]') as HTMLElement;

        fireEvent.mouseDown(popover);
        expect(container.querySelector('[data-testid="file-hover-popover"]')).not.toBeNull();

        fireEvent.mouseDown(document.body);

        expect(container.querySelector('[data-testid="file-hover-popover"]')).toBeNull();
    });

    it('renders the file popover in a document.body portal at viewport coordinates', () => {
        const { container } = renderHeader({
            toolCallCount: 1,
            messageCount: 0,
            fileEditCount: 1,
            fileEdits: [{ path: 'src/a.ts', insertions: 4, deletions: 2, isCreate: false }],
        });
        const span = container.querySelector('[data-testid="whisper-file-hover"]') as HTMLElement;
        vi.spyOn(span, 'getBoundingClientRect').mockReturnValue({
            top: 100,
            bottom: 120,
            left: 50,
            right: 110,
            width: 60,
            height: 20,
            x: 50,
            y: 100,
            toJSON: () => ({}),
        } as DOMRect);

        fireEvent.mouseEnter(span);

        const popover = document.body.querySelector('[data-testid="file-hover-popover"]') as HTMLElement;
        expect(popover).not.toBeNull();
        expect(container.querySelector('[data-testid="file-hover-popover"]')).toBeNull();
        expect(popover.style.top).toBe('124px');
        expect(popover.style.left).toBe('50px');
    });
});

// ── Skill count header tests ───────────────────────────────────────────────

describe('WhisperCollapsedGroup — skill count in header', () => {
    it('shows plural "3 skills" when skillCount > 1', () => {
        const { container } = renderHeader({
            toolCallCount: 5,
            messageCount: 1,
            skillCount: 3,
            skillNames: ['code-review', 'impl', 'test-gap-analysis'],
        });
        const text = getHeaderText(container);
        expect(text).toContain('3 skills');
    });

    it('shows singular "1 skill" when skillCount === 1', () => {
        const { container } = renderHeader({
            toolCallCount: 2,
            messageCount: 0,
            skillCount: 1,
            skillNames: ['impl'],
        });
        const text = getHeaderText(container);
        expect(text).toContain('1 skill');
        expect(text).not.toContain('1 skills');
    });

    it('omits skill segment when skillCount is 0', () => {
        const { container } = renderHeader({
            toolCallCount: 3,
            messageCount: 1,
            skillCount: 0,
        });
        const text = getHeaderText(container);
        expect(text).not.toMatch(/\bskill/);
    });

    it('omits skill segment when skillCount is undefined', () => {
        const { container } = renderHeader({
            toolCallCount: 3,
            messageCount: 1,
        });
        const text = getHeaderText(container);
        expect(text).not.toMatch(/\bskill/);
    });

    it('renders skill hover span with data-testid', () => {
        const { container } = renderHeader({
            toolCallCount: 1,
            messageCount: 0,
            skillCount: 2,
            skillNames: ['code-review', 'impl'],
        });
        const span = container.querySelector('[data-testid="whisper-skill-hover"]');
        expect(span).not.toBeNull();
        expect(span?.textContent).toContain('2 skills');
    });
});

// ── SkillHoverPopover tests ────────────────────────────────────────────────

describe('WhisperCollapsedGroup — SkillHoverPopover', () => {
    function renderAndHoverSkills(skillNames: string[]) {
        const { container } = renderHeader({
            toolCallCount: 3,
            messageCount: 0,
            skillCount: skillNames.length,
            skillNames,
        });
        const span = container.querySelector('[data-testid="whisper-skill-hover"]') as HTMLElement;
        if (span) {
            fireEvent.mouseEnter(span);
        }
        return document.body;
    }

    it('popover renders skill rows with icon and name', () => {
        const container = renderAndHoverSkills(['code-review', 'impl', 'test-gap-analysis']);
        const popover = container.querySelector('[data-testid="skill-hover-popover"]');
        expect(popover).not.toBeNull();
        const rows = container.querySelectorAll('[data-testid="skill-popover-row"]');
        expect(rows).toHaveLength(3);
        expect(rows[0].textContent).toContain('🛠');
        expect(rows[0].textContent).toContain('code-review');
        expect(rows[1].textContent).toContain('impl');
        expect(rows[2].textContent).toContain('test-gap-analysis');
    });

    it('popover shows single skill correctly', () => {
        const container = renderAndHoverSkills(['impl']);
        const rows = container.querySelectorAll('[data-testid="skill-popover-row"]');
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('impl');
    });

    it('popover disappears on mouse leave', () => {
        vi.useFakeTimers();
        const container = renderAndHoverSkills(['impl', 'code-review']);
        expect(container.querySelector('[data-testid="skill-hover-popover"]')).not.toBeNull();
        const span = container.querySelector('[data-testid="whisper-skill-hover"]') as HTMLElement;
        fireEvent.mouseLeave(span);
        act(() => { vi.advanceTimersByTime(200); });
        expect(container.querySelector('[data-testid="skill-hover-popover"]')).toBeNull();
        vi.useRealTimers();
    });

    it('dismisses skill popover on Escape', () => {
        const container = renderAndHoverSkills(['impl']);

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(container.querySelector('[data-testid="skill-hover-popover"]')).toBeNull();
    });

    it('renders the skill popover in a document.body portal at viewport coordinates', () => {
        const { container } = renderHeader({
            toolCallCount: 1,
            messageCount: 0,
            skillCount: 1,
            skillNames: ['impl'],
        });
        const span = container.querySelector('[data-testid="whisper-skill-hover"]') as HTMLElement;
        vi.spyOn(span, 'getBoundingClientRect').mockReturnValue({
            top: 80,
            bottom: 104,
            left: 32,
            right: 88,
            width: 56,
            height: 24,
            x: 32,
            y: 80,
            toJSON: () => ({}),
        } as DOMRect);

        fireEvent.mouseEnter(span);

        const popover = document.body.querySelector('[data-testid="skill-hover-popover"]') as HTMLElement;
        expect(popover).not.toBeNull();
        expect(container.querySelector('[data-testid="skill-hover-popover"]')).toBeNull();
        expect(popover.style.top).toBe('108px');
        expect(popover.style.left).toBe('32px');
    });
});

// ── Memory count header tests ──────────────────────────────────────────────

describe('WhisperCollapsedGroup — memory count in header', () => {
    it('shows plural "3 memories" when memoryCount > 1', () => {
        const { container } = renderHeader({
            toolCallCount: 5,
            messageCount: 1,
            memoryCount: 3,
            memoryActions: [
                { action: 'add', target: 'memory', content: 'fact one' },
                { action: 'replace', target: 'system', content: 'fact two' },
                { action: 'remove', target: 'memory', content: 'old fact' },
            ],
        });
        const text = getHeaderText(container);
        expect(text).toContain('3 memories');
    });

    it('shows singular "1 memory" when memoryCount === 1', () => {
        const { container } = renderHeader({
            toolCallCount: 2,
            messageCount: 0,
            memoryCount: 1,
            memoryActions: [{ action: 'add', target: 'memory', content: 'fact' }],
        });
        const text = getHeaderText(container);
        expect(text).toContain('1 memory');
        expect(text).not.toContain('1 memories');
    });

    it('omits memory segment when memoryCount is 0', () => {
        const { container } = renderHeader({
            toolCallCount: 3,
            messageCount: 1,
            memoryCount: 0,
        });
        const text = getHeaderText(container);
        expect(text).not.toMatch(/\bmemor/);
    });

    it('omits memory segment when memoryCount is undefined', () => {
        const { container } = renderHeader({
            toolCallCount: 3,
            messageCount: 1,
        });
        const text = getHeaderText(container);
        expect(text).not.toMatch(/\bmemor/);
    });

    it('renders memory hover span with data-testid', () => {
        const { container } = renderHeader({
            toolCallCount: 1,
            messageCount: 0,
            memoryCount: 2,
            memoryActions: [
                { action: 'add', target: 'memory', content: 'fact one' },
                { action: 'replace', target: 'system', content: 'fact two' },
            ],
        });
        const span = container.querySelector('[data-testid="whisper-memory-hover"]');
        expect(span).not.toBeNull();
        expect(span?.textContent).toContain('2 memories');
    });
});

// ── MemoryHoverPopover tests ───────────────────────────────────────────────

describe('WhisperCollapsedGroup — MemoryHoverPopover', () => {
    function renderAndHoverMemory(actions: Array<{ action: string; target: string; content?: string }>) {
        const { container } = renderHeader({
            toolCallCount: 3,
            messageCount: 0,
            memoryCount: actions.length,
            memoryActions: actions,
        });
        const span = container.querySelector('[data-testid="whisper-memory-hover"]') as HTMLElement;
        if (span) {
            fireEvent.mouseEnter(span);
        }
        return document.body;
    }

    it('popover renders memory rows with action icon, target badge, and content', () => {
        const container = renderAndHoverMemory([
            { action: 'add', target: 'memory', content: 'fact one' },
            { action: 'replace', target: 'system', content: 'fact two' },
            { action: 'remove', target: 'memory', content: 'old fact' },
        ]);
        const popover = container.querySelector('[data-testid="memory-hover-popover"]');
        expect(popover).not.toBeNull();
        const rows = container.querySelectorAll('[data-testid="memory-popover-row"]');
        expect(rows).toHaveLength(3);
        expect(rows[0].textContent).toContain('➕');
        expect(rows[0].textContent).toContain('memory');
        expect(rows[0].textContent).toContain('fact one');
        expect(rows[1].textContent).toContain('🔄');
        expect(rows[1].textContent).toContain('system');
        expect(rows[2].textContent).toContain('➖');
    });

    it('popover shows single memory correctly', () => {
        const container = renderAndHoverMemory([
            { action: 'add', target: 'system', content: 'important fact' },
        ]);
        const rows = container.querySelectorAll('[data-testid="memory-popover-row"]');
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('important fact');
    });

    it('popover truncates long content with ellipsis', () => {
        const longContent = 'x'.repeat(80);
        const container = renderAndHoverMemory([
            { action: 'add', target: 'memory', content: longContent },
        ]);
        const rows = container.querySelectorAll('[data-testid="memory-popover-row"]');
        expect(rows[0].textContent).toContain('x'.repeat(60) + '…');
    });

    it('does not reveal full memory content before the long-hover delay', () => {
        vi.useFakeTimers();
        const longContent = 'stored memory fact '.repeat(8);
        const container = renderAndHoverMemory([
            { action: 'add', target: 'repo', content: longContent },
        ]);
        const content = container.querySelector('[data-testid="memory-popover-content-0"]') as HTMLElement;

        fireEvent.mouseEnter(content);
        act(() => { vi.advanceTimersByTime(699); });

        expect(container.querySelector('[data-testid="memory-full-content-popover"]')).toBeNull();
        vi.useRealTimers();
    });

    it('reveals full memory content after a long hover over the preview', () => {
        vi.useFakeTimers();
        const longContent = 'line one\nline two with enough detail to exceed the preview limit\nline three';
        const container = renderAndHoverMemory([
            { action: 'add', target: 'repo', content: longContent },
        ]);
        const content = container.querySelector('[data-testid="memory-popover-content-0"]') as HTMLElement;

        fireEvent.mouseEnter(content);
        act(() => { vi.advanceTimersByTime(700); });

        expect(container.querySelector('[data-testid="memory-full-content-popover"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="memory-full-content"]')?.textContent).toBe(longContent);
        vi.useRealTimers();
    });

    it('hides full memory content when leaving the preview', () => {
        vi.useFakeTimers();
        const longContent = 'stored memory fact '.repeat(8);
        const container = renderAndHoverMemory([
            { action: 'add', target: 'repo', content: longContent },
        ]);
        const content = container.querySelector('[data-testid="memory-popover-content-0"]') as HTMLElement;

        fireEvent.mouseEnter(content);
        act(() => { vi.advanceTimersByTime(700); });
        expect(container.querySelector('[data-testid="memory-full-content-popover"]')).not.toBeNull();

        fireEvent.mouseLeave(content);

        expect(container.querySelector('[data-testid="memory-full-content-popover"]')).toBeNull();
        vi.useRealTimers();
    });

    it('dismisses memory popover on outside click', () => {
        const container = renderAndHoverMemory([
            { action: 'add', target: 'memory', content: 'fact' },
        ]);

        fireEvent.mouseDown(document.body);

        expect(container.querySelector('[data-testid="memory-hover-popover"]')).toBeNull();
    });

    it('renders memory popovers in document.body portals at viewport coordinates', () => {
        vi.useFakeTimers();
        const longContent = 'line one\nline two with enough detail to exceed the preview limit\nline three';
        const { container } = renderHeader({
            toolCallCount: 1,
            messageCount: 0,
            memoryCount: 1,
            memoryActions: [{ action: 'add', target: 'repo', content: longContent }],
        });
        const span = container.querySelector('[data-testid="whisper-memory-hover"]') as HTMLElement;
        vi.spyOn(span, 'getBoundingClientRect').mockReturnValue({
            top: 120,
            bottom: 142,
            left: 72,
            right: 152,
            width: 80,
            height: 22,
            x: 72,
            y: 120,
            toJSON: () => ({}),
        } as DOMRect);

        fireEvent.mouseEnter(span);

        const popover = document.body.querySelector('[data-testid="memory-hover-popover"]') as HTMLElement;
        expect(popover).not.toBeNull();
        expect(container.querySelector('[data-testid="memory-hover-popover"]')).toBeNull();
        expect(popover.style.top).toBe('146px');
        expect(popover.style.left).toBe('72px');

        const content = document.body.querySelector('[data-testid="memory-popover-content-0"]') as HTMLElement;
        vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
            top: 180,
            bottom: 202,
            left: 96,
            right: 320,
            width: 224,
            height: 22,
            x: 96,
            y: 180,
            toJSON: () => ({}),
        } as DOMRect);
        fireEvent.mouseEnter(content);
        act(() => { vi.advanceTimersByTime(700); });

        const fullPopover = document.body.querySelector('[data-testid="memory-full-content-popover"]') as HTMLElement;
        expect(fullPopover).not.toBeNull();
        expect(container.querySelector('[data-testid="memory-full-content-popover"]')).toBeNull();
        expect(fullPopover.id).toBe('memory-full-content-0');
        expect(content.getAttribute('aria-describedby')).toBe('memory-full-content-0');
        expect(fullPopover.style.top).toBe('206px');
        expect(fullPopover.style.left).toBe('96px');
        vi.useRealTimers();
    });

    it('popover disappears on mouse leave', () => {
        vi.useFakeTimers();
        const container = renderAndHoverMemory([
            { action: 'add', target: 'memory', content: 'fact' },
            { action: 'replace', target: 'system', content: 'fact two' },
        ]);
        expect(container.querySelector('[data-testid="memory-hover-popover"]')).not.toBeNull();
        const span = container.querySelector('[data-testid="whisper-memory-hover"]') as HTMLElement;
        fireEvent.mouseLeave(span);
        act(() => { vi.advanceTimersByTime(200); });
        expect(container.querySelector('[data-testid="memory-hover-popover"]')).toBeNull();
        vi.useRealTimers();
    });
});

// ── Actionable file rows (AC-01) ───────────────────────────────────────────

describe('WhisperCollapsedGroup — actionable file rows', () => {
    function renderActionableFiles(
        fileEdits: FileEdit[],
        opts: {
            onOpenFileDiff?: (ctx: unknown) => void;
            precedingChunks?: any[];
            toolById?: Map<string, any>;
            commits?: any[];
        } = {},
    ) {
        const { container } = render(
            <WhisperCollapsedGroup
                precedingChunks={opts.precedingChunks ?? []}
                summary={{
                    toolCallCount: 3,
                    messageCount: 0,
                    fileEditCount: fileEdits.length,
                    fileEdits,
                    ...(opts.commits ? { commitCount: opts.commits.length, commits: opts.commits } : {}),
                } as WhisperSummary}
                toolById={opts.toolById ?? new Map()}
                toolsWithChildren={new Set()}
                toolParentById={new Map()}
                isStreaming={false}
                groupSingleLineMessages={false}
                workspaceId="test-ws"
                renderToolTree={() => null}
                onOpenFileDiff={opts.onOpenFileDiff}
            />,
        );
        const span = container.querySelector('[data-testid="whisper-file-hover"]') as HTMLElement;
        if (span) fireEvent.mouseEnter(span);
        return document.body;
    }

    it('marks active rows as buttons with keyboard affordance when a handler is wired', () => {
        const body = renderActionableFiles(
            [{ path: 'src/a.ts', insertions: 4, deletions: 2, netInsertions: 4, netDeletions: 2, isCreate: false, isDeleted: false }],
            { onOpenFileDiff: vi.fn() },
        );
        const row = body.querySelector('[data-testid="file-popover-row"]') as HTMLElement;
        expect(row.getAttribute('role')).toBe('button');
        expect(row.getAttribute('tabindex')).toBe('0');
        expect(row.getAttribute('aria-label')).toBe('Open diff for src/a.ts');
    });

    it('leaves rows non-interactive when no handler is provided', () => {
        const body = renderActionableFiles(
            [{ path: 'src/a.ts', insertions: 4, deletions: 2, netInsertions: 4, netDeletions: 2, isCreate: false, isDeleted: false }],
        );
        const row = body.querySelector('[data-testid="file-popover-row"]') as HTMLElement;
        expect(row.getAttribute('role')).toBeNull();
        expect(row.getAttribute('tabindex')).toBeNull();
    });

    it('opens the diff with the clicked file and the group tool calls on click', () => {
        const onOpenFileDiff = vi.fn();
        const toolById = new Map<string, any>([
            ['t1', { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'old', new_str: 'new' } }],
        ]);
        const precedingChunks = [{ kind: 'tool', key: 'k1', toolId: 't1' }];
        const body = renderActionableFiles(
            [{ path: 'src/a.ts', insertions: 1, deletions: 1, netInsertions: 1, netDeletions: 1, isCreate: false, isDeleted: false }],
            { onOpenFileDiff, toolById, precedingChunks },
        );
        const row = body.querySelector('[data-testid="file-popover-row"]') as HTMLElement;
        fireEvent.click(row);

        expect(onOpenFileDiff).toHaveBeenCalledTimes(1);
        const ctx = onOpenFileDiff.mock.calls[0][0];
        expect(ctx.file.path).toBe('src/a.ts');
        expect(ctx.workspaceId).toBe('test-ws');
        expect(ctx.toolCalls).toEqual([
            { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'old', new_str: 'new' } },
        ]);
    });

    it('passes detected group commits through for the commit-diff fallback', () => {
        const onOpenFileDiff = vi.fn();
        const commits = [{ shortHash: 'abc1234', fullHash: 'abc1234def', subject: 'fix: x', isFixup: false }];
        const body = renderActionableFiles(
            [{ path: 'src/a.ts', insertions: 1, deletions: 0, netInsertions: 1, netDeletions: 0, isCreate: false, isDeleted: false }],
            { onOpenFileDiff, commits },
        );
        fireEvent.click(body.querySelector('[data-testid="file-popover-row"]') as HTMLElement);
        expect(onOpenFileDiff.mock.calls[0][0].commits).toEqual(commits);
    });

    it('activates the row on Enter and Space keys', () => {
        const onOpenFileDiff = vi.fn();
        const body = renderActionableFiles(
            [{ path: 'src/a.ts', insertions: 1, deletions: 1, netInsertions: 1, netDeletions: 1, isCreate: false, isDeleted: false }],
            { onOpenFileDiff },
        );
        const row = body.querySelector('[data-testid="file-popover-row"]') as HTMLElement;
        fireEvent.keyDown(row, { key: 'Enter' });
        fireEvent.keyDown(row, { key: ' ' });
        expect(onOpenFileDiff).toHaveBeenCalledTimes(2);
    });

    it('keeps created files actionable', () => {
        const onOpenFileDiff = vi.fn();
        const body = renderActionableFiles(
            [{ path: 'src/new.ts', insertions: 10, deletions: 0, netInsertions: 10, netDeletions: 0, isCreate: true, isDeleted: false }],
            { onOpenFileDiff },
        );
        const row = body.querySelector('[data-testid="file-popover-row"]') as HTMLElement;
        expect(row.getAttribute('role')).toBe('button');
        fireEvent.click(row);
        expect(onOpenFileDiff).toHaveBeenCalledTimes(1);
    });

    it('keeps deleted rows visibly removed and disabled even with a handler', () => {
        const onOpenFileDiff = vi.fn();
        const body = renderActionableFiles(
            [{ path: 'src/gone.ts', insertions: 0, deletions: 5, netInsertions: 0, netDeletions: 5, isCreate: false, isDeleted: true }],
            { onOpenFileDiff },
        );
        const row = body.querySelector('[data-testid="file-popover-row-deleted"]') as HTMLElement;
        expect(row).not.toBeNull();
        expect(row.getAttribute('role')).toBeNull();
        expect(row.getAttribute('aria-disabled')).toBe('true');
        expect(row.textContent).toContain('removed');
        fireEvent.click(row);
        expect(onOpenFileDiff).not.toHaveBeenCalled();
    });
});
