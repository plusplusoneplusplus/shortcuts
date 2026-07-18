/**
 * Tests for ToolCallView's "whisper-row" compact variant rendered inside a
 * WhisperCollapsedGroup expanded body. Asserts:
 *   - The kind pill exists, has the correct label and color class per tool.
 *   - Path/summary is rendered and truncates instead of wrapping.
 *   - Metric is computed for Read/Grep/Edit/Glob/Shell.
 *   - The expand chevron toggles inline body visibility.
 *   - The card variant remains unchanged outside of the provider.
 */

import { describe, it, expect } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { ToolCallView } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallView';
import { ToolCallVariantProvider } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallVariant';

function renderInWhisper(toolCall: any) {
    return render(
        <ToolCallVariantProvider value="whisper-row">
            <ToolCallView toolCall={toolCall} />
        </ToolCallVariantProvider>
    );
}

describe('ToolCallView — whisper-row variant', () => {
    describe('kind pill', () => {
        it('renders a Read pill for view tool with blue color class', () => {
            const { getByTestId, container } = renderInWhisper({
                id: 't1',
                toolName: 'view',
                args: { path: '/repo/src/foo.ts' },
                result: 'line 1\nline 2\nline 3',
                status: 'completed',
            });
            const kind = getByTestId('tool-call-kind');
            expect(kind.textContent).toBe('Read');
            const cls = kind.className;
            expect(cls).toContain('bg-[#ddf4ff]');
            expect(cls).toContain('text-[#0969da]');
            const card = container.querySelector('[data-tool-variant="whisper-row"]');
            expect(card?.getAttribute('data-tool-kind')).toBe('read');
        });

        it('renders a Grep pill for grep tool with green color class', () => {
            const { getByTestId } = renderInWhisper({
                id: 't2',
                toolName: 'grep',
                args: { pattern: 'foo', path: '/x' },
                result: 'a.ts:1: foo\nb.ts:2: foo',
                status: 'completed',
            });
            const kind = getByTestId('tool-call-kind');
            expect(kind.textContent).toBe('Grep');
            expect(kind.className).toContain('bg-[#dafbe1]');
            expect(kind.className).toContain('text-[#15703a]');
        });

        it('renders an Edit pill for edit tool with amber color class', () => {
            const { getByTestId } = renderInWhisper({
                id: 't3',
                toolName: 'edit',
                args: { path: '/x.ts', old_str: 'a', new_str: 'b' },
                result: '',
                status: 'completed',
            });
            const kind = getByTestId('tool-call-kind');
            expect(kind.textContent).toBe('Edit');
            expect(kind.className).toContain('bg-[#fff1d6]');
            expect(kind.className).toContain('text-[#9a6700]');
        });

        it('renders a Write pill for create tool with amber color class', () => {
            const { getByTestId } = renderInWhisper({
                id: 't4',
                toolName: 'create',
                args: { path: '/x.ts', file_text: 'hello\nworld' },
                status: 'completed',
            });
            const kind = getByTestId('tool-call-kind');
            expect(kind.textContent).toBe('Write');
            expect(kind.className).toContain('bg-[#fff1d6]');
        });

        it('renders a Shell pill for bash tool with purple color class', () => {
            const { getByTestId } = renderInWhisper({
                id: 't5',
                toolName: 'bash',
                args: { command: 'npm test' },
                result: 'ok',
                status: 'completed',
            });
            const kind = getByTestId('tool-call-kind');
            expect(kind.textContent).toBe('Bash');
            expect(kind.className).toContain('bg-[#f0e7ff]');
            expect(kind.className).toContain('text-[#6f42c1]');
        });

        it('renders a neutral grey pill for unknown tools', () => {
            const { getByTestId } = renderInWhisper({
                id: 't6',
                toolName: 'random_thing',
                args: { foo: 'bar' },
                status: 'completed',
            });
            const kind = getByTestId('tool-call-kind');
            expect(kind.className).toContain('bg-[#f5f5f4]');
        });

        it('renders a "Skill" pill for the skill tool (lowercase)', () => {
            const { container } = renderInWhisper({
                id: 'sk1',
                toolName: 'skill',
                args: { name: 'impl' },
                status: 'completed',
            });
            const kind = container.querySelector('[data-testid="tool-call-kind"]');
            expect(kind?.textContent).toBe('Skill');
            expect(container.querySelector('[data-tool-kind]')?.getAttribute('data-tool-kind')).toBe('other');
        });

        it('renders a "Skill" pill for the Claude Code SDK PascalCase "Skill" tool name', () => {
            const { container } = renderInWhisper({
                id: 'sk2',
                toolName: 'Skill',
                args: { name: 'impl' },
                status: 'completed',
            });
            const kind = container.querySelector('[data-testid="tool-call-kind"]');
            expect(kind?.textContent).toBe('Skill');
            expect(container.querySelector('[data-tool-kind]')?.getAttribute('data-tool-kind')).toBe('other');
        });

        it('shows skill name in the row summary for both skill tool name casings', () => {
            // lowercase 'skill'
            const { container: c1 } = renderInWhisper({
                id: 'sk3',
                toolName: 'skill',
                args: { name: 'impl' },
                status: 'completed',
            });
            const path1 = c1.querySelector('.tool-call-row-path');
            expect(path1?.textContent).toBe('impl');

            // PascalCase 'Skill' — Claude Code SDK path
            const { container: c2 } = renderInWhisper({
                id: 'sk4',
                toolName: 'Skill',
                args: { name: 'go-deep' },
                status: 'completed',
            });
            const path2 = c2.querySelector('.tool-call-row-path');
            expect(path2?.textContent).toBe('go-deep');
        });

        it('shows skill name from args.skill and args.skill_name variants', () => {
            const { container: ca } = renderInWhisper({
                id: 'sk5',
                toolName: 'Skill',
                args: { skill: 'code-review' },
                status: 'completed',
            });
            expect(ca.querySelector('.tool-call-row-path')?.textContent).toBe('code-review');

            const { container: cb } = renderInWhisper({
                id: 'sk6',
                toolName: 'Skill',
                args: { skill_name: 'draft' },
                status: 'completed',
            });
            expect(cb.querySelector('.tool-call-row-path')?.textContent).toBe('draft');
        });

        it('uses muted grey pill while running regardless of tool kind', () => {
            const { getByTestId } = renderInWhisper({
                id: 't7',
                toolName: 'view',
                args: { path: '/x' },
                status: 'running',
            });
            const kind = getByTestId('tool-call-kind');
            expect(kind.className).toContain('bg-[#f5f5f4]');
            expect(kind.className).not.toContain('bg-[#ddf4ff]');
        });
    });

    describe('row layout', () => {
        it('renders kind + path + metric on a single row with truncate path', () => {
            const { container, getByTestId } = renderInWhisper({
                id: 't8',
                toolName: 'view',
                args: { path: '/repo/src/very/deep/nested/path/foo.ts' },
                result: '1\n2\n3\n4\n5',
                status: 'completed',
            });
            const header = container.querySelector('.tool-call-row-header');
            expect(header).toBeTruthy();
            const path = container.querySelector('.tool-call-row-path');
            expect(path).toBeTruthy();
            expect(path?.className).toContain('truncate');
            expect(path?.className).toContain('flex-1');
            const metric = getByTestId('tool-call-metric');
            expect(metric.textContent).toBe('5 lines');
        });

        it('shows hits metric for grep tool', () => {
            const { getByTestId } = renderInWhisper({
                id: 't9',
                toolName: 'grep',
                args: { pattern: 'x' },
                result: 'a.ts:1: x\nb.ts:2: x\nc.ts:3: x\nd.ts:4: x',
                status: 'completed',
            });
            expect(getByTestId('tool-call-metric').textContent).toBe('4 hits');
        });

        it('shows files metric for glob tool', () => {
            const { getByTestId } = renderInWhisper({
                id: 't10',
                toolName: 'glob',
                args: { pattern: '*.ts' },
                result: 'a.ts\nb.ts',
                status: 'completed',
            });
            expect(getByTestId('tool-call-metric').textContent).toBe('2 files');
        });

        it('shows +N −M diff metric for edit tool', () => {
            const { getByTestId } = renderInWhisper({
                id: 't11',
                toolName: 'edit',
                args: { path: '/x.ts', old_str: 'a\nb', new_str: 'a\nb\nc\nd' },
                status: 'completed',
            });
            const metric = getByTestId('tool-call-metric');
            expect(metric.textContent?.replace(/\s+/g, ' ').trim()).toBe('+4 −2');
        });

        it('renders no metric for tools without extractable data', () => {
            const { container } = renderInWhisper({
                id: 't12',
                toolName: 'task',
                args: { description: 'something' },
                status: 'completed',
            });
            expect(container.querySelector('[data-testid="tool-call-metric"]')).toBeNull();
        });

        it('renders the row body with white surface background', () => {
            const { container } = renderInWhisper({
                id: 't13',
                toolName: 'view',
                args: { path: '/x' },
                result: 'one',
                status: 'completed',
            });
            const card = container.querySelector('[data-tool-variant="whisper-row"]');
            expect(card?.className).toContain('bg-white');
        });
    });

    describe('expand/collapse', () => {
        it('toggles inline body when the row is clicked', () => {
            const { container } = renderInWhisper({
                id: 't14',
                toolName: 'view',
                args: { path: '/x' },
                result: 'visible content',
                status: 'completed',
            });
            const header = container.querySelector('.tool-call-row-header');
            expect(container.querySelector('.tool-call-row-body')).toBeNull();

            act(() => {
                fireEvent.click(header!);
            });
            const body = container.querySelector('.tool-call-row-body');
            expect(body).toBeTruthy();
            expect(body?.className).toContain('bg-[#fafafa]');
        });

        it('does not render expand chevron when the tool has no details', () => {
            const { container } = renderInWhisper({
                id: 't15',
                toolName: 'random',
                status: 'completed',
            });
            const header = container.querySelector('.tool-call-row-header');
            expect(header?.getAttribute('aria-expanded')).toBeNull();
        });
    });
});

