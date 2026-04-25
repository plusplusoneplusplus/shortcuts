import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScratchpadDivider } from '../../../../../../src/server/spa/client/react/features/chat/scratchpad/ScratchpadDivider';
import type { ScratchpadDividerProps } from '../../../../../../src/server/spa/client/react/features/chat/scratchpad/ScratchpadDivider';

function renderDivider(overrides: Partial<ScratchpadDividerProps> = {}) {
    const props: ScratchpadDividerProps = {
        linkedNotePath: null,
        expandMode: 'split',
        isDragging: false,
        onMouseDown: vi.fn(),
        onOpenFilePicker: vi.fn(),
        onExpandTop: vi.fn(),
        onExpandBottom: vi.fn(),
        onSplitReset: vi.fn(),
        onClose: vi.fn(),
        ...overrides,
    };
    const result = render(<ScratchpadDivider {...props} />);
    return { ...result, props };
}

describe('ScratchpadDivider — single-file mode (files.length < 2)', () => {
    it('renders "Scratchpad" when linkedNotePath is null', () => {
        renderDivider({ linkedNotePath: null });
        expect(screen.getByTestId('scratchpad-file-btn').textContent).toContain('Scratchpad');
    });

    it('renders filename with .md stripped when linkedNotePath is set', () => {
        renderDivider({ linkedNotePath: 'tasks/my-notes.md' });
        const btn = screen.getByTestId('scratchpad-file-btn');
        expect(btn.textContent).toContain('my-notes');
        expect(btn.textContent).not.toContain('.md');
    });

    it('renders all five control buttons with correct data-testid', () => {
        renderDivider();
        expect(screen.getByTestId('scratchpad-file-btn')).toBeTruthy();
        expect(screen.getByTestId('scratchpad-expand-top-btn')).toBeTruthy();
        expect(screen.getByTestId('scratchpad-expand-bottom-btn')).toBeTruthy();
        expect(screen.getByTestId('scratchpad-split-btn')).toBeTruthy();
        expect(screen.getByTestId('scratchpad-close-btn')).toBeTruthy();
    });

    it('clicking file button calls onOpenFilePicker', () => {
        const { props } = renderDivider();
        fireEvent.click(screen.getByTestId('scratchpad-file-btn'));
        expect(props.onOpenFilePicker).toHaveBeenCalledTimes(1);
        expect(props.onMouseDown).not.toHaveBeenCalled();
    });

    it('does not render tab strip when files prop is omitted', () => {
        renderDivider();
        expect(screen.queryByTestId('scratchpad-file-tabs')).toBeNull();
    });

    it('does not render tab strip when files has one entry', () => {
        renderDivider({ files: ['single.md'] });
        expect(screen.queryByTestId('scratchpad-file-tabs')).toBeNull();
        expect(screen.getByTestId('scratchpad-file-btn')).toBeTruthy();
    });
});

