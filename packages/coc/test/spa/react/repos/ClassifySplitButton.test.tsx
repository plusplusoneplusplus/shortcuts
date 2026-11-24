import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ClassifySplitButton } from '../../../../src/server/spa/client/react/features/git/diff/ClassifySplitButton';
import type { UseClassificationReturn } from '../../../../src/server/spa/client/react/features/git/diff/useClassification';
import type { UseModalJobAiSelectionResult } from '../../../../src/server/spa/client/react/shared/ModalJobAiControls';

vi.mock('../../../../src/server/spa/client/react/features/git/diff/ClassifyDiffAiControls', () => ({
    ClassifyDiffAiControls: ({ selection, disabled }: any) => <button disabled={disabled} onClick={() => selection.setProvider('codex')}>Choose provider</button>,
}));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('portals settings outside clipping, follows the anchor and preserves interaction and focus', () => {
    let anchor = { right: window.innerWidth - 2, bottom: window.innerHeight - 2 };
    let resize: ResizeObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback: ResizeObserverCallback) { resize = callback; }
        observe() {}
        disconnect = disconnect;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
        if (this.classList.contains('git-review-popover')) return { width: 220, height: 100 } as DOMRect;
        if (this.classList.contains('git-file-review')) return { width: 320 } as DOMRect;
        return anchor as DOMRect;
    });
    const classify = vi.fn();
    const setProvider = vi.fn();
    const selection = { provider: 'copilot', agentProviders: [], setProvider } as unknown as UseModalJobAiSelectionResult;
    const classification = { state: { status: 'idle' }, classify } as unknown as UseClassificationReturn;
    const view = render(<div className="git-file-review" style={{ overflow: 'hidden' }}>
        <ClassifySplitButton classification={classification} aiSelection={selection} testIdPrefix="review" />
    </div>);
    const toggle = screen.getByRole('button', { name: /^Classification settings:/ });
    fireEvent.click(toggle);
    const dialog = screen.getByRole('dialog', { name: 'Classification settings' });
    expect(view.container.contains(dialog)).toBe(false);
    expect(dialog.parentElement!.parentElement).toBe(document.body);
    expect(dialog.parentElement!.style.width).toBe('320px');
    expect(dialog.id).toBe(toggle.getAttribute('aria-controls'));
    expect(dialog.style.left).toBe(`${window.innerWidth - 228}px`);
    expect(dialog.style.top).toBe(`${window.innerHeight - 108}px`);
    anchor = { right: 400, bottom: 100 };
    fireEvent.scroll(window);
    expect(dialog.style.left).toBe('180px');
    expect(dialog.style.top).toBe('104px');
    anchor = { right: 300, bottom: 80 };
    act(() => resize!([], {} as ResizeObserver));
    expect(dialog.style.left).toBe('80px');
    expect(dialog.style.top).toBe('84px');
    fireEvent.mouseDown(screen.getByText('Choose provider'));
    fireEvent.click(screen.getByText('Choose provider'));
    expect(setProvider).toHaveBeenCalledWith('codex');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // Nested provider/effort menus live outside the settings portal.
    const listbox = document.createElement('div');
    listbox.setAttribute('role', 'listbox');
    document.body.appendChild(listbox);
    fireEvent.mouseDown(listbox);
    expect(screen.getByRole('dialog')).toBe(dialog);
    listbox.remove();
    const effortMenu = document.createElement('div');
    effortMenu.setAttribute('role', 'group');
    effortMenu.setAttribute('aria-label', 'Effort tier settings');
    document.body.appendChild(effortMenu);
    fireEvent.mouseDown(effortMenu);
    expect(screen.getByRole('dialog')).toBe(dialog);
    effortMenu.remove();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(toggle);
    expect(disconnect).toHaveBeenCalledOnce();
    fireEvent.click(toggle);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Classify', exact: true }));
    expect(classify).toHaveBeenCalledOnce();
    view.unmount();
    expect(screen.queryByRole('dialog')).toBeNull();
    vi.unstubAllGlobals();
});