describe('ToolCallView — semantic shell display', () => {
    it('renders a Search pill (green) for a wrapped rg shell command', () => {
        const { getByTestId, container } = renderInWhisper({
            id: 's1',
            toolName: 'command_execution',
            args: { command: "/bin/zsh -lc 'rg foo src'" },
            result: 'a.ts:1: foo\nb.ts:2: foo',
            status: 'completed',
        });
        const kind = getByTestId('tool-call-kind');
        expect(kind.textContent).toBe('Search');
        expect(kind.className).toContain('bg-[#dafbe1]');
        expect(kind.getAttribute('title')).toBe('Executed through shell; expand for the exact command');
        expect(container.querySelector('.tool-call-row-path')?.textContent).toBe('foo in src');
        expect(getByTestId('tool-call-metric').textContent).toBe('2 hits');
    });

    it('renders a Read pill (blue) for a sed -n shell command', () => {
        const { getByTestId } = renderInWhisper({
            id: 's2',
            toolName: 'shell',
            args: { command: "sed -n '1,5p' file.ts" },
            result: '1\n2\n3',
            status: 'completed',
        });
        const kind = getByTestId('tool-call-kind');
        expect(kind.textContent).toBe('Read');
        expect(kind.className).toContain('bg-[#ddf4ff]');
        expect(getByTestId('tool-call-metric').textContent).toBe('3 lines');
    });

    it('keeps a Shell pill (purple, no tooltip) for an unclassifiable command', () => {
        const { getByTestId } = renderInWhisper({
            id: 's3',
            toolName: 'shell',
            args: { command: 'npm run build' },
            result: 'done',
            status: 'completed',
        });
        const kind = getByTestId('tool-call-kind');
        expect(kind.textContent).toBe('Shell');
        expect(kind.className).toContain('bg-[#f0e7ff]');
        expect(kind.getAttribute('title')).toBeNull();
    });

    it('preserves the exact wrapped command in the expanded body and copy button', () => {
        const raw = "/bin/zsh -lc 'rg foo src'";
        const { container } = renderInWhisper({
            id: 's4',
            toolName: 'command_execution',
            args: { command: raw },
            result: 'hit',
            status: 'completed',
        });
        act(() => { fireEvent.click(container.querySelector('.tool-call-row-header')!); });
        const cmd = container.querySelector('.tool-call-row-body code');
        expect(cmd?.textContent).toBe(`$ ${raw}`);
    });
});