describe('ScratchpadDivider — tab strip mode (files.length >= 2)', () => {
    it('renders a tab for each file when 2+ files are provided', () => {
        renderDivider({
            files: ['tasks/output.md', 'tasks/notes.md'],
            linkedNotePath: 'tasks/output.md',
            onSelectFile: vi.fn(),
        });
        expect(screen.getByTestId('scratchpad-file-tabs')).toBeTruthy();
        expect(screen.getByTestId('scratchpad-tab-output')).toBeTruthy();
        expect(screen.getByTestId('scratchpad-tab-notes')).toBeTruthy();
    });

    it('strips .md extension from tab labels', () => {
        renderDivider({
            files: ['report.md', 'summary.md'],
            linkedNotePath: 'report.md',
            onSelectFile: vi.fn(),
        });
        expect(screen.getByTestId('scratchpad-tab-report').textContent).toBe('report');
        expect(screen.getByTestId('scratchpad-tab-summary').textContent).toBe('summary');
    });

    it('active tab has blue accent class', () => {
        renderDivider({
            files: ['a.md', 'b.md'],
            linkedNotePath: 'a.md',
            onSelectFile: vi.fn(),
        });
        // Active tab gets an explicit blue border-bottom; inactive gets border-transparent
        expect(screen.getByTestId('scratchpad-tab-a').className).toContain('border-[#0078d4]');
        expect(screen.getByTestId('scratchpad-tab-b').className).toContain('border-transparent');
        expect(screen.getByTestId('scratchpad-tab-b').className).not.toContain('border-[#0078d4]');
    });

    it('active tab has aria-current="page"', () => {
        renderDivider({
            files: ['a.md', 'b.md'],
            linkedNotePath: 'b.md',
            onSelectFile: vi.fn(),
        });
        expect(screen.getByTestId('scratchpad-tab-b').getAttribute('aria-current')).toBe('page');
        expect(screen.getByTestId('scratchpad-tab-a').getAttribute('aria-current')).toBeNull();
    });

    it('clicking a tab calls onSelectFile with the file path', () => {
        const onSelectFile = vi.fn();
        renderDivider({
            files: ['first.md', 'second.md'],
            linkedNotePath: 'first.md',
            onSelectFile,
        });
        fireEvent.click(screen.getByTestId('scratchpad-tab-second'));
        expect(onSelectFile).toHaveBeenCalledWith('second.md');
        expect(onSelectFile).toHaveBeenCalledTimes(1);
    });

    it('clicking a tab does NOT call onMouseDown', () => {
        const onMouseDown = vi.fn();
        const onSelectFile = vi.fn();
        renderDivider({
            files: ['a.md', 'b.md'],
            linkedNotePath: 'a.md',
            onMouseDown,
            onSelectFile,
        });
        fireEvent.click(screen.getByTestId('scratchpad-tab-b'));
        expect(onMouseDown).not.toHaveBeenCalled();
    });

    it('does not render the single-file button in tab mode', () => {
        renderDivider({
            files: ['x.md', 'y.md'],
            linkedNotePath: 'x.md',
            onSelectFile: vi.fn(),
        });
        expect(screen.queryByTestId('scratchpad-file-btn')).toBeNull();
    });

    it('active matching is case-insensitive', () => {
        renderDivider({
            files: ['Tasks/Output.md', 'tasks/notes.md'],
            linkedNotePath: 'tasks/output.md',
            onSelectFile: vi.fn(),
        });
        const outputTab = screen.getByTestId('scratchpad-tab-Output');
        expect(outputTab.className).toContain('border-[#0078d4]');
    });
});

