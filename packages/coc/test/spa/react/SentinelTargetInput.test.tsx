/* @vitest-environment jsdom */
import React, { createRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SentinelTargetInput } from '../../../src/server/spa/client/react/features/chat/SentinelTargetInput';
import { RichTextInput, type RichTextInputHandle } from '../../../src/server/spa/client/react/shared/RichTextInput';
import { atomicPoint, readAtomicText } from '../../../src/server/spa/client/react/shared/atomicTargetText';
import { targetPlainText, targetSpans, targetToken } from '../../../src/server/shared/sentinel-target-reference';
import { clearDraft, getDraft, setDraft } from '../../../src/server/spa/client/react/features/chat/hooks/useDraftStore';
import { chatMarkdownToHtml } from '../../../src/server/spa/client/react/features/chat/conversation/markdownHtml';
const mocks = vi.hoisted(() => ({ enabled: false, remote: false, unresolved: false, discover: vi.fn(), request: vi.fn(), client: {} as any }));
vi.mock('../../../src/server/spa/client/react/utils/config', () => ({ getFeatureValue: () => mocks.enabled, DASHBOARD_CONFIG_UPDATED_EVENT: 'config-updated', getApiBase: () => '/api', isContainerMode: () => false }));
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({ useCocClient: () => mocks.client }));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({ resolveCloneRoute: () => mocks.unresolved ? { kind: 'unresolved-remote' } : mocks.remote ? { kind: 'remote', baseUrl: 'https://remote' } : { kind: 'local' } }));
vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({ getCocClientFor: () => mocks.client }));
vi.mock('../../../src/server/spa/client/react/features/chat/sentinelTargetDiscovery', () => ({ discoverSentinelTargets: mocks.discover }));
const repo = { kind: 'workspace' as const, serverIdentity: 'durable-local', workspaceId: 'ws' };
const rows = [
    { target: { kind: 'server', serverIdentity: 'durable-local' }, name: 'Local', owner: 'Local', online: true },
    { target: repo, name: 'shortcuts', owner: 'Local', online: true },
    { target: { ...repo, serverIdentity: 'durable-arm' }, name: 'shortcuts', owner: 'ubuntu-arm', online: true },
    { target: { kind: 'group', serverIdentity: 'durable-local', groupId: 'group-tools' }, name: 'Tools', owner: 'Local', online: true, members: 2 },
];
function Composer({ sentinel = true, owner = 'owner' }: { sentinel?: boolean; owner?: string }) {
    const [value, setValue] = useState('');
    return <SentinelTargetInput value={value} onChange={setValue} sentinel={sentinel} ownerRef={owner} data-testid="editor" />;
}
function type(text: string) {
    const editor = screen.getByTestId('editor');
    editor.focus(); editor.textContent = text;
    const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    fireEvent.input(editor);
}
beforeEach(() => {
    mocks.enabled = true; mocks.remote = false; mocks.unresolved = false;
    mocks.client = { request: mocks.request };
    mocks.request.mockReset().mockResolvedValue({ features: { sentinelTargetAutocompleteEnabled: true } });
    mocks.discover.mockReset().mockResolvedValue(rows);
    // jsdom lacks native undo commands. Native history is checked separately in Chromium.
    Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
describe('Sentinel target autocomplete', () => {
    it.each(['off', 'ordinary', 'unresolved'] as const)('does not discover targets when %s', async gate => {
        if (gate === 'off') mocks.enabled = false;
        if (gate === 'unresolved') mocks.unresolved = true;
        render(<Composer sentinel={gate !== 'ordinary'} />);
        type('#short');
        await act(async () => { await Promise.resolve(); });
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(mocks.discover).not.toHaveBeenCalled();
    });
    it('shows duplicate owner labels and selects by keyboard without sending', async () => {
        render(<Composer />); type('#short');
        await screen.findByRole('option', { name: /shortcuts.*Local/ });
        expect(screen.getAllByRole('option')).toHaveLength(2);
        fireEvent.keyDown(screen.getByTestId('editor'), { key: 'ArrowDown' });
        fireEvent.keyDown(screen.getByTestId('editor'), { key: 'Tab' });
        const text = readAtomicText(screen.getByTestId('editor'));
        expect(targetSpans(text)[0].target).toEqual({ ...repo, serverIdentity: 'durable-arm' });
        expect(screen.getByTestId('editor').querySelector('[contenteditable=false]')?.textContent).toBe('#ubuntu-arm / shortcuts');
    });
    it('drills into a server and requires explicit server-only selection', async () => {
        render(<Composer />); type('#Loc');
        await screen.findByRole('listbox');
        fireEvent.keyDown(screen.getByTestId('editor'), { key: 'Enter' });
        expect(readAtomicText(screen.getByTestId('editor'))).toBe('#Local/');
        await screen.findByText('Use this server');
        fireEvent.keyDown(screen.getByTestId('editor'), { key: 'Enter' });
        expect(targetSpans(readAtomicText(screen.getByTestId('editor')))[0].target).toEqual({ kind: 'server', serverIdentity: 'durable-local' });
    });
    it('shows group counts, no matches, loading, and Escape dismissal', async () => {
        let resolve!: (value: any) => void;
        mocks.discover.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        render(<Composer />); type('#Tools');
        expect(screen.getByRole('status').textContent).toContain('Loading');
        await act(async () => resolve(rows));
        expect(screen.getByText('Group · 2 members')).toBeTruthy();
        type('#nothing');
        expect(screen.getByRole('status').textContent).toContain('No matching');
        fireEvent.keyDown(screen.getByTestId('editor'), { key: 'Escape' });
        expect(screen.queryByRole('listbox')).toBeNull();
    });
    it('retries discovery errors and keeps offline rows unselectable', async () => {
        mocks.discover.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce([{ ...rows[1], online: false }]);
        render(<Composer />); type('#short');
        await screen.findByText('Discovery unavailable. Retry.');
        fireEvent.click(screen.getByRole('button', { name: 'Retry discovery' }));
        const row = await screen.findByRole('option');
        expect(row.getAttribute('aria-disabled')).toBe('true');
        fireEvent.click(row);
        expect(targetSpans(readAtomicText(screen.getByTestId('editor')))).toEqual([]);
        expect(screen.getByText(/Offline \/ unavailable/)).toBeTruthy();
    });
    it('drops late results after an owner change and gates on that remote owner', async () => {
        let resolve!: (value: any) => void;
        mocks.discover.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        const view = render(<Composer owner="first" />); type('#short');
        mocks.remote = true;
        mocks.request.mockResolvedValueOnce({ features: {} });
        view.rerender(<Composer owner="second" />);
        await act(async () => { resolve(rows); await Promise.resolve(); });
        expect(screen.queryByRole('listbox')).toBeNull();
    });
});
describe('atomic references survive drafts and messages', () => {
    it('restores multiple atoms, exposes readable clipboard text, and deletion leaves no stale target', () => {
        const text = `Compare ${targetToken(repo, '#Local / shortcuts')} with ${targetToken({ kind: 'server', serverIdentity: 'remote' }, '#ubuntu-arm')}`;
        setDraft('owner:process', text, 'sentinel');
        const ref = createRef<RichTextInputHandle>();
        render(<RichTextInput atomicTargets ref={ref} value={getDraft('owner:process')!.text} onChange={() => {}} data-testid="editor" />);
        expect(ref.current!.getValue()).toBe(text);
        expect(screen.getByTestId('editor').querySelectorAll('[contenteditable=false]')).toHaveLength(2);
        const range = document.createRange(); range.selectNodeContents(screen.getByTestId('editor'));
        window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
        const clipboard = { setData: vi.fn() };
        fireEvent.copy(screen.getByTestId('editor'), { clipboardData: clipboard });
        expect(clipboard.setData).toHaveBeenCalledWith('text/plain', targetPlainText(text));
        expect(clipboard.setData).toHaveBeenCalledWith('application/x-coc-sentinel-target-text', text);
        const first = targetSpans(text)[0];
        act(() => ref.current!.setValue(text, first.end));
        fireEvent.keyDown(screen.getByTestId('editor'), { key: 'Backspace' });
        expect(targetSpans(ref.current!.getValue()).map(s => s.target.kind)).toEqual(['server']);
        act(() => ref.current!.setValue('Edited normal text'));
        expect(targetSpans(ref.current!.getValue())).toEqual([]);
        clearDraft('owner:process'); expect(getDraft('owner:process')).toBeNull();
    });
    it('replaces the exact query after native blank-line blocks without consuming neighboring text', () => {
        const ref = createRef<RichTextInputHandle>();
        render(<RichTextInput atomicTargets ref={ref} value="" onChange={() => {}} data-testid="editor" />);
        screen.getByTestId('editor').innerHTML = 'First line<div><br></div><div>Compare #short</div>';
        const original = ref.current!.getValue();
        const token = targetToken(repo, '#Local / shortcuts');
        act(() => ref.current!.replaceRange!(original.indexOf('#short'), original.length, token + ' '));
        expect(ref.current!.getValue()).toBe('First line\n\nCompare ' + token + ' ');
    });
    it('renders sent targets as inert badges with owner labels', () => {
        const html = chatMarkdownToHtml(targetToken(repo, '#Local / shortcuts'));
        expect(html).toContain('sentinel-target-token');
        expect(html).toContain('#Local / shortcuts');
        expect(html).not.toContain('href=');
    });
    it('restores readable plain paste without inventing structured identities', () => {
        const ref = createRef<RichTextInputHandle>();
        render(<RichTextInput atomicTargets ref={ref} value="" onChange={() => {}} data-testid="editor" />);
        const editor = screen.getByTestId('editor');
        editor.focus(); const range = document.createRange(); range.setStart(...atomicPoint(editor, 0)); range.collapse(true);
        window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
        fireEvent.paste(editor, { clipboardData: { getData: (type: string) => type === 'text/plain' ? '#Local / shortcuts' : '' } });
        expect(targetSpans(ref.current!.getValue())).toEqual([]);
    });
});