describe('ToolCallView — card variant title', () => {
    it('shows the title-cased semantic label instead of the lowercase shell name', () => {
        const { container } = render(
            <ToolCallVariantProvider value="card">
                <ToolCallView toolCall={{
                    id: 'c1',
                    toolName: 'shell',
                    args: { command: 'git status' },
                    status: 'completed',
                }} />
            </ToolCallVariantProvider>
        );
        expect(container.querySelector('.tool-call-name')?.textContent).toBe('Git');
    });
});

describe('ToolCallView — default card variant unchanged', () => {
    it('renders the legacy tool-call-card when no provider is present', () => {
        const { container } = render(
            <ToolCallView
                toolCall={{
                    id: 't',
                    toolName: 'view',
                    args: { path: '/x' },
                    result: 'one',
                    status: 'completed',
                }}
            />
        );
        expect(container.querySelector('.tool-call-card')).toBeTruthy();
        expect(container.querySelector('.tool-call-row-header')).toBeNull();
    });

    it('renders the legacy card when explicitly given variant="card"', () => {
        const { container } = render(
            <ToolCallVariantProvider value="card">
                <ToolCallView
                    toolCall={{ id: 't', toolName: 'view', args: { path: '/x' }, status: 'completed' }}
                />
            </ToolCallVariantProvider>
        );
        expect(container.querySelector('.tool-call-card')).toBeTruthy();
        expect(container.querySelector('.tool-call-row-header')).toBeNull();
    });
});