describe('ScratchpadDivider — shared controls', () => {
    it('active expand-mode "top" button has blue accent class', () => {
        renderDivider({ expandMode: 'top' });
        expect(screen.getByTestId('scratchpad-expand-top-btn').className).toContain('text-[#0078d4]');
        expect(screen.getByTestId('scratchpad-expand-bottom-btn').className).not.toContain('text-[#0078d4]');
        expect(screen.getByTestId('scratchpad-split-btn').className).not.toContain('text-[#0078d4]');
    });

    it('active expand-mode "bottom" button has blue accent class', () => {
        renderDivider({ expandMode: 'bottom' });
        expect(screen.getByTestId('scratchpad-expand-bottom-btn').className).toContain('text-[#0078d4]');
        expect(screen.getByTestId('scratchpad-expand-top-btn').className).not.toContain('text-[#0078d4]');
    });

    it('active expand-mode "split" button has blue accent class', () => {
        renderDivider({ expandMode: 'split' });
        expect(screen.getByTestId('scratchpad-split-btn').className).toContain('text-[#0078d4]');
    });

    it('clicking expand-top calls onExpandTop and NOT onMouseDown', () => {
        const { props } = renderDivider();
        fireEvent.click(screen.getByTestId('scratchpad-expand-top-btn'));
        expect(props.onExpandTop).toHaveBeenCalledTimes(1);
        expect(props.onMouseDown).not.toHaveBeenCalled();
    });

    it('clicking expand-bottom calls onExpandBottom', () => {
        const { props } = renderDivider();
        fireEvent.click(screen.getByTestId('scratchpad-expand-bottom-btn'));
        expect(props.onExpandBottom).toHaveBeenCalledTimes(1);
        expect(props.onMouseDown).not.toHaveBeenCalled();
    });

    it('clicking split-reset calls onSplitReset', () => {
        const { props } = renderDivider();
        fireEvent.click(screen.getByTestId('scratchpad-split-btn'));
        expect(props.onSplitReset).toHaveBeenCalledTimes(1);
        expect(props.onMouseDown).not.toHaveBeenCalled();
    });

    it('clicking close calls onClose', () => {
        const { props } = renderDivider();
        fireEvent.click(screen.getByTestId('scratchpad-close-btn'));
        expect(props.onClose).toHaveBeenCalledTimes(1);
        expect(props.onMouseDown).not.toHaveBeenCalled();
    });

    it('onMouseDown is called when mouse-downing on the divider bar background', () => {
        const { props } = renderDivider();
        fireEvent.mouseDown(screen.getByTestId('scratchpad-divider'));
        expect(props.onMouseDown).toHaveBeenCalledTimes(1);
    });

    it('isDragging=true applies the active-drag background class', () => {
        renderDivider({ isDragging: true });
        const divider = screen.getByTestId('scratchpad-divider');
        expect(divider.className).toContain('bg-[#e8f4fd]');
    });

    it('isDragging=false does not apply the active-drag background class', () => {
        renderDivider({ isDragging: false });
        const divider = screen.getByTestId('scratchpad-divider');
        expect(divider.className).not.toContain('bg-[#e8f4fd]');
    });

    it('has role=separator with horizontal orientation', () => {
        renderDivider();
        const divider = screen.getByTestId('scratchpad-divider');
        expect(divider.getAttribute('role')).toBe('separator');
        expect(divider.getAttribute('aria-orientation')).toBe('horizontal');
    });
});

describe('ScratchpadDivider — vertical layout', () => {
    it('renders with vertical orientation when layout="vertical"', () => {
        renderDivider({ layout: 'vertical' });
        const divider = screen.getByTestId('scratchpad-divider');
        expect(divider.getAttribute('aria-orientation')).toBe('vertical');
    });

    it('uses cursor-col-resize in vertical mode', () => {
        renderDivider({ layout: 'vertical' });
        const divider = screen.getByTestId('scratchpad-divider');
        expect(divider.className).toContain('cursor-col-resize');
        expect(divider.className).not.toContain('cursor-row-resize');
    });

    it('uses w-8 class in vertical mode instead of h-8', () => {
        renderDivider({ layout: 'vertical' });
        const divider = screen.getByTestId('scratchpad-divider');
        expect(divider.className).toContain('w-8');
        expect(divider.className).not.toContain('h-8');
    });

    it('uses border-l in vertical mode instead of border-t', () => {
        renderDivider({ layout: 'vertical' });
        const divider = screen.getByTestId('scratchpad-divider');
        expect(divider.className).toContain('border-l');
        expect(divider.className).not.toContain('border-t');
    });

    it('renders SVG chevron-left icon for expand-top button in vertical mode', () => {
        renderDivider({ layout: 'vertical' });
        const btn = screen.getByTestId('scratchpad-expand-top-btn');
        expect(btn.querySelector('svg')).not.toBeNull();
    });

    it('renders SVG chevron-right icon for expand-bottom button in vertical mode', () => {
        renderDivider({ layout: 'vertical' });
        const btn = screen.getByTestId('scratchpad-expand-bottom-btn');
        expect(btn.querySelector('svg')).not.toBeNull();
    });

    it('renders SVG grip icon in vertical mode', () => {
        renderDivider({ layout: 'vertical' });
        const grip = screen.getByTestId('scratchpad-grip');
        expect(grip.querySelector('svg')).not.toBeNull();
    });

    it('renders SVG grip icon in horizontal mode', () => {
        renderDivider({ layout: 'horizontal' });
        const grip = screen.getByTestId('scratchpad-grip');
        expect(grip.querySelector('svg')).not.toBeNull();
    });

    it('renders file button in vertical mode', () => {
        renderDivider({ layout: 'vertical', linkedNotePath: 'tasks/note.md' });
        expect(screen.getByTestId('scratchpad-file-btn')).toBeTruthy();
    });

    it('isDragging=true applies active-drag bg in vertical mode', () => {
        renderDivider({ layout: 'vertical', isDragging: true });
        const divider = screen.getByTestId('scratchpad-divider');
        expect(divider.className).toContain('bg-[#e8f4fd]');
    });
});

