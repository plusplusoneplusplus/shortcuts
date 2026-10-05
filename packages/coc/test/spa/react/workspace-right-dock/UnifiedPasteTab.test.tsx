// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { RichEditorCore } from '../../../../src/server/spa/client/react/features/notes/editor/RichEditorCore';
import { UnifiedTabView } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTabView';
import { clearPasteSnapshots, pasteOpenInput, storePasteSnapshot } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPasteTabs';

vi.mock('../../../../src/server/spa/client/react/hooks/useLinkHandlers', () => ({ useLinkHandlers: () => [{}] }));
const copy = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../src/server/spa/client/react/utils/format', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/server/spa/client/react/utils/format')>(),
    copyToClipboard: (content: string) => copy(content),
}));
beforeEach(() => { clearPasteSnapshots(); copy.mockClear(); });
afterEach(() => { cleanup(); clearPasteSnapshots(); });

function mountPaste(content: string) {
    const descriptor = pasteOpenInput(content, {
        ownerWorkspaceId: 'remote-member', ownerRoutingRef: 'remote:member', chatId: 'chat-1',
    });
    storePasteSnapshot('group', descriptor.resourceId, content);
    const dirty = vi.fn();
    const save = vi.fn();
    return { ...render(<UnifiedTabView tab={{ ...descriptor, id: 'paste-tab' }}
        scopeWorkspaceId="group" onClose={vi.fn()} onDirtyChange={dirty} onRegisterSave={save} />), dirty, save };
}

describe('paste tab read-only markdown', () => {
    it('renders rich markdown from the panel scope and copies the exact snapshot', async () => {
        const raw = '# Pasted heading\n\n- first\n- second\n\n```js\nconst x = 1;\n```\n';
        const { container, dirty, save } = mountPaste(raw);
        await screen.findByRole('heading', { name: 'Pasted heading', level: 1 });
        expect(container.querySelector('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
        expect(container.querySelectorAll('li')).toHaveLength(2);
        expect(container.querySelector('pre code')?.textContent).toContain('const x = 1;');
        expect(screen.queryByLabelText('Code block language')).toBeNull();
        expect(screen.queryByRole('toolbar')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Copy full content' }));
        await waitFor(() => expect(copy).toHaveBeenCalledWith(raw));
        expect(await screen.findByText('Copied')).toBeTruthy();
        expect(dirty).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
    });

    it('keeps image sizing fixed on hover and double click', async () => {
        const { container } = mountPaste('<img src="https://example.com/image.png" width="123" alt="paste image">');
        const image = await screen.findByAltText('paste image');
        fireEvent.mouseEnter(image.parentElement!);
        fireEvent.doubleClick(image.parentElement!);
        expect(container.querySelector('.image-resize-handle')).toBeNull();
        expect(image).toHaveAttribute('width', '123');
    });

    it('renders plain and empty content', async () => {
        const first = mountPaste('plain pasted text');
        await screen.findByText('plain pasted text');
        first.unmount();
        const { container } = mountPaste('');
        await waitFor(() => expect(container.querySelector('.ProseMirror')).toHaveAttribute('contenteditable', 'false'));
        fireEvent.click(screen.getByRole('button', { name: 'Copy full content' }));
        await waitFor(() => expect(copy).toHaveBeenCalledWith(''));
    });

    it('does not read another panel scope', () => {
        const descriptor = pasteOpenInput('private text', { ownerWorkspaceId: 'member', chatId: 'chat' });
        storePasteSnapshot('other-group', descriptor.resourceId, 'private text');
        render(<UnifiedTabView tab={{ ...descriptor, id: 'paste-tab' }} scopeWorkspaceId="group" onClose={vi.fn()} />);
        expect(screen.getByText('This pasted text is no longer available.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Copy full content' })).toBeNull();
    });

    it('keeps notes editable by default and supports read-only changes without updates', async () => {
        let editor: Editor | undefined;
        const ready = (value: Editor) => { editor = value; };
        const change = vi.fn();
        const { container, rerender } = render(<RichEditorCore onEditorReady={ready} onChange={change} />);
        await waitFor(() => expect(container.querySelector('.ProseMirror')).toHaveAttribute('contenteditable', 'true'));
        rerender(<RichEditorCore readOnly onEditorReady={ready} onChange={change} />);
        await waitFor(() => expect(container.querySelector('.ProseMirror')).toHaveAttribute('contenteditable', 'false'));
        act(() => { editor!.commands.setContent('<p>snapshot</p>'); });
        expect(change).not.toHaveBeenCalled();
        rerender(<RichEditorCore onEditorReady={ready} onChange={change} />);
        await waitFor(() => expect(container.querySelector('.ProseMirror')).toHaveAttribute('contenteditable', 'true'));
        act(() => { editor!.commands.setContent('<p>editable note</p>'); });
        expect(change).toHaveBeenCalled();
    });
});
