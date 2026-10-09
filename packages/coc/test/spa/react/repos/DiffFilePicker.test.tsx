import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DiffFilePicker } from '../../../../src/server/spa/client/react/features/git/diff/DiffFilePicker';

const flags = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../../../src/server/spa/client/react/featureFlags', () => ({
    get SHOW_DIFF_FILE_PICKER() { return flags.enabled; },
}));

const files = ['src/alpha.ts', 'test/alpha.ts', 'src/Beta.ts'];

function setup(overrides: Partial<React.ComponentProps<typeof DiffFilePicker>> = {}) {
    const onSelect = vi.fn();
    const props = { filePath: files[0], files, onSelect, ...overrides };
    const view = render(<DiffFilePicker {...props}>alpha.ts</DiffFilePicker>);
    return { ...view, props, onSelect, trigger: screen.getByRole('button', { name: 'Jump to file: src/alpha.ts' }) };
}

describe('DiffFilePicker', () => {
    beforeEach(() => { flags.enabled = true; });
    afterEach(() => { vi.restoreAllMocks(); });

    it('is disabled by default flag, without changing the path content or click action', () => {
        flags.enabled = false;
        const onClick = vi.fn();
        render(<DiffFilePicker filePath={files[0]} files={files} onSelect={vi.fn()} onClick={onClick}>alpha.ts</DiffFilePicker>);
        expect(screen.queryByRole('button')).toBeNull();
        fireEvent.click(screen.getByText('alpha.ts'));
        expect(onClick).toHaveBeenCalledOnce();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it.each([
        { files: [files[0]], onSelect: vi.fn() },
        { files: [], onSelect: vi.fn() },
        { files, onSelect: undefined },
    ])('keeps a non-interactive path when navigation is unavailable: %j', props => {
        render(<DiffFilePicker filePath={files[0]} {...props}>alpha.ts</DiffFilePicker>);
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('opens at the header, focuses search, marks the current file, and selects the exact path', () => {
        const { trigger, onSelect } = setup();
        fireEvent.click(trigger);
        const input = screen.getByRole('combobox', { name: 'Search changed files' });
        expect(document.activeElement).toBe(input);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getAllByRole('option')).toHaveLength(3);
        expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
        fireEvent.click(screen.getAllByRole('option')[1]);
        expect(onSelect).toHaveBeenCalledExactlyOnceWith('test/alpha.ts');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('searches the full path without case sensitivity and handles empty results', () => {
        const { trigger, onSelect } = setup();
        fireEvent.click(trigger);
        const input = screen.getByRole('combobox');
        fireEvent.change(input, { target: { value: ' TEST/ ' } });
        expect(screen.getAllByRole('option')).toHaveLength(1);
        fireEvent.change(input, { target: { value: 'absent' } });
        expect(screen.queryByRole('option')).toBeNull();
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSelect).not.toHaveBeenCalled();
        expect(screen.getByText('No changed files match your search.')).toBeTruthy();
        fireEvent.change(input, { target: { value: 'BETA' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSelect).toHaveBeenCalledExactlyOnceWith('src/Beta.ts');
    });

    it('supports bounded Up/Down navigation and resets the active item when filtering', () => {
        const { trigger, onSelect } = setup();
        fireEvent.click(trigger);
        const input = screen.getByRole('combobox');
        fireEvent.keyDown(input, { key: 'ArrowUp' });
        expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0].id);
        for (let index = 0; index < 5; index++) fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[2].id);
        fireEvent.change(input, { target: { value: 'alpha' } });
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSelect).toHaveBeenCalledExactlyOnceWith('test/alpha.ts');
    });

    it('closes on Escape and restores trigger focus without selecting', () => {
        const { trigger, onSelect } = setup();
        fireEvent.click(trigger);
        fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('closes on outside click or focus, but not a click inside the picker', () => {
        const { trigger } = setup();
        fireEvent.click(trigger);
        fireEvent.pointerDown(screen.getByRole('combobox'));
        expect(screen.getByRole('dialog')).toBeTruthy();
        fireEvent.pointerDown(document.body);
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(trigger);
        fireEvent.focusIn(document.body);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes on host scroll or resize without closing when its list scrolls', () => {
        const { trigger } = setup();
        fireEvent.click(trigger);
        fireEvent.scroll(screen.getByRole('listbox'));
        expect(screen.getByRole('dialog')).toBeTruthy();
        fireEvent.scroll(document);
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(trigger);
        fireEvent.resize(window);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it.each(['ctrlKey', 'metaKey'] as const)('preserves %s clicks without opening the picker', modifier => {
        const onClick = vi.fn();
        const { trigger } = setup({ onClick });
        fireEvent.click(trigger, { [modifier]: true });
        expect(onClick).toHaveBeenCalledOnce();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('honors an existing prevented click', () => {
        const { trigger } = setup({ onClick: event => event.preventDefault() });
        fireEvent.click(trigger);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('resets a stale picker when changed files or the current file change', () => {
        const { trigger, props, rerender } = setup();
        fireEvent.click(trigger);
        rerender(<DiffFilePicker {...props} files={['other/first.ts', 'other/second.ts']}>alpha.ts</DiffFilePicker>);
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(trigger);
        expect(screen.getAllByRole('option')[0].title).toBe('other/first.ts');
        rerender(<DiffFilePicker {...props} filePath="src/Beta.ts">Beta.ts</DiffFilePicker>);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('unmounts the portal and event listeners with its header', () => {
        const { trigger, unmount, onSelect } = setup();
        fireEvent.click(trigger);
        unmount();
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.pointerDown(document.body);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('opens above a low header and clamps its right edge to the viewport', () => {
        const { trigger } = setup();
        const rect = new DOMRect(window.innerWidth - 20, window.innerHeight - 50, 120, 30);
        vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(rect);
        fireEvent.click(trigger);
        const picker = screen.getByRole('dialog');
        const left = Number.parseFloat(picker.style.left);
        const top = Number.parseFloat(picker.style.top);
        const height = Number.parseFloat(picker.style.maxHeight);
        expect(left).toBeGreaterThanOrEqual(8);
        expect(left + Math.min(560, window.innerWidth - 16)).toBeLessThanOrEqual(window.innerWidth - 8);
        expect(top).toBeGreaterThanOrEqual(8);
        expect(top + height).toBeLessThanOrEqual(rect.top);
    });
});