describe('ScratchpadDivider — Windows path handling', () => {
    it('displays only filename from a Windows backslash path', () => {
        renderDivider({ linkedNotePath: 'C:\\Users\\user\\tasks\\my-notes.md' });
        const btn = screen.getByTestId('scratchpad-file-btn');
        expect(btn.textContent).toContain('my-notes');
        expect(btn.textContent).not.toContain('C:\\');
        expect(btn.textContent).not.toContain('.md');
    });

    it('tab names show only filename from Windows paths', () => {
        renderDivider({
            files: ['C:\\Users\\user\\tasks\\output.md', 'C:\\Users\\user\\tasks\\notes.md'],
            linkedNotePath: 'C:\\Users\\user\\tasks\\output.md',
            onSelectFile: vi.fn(),
        });
        expect(screen.getByTestId('scratchpad-tab-output').textContent).toBe('output');
        expect(screen.getByTestId('scratchpad-tab-notes').textContent).toBe('notes');
    });

    it('handles mixed separators in paths', () => {
        renderDivider({ linkedNotePath: 'C:\\Users/tasks\\plan.md' });
        const btn = screen.getByTestId('scratchpad-file-btn');
        expect(btn.textContent).toContain('plan');
        expect(btn.textContent).not.toContain('C:\\');
    });
});

describe('ScratchpadDivider — SVG icons', () => {
    it('expand-top button renders SVG icon in horizontal mode', () => {
        renderDivider({ layout: 'horizontal' });
        const btn = screen.getByTestId('scratchpad-expand-top-btn');
        expect(btn.querySelector('svg')).not.toBeNull();
    });

    it('expand-bottom button renders SVG icon in horizontal mode', () => {
        renderDivider({ layout: 'horizontal' });
        const btn = screen.getByTestId('scratchpad-expand-bottom-btn');
        expect(btn.querySelector('svg')).not.toBeNull();
    });

    it('split button renders SVG icon', () => {
        renderDivider();
        const btn = screen.getByTestId('scratchpad-split-btn');
        expect(btn.querySelector('svg')).not.toBeNull();
    });

    it('close button renders SVG icon', () => {
        renderDivider();
        const btn = screen.getByTestId('scratchpad-close-btn');
        expect(btn.querySelector('svg')).not.toBeNull();
    });

    it('file button contains SVG file icon', () => {
        renderDivider({ linkedNotePath: 'notes.md' });
        const btn = screen.getByTestId('scratchpad-file-btn');
        expect(btn.querySelector('svg')).not.toBeNull();
    });

    it('active-mode button has highlighted background', () => {
        renderDivider({ expandMode: 'top' });
        const btn = screen.getByTestId('scratchpad-expand-top-btn');
        expect(btn.className).toContain('bg-[#dbeeff]');
    });
});

describe('ScratchpadDivider — tab strip overflow fade', () => {
    it('renders right-edge fade overlay in tab mode', () => {
        renderDivider({
            files: ['a.md', 'b.md'],
            linkedNotePath: 'a.md',
            onSelectFile: vi.fn(),
        });
        expect(screen.getByTestId('scratchpad-tab-fade')).toBeTruthy();
    });

    it('active tab has elevated background', () => {
        renderDivider({
            files: ['a.md', 'b.md'],
            linkedNotePath: 'a.md',
            onSelectFile: vi.fn(),
        });
        const activeTab = screen.getByTestId('scratchpad-tab-a');
        expect(activeTab.className).toContain('bg-white');
        expect(activeTab.className).toContain('font-medium');
    });
});
