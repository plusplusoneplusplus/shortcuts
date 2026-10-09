import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContentSearchOverlayHost } from '../../../../src/server/spa/client/react/features/repo-detail/content-search/ContentSearchOverlayHost';
import { resetContentSearchMemoryForTests } from '../../../../src/server/spa/client/react/features/repo-detail/content-search/contentSearchStateStore';
import { focusedMonacoSelection, registerSelectionEditor } from '../../../../src/server/spa/client/react/shared/monaco/focusedSelection';

const { searchContent, searchGroup } = vi.hoisted(() => ({
    searchContent: vi.fn(),
    searchGroup: vi.fn(),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: { searchContent },
}));
vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    searchRepoGroupContent: searchGroup,
}));

const disposals: Array<() => void> = [];
beforeEach(() => {
    localStorage.clear();
    resetContentSearchMemoryForTests();
    vi.clearAllMocks();
    searchContent.mockResolvedValue({ matches: [], truncated: false });
    searchGroup.mockResolvedValue({ status: 'complete', members: [], failures: [], truncated: false });
});
afterEach(() => {
    cleanup();
    for (const dispose of disposals.splice(0)) dispose();
    document.body.innerHTML = '';
});

function buffer(text: string, empty = false) {
    const host = document.createElement('div');
    const input = document.createElement('textarea');
    host.append(input);
    document.body.append(host);
    const data = { text, empty, textFocus: true, model: true };
    disposals.push(registerSelectionEditor({
        getDomNode: () => host,
        hasTextFocus: () => data.textFocus && document.activeElement === input,
        getSelection: () => ({
            startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 3,
            isEmpty: () => data.empty,
        }),
        getModel: () => data.model ? { getValueInRange: () => data.text } : null,
    }));
    return { host, input, data };
}

function shortcut(cmd = false) {
    const event = new KeyboardEvent('keydown', {
        key: 'F', ctrlKey: !cmd, metaKey: cmd, shiftKey: true, bubbles: true, cancelable: true,
    });
    act(() => document.activeElement!.dispatchEvent(event));
    return event;
}

it.each([
    ['repo-a', undefined, undefined],
    ['repo-a', 'remote:one:repo-a', undefined],
    ['repo-a', 'remote:two:repo-a', undefined],
    ['group-team', 'remote:one:group-team', 'https://owner.example'],
])('seeds a literal multiline query before submission in %s (%s)', async (workspaceId, routingRef, baseUrl) => {
    render(<ContentSearchOverlayHost workspaceId={workspaceId} routingRef={routingRef} baseUrl={baseUrl} />);
    shortcut();
    fireEvent.click(screen.getByTestId('content-search-overlay-mode-regex'));
    fireEvent.change(screen.getByTestId('content-search-overlay-include'), { target: { value: '*.ts' } });
    fireEvent.keyDown(screen.getByTestId('content-search-overlay'), { key: 'Escape' });
    const text = '  a.*[value]\nnext\\line  ';
    const selected = buffer(text);
    selected.input.focus();
    const monacoHandler = vi.fn();
    selected.host.addEventListener('keydown', monacoHandler);
    expect(shortcut(true).defaultPrevented).toBe(true);
    expect(monacoHandler).not.toHaveBeenCalled();
    const query = screen.getByTestId('content-search-overlay-query');
    expect(query).toHaveValue(text);
    expect(screen.getByTestId('content-search-overlay-mode-regex')).toHaveAttribute('aria-pressed', 'false');
    expect(searchContent).not.toHaveBeenCalled();
    expect(searchGroup).not.toHaveBeenCalled();
    shortcut();
    expect(screen.getAllByTestId('content-search-overlay')).toHaveLength(1);
    expect(query).toHaveValue(text);
    fireEvent.keyDown(query, { key: 'Enter' });
    const search = baseUrl ? searchGroup : searchContent;
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith(workspaceId, text, expect.objectContaining({
        regex: false, include: ['*.ts'], fileScope: 'tracked',
    }), baseUrl ?? routingRef);
});

it.each(['collapsed', 'outside', 'find-widget', 'missing-model'])('preserves the prior query for %s focus/selection', kind => {
    render(<ContentSearchOverlayHost workspaceId="repo-a" />);
    shortcut();
    fireEvent.change(screen.getByTestId('content-search-overlay-query'), { target: { value: 'prior' } });
    fireEvent.click(screen.getByTestId('content-search-overlay-mode-regex'));
    fireEvent.keyDown(screen.getByTestId('content-search-overlay'), { key: 'Escape' });
    const stale = buffer('stale selection');
    const current = buffer('current selection', kind === 'collapsed');
    stale.input.focus();
    current.input.focus();
    if (kind === 'outside') {
        const outside = document.createElement('input');
        document.body.append(outside);
        outside.focus();
    }
    if (kind === 'find-widget') current.data.textFocus = false;
    if (kind === 'missing-model') current.data.model = false;
    expect(focusedMonacoSelection()).toBeUndefined();
    shortcut();
    expect(screen.getByTestId('content-search-overlay-query')).toHaveValue('prior');
    expect(screen.getByTestId('content-search-overlay-mode-regex')).toHaveAttribute('aria-pressed', 'true');
});

it('reads live text only from the currently focused registered editor and unregisters cleanly', () => {
    const old = buffer('old');
    const current = buffer('current');
    old.input.focus();
    expect(focusedMonacoSelection()).toBe('old');
    current.input.focus();
    current.data.text = 'unsaved changes';
    expect(focusedMonacoSelection()).toBe('unsaved changes');
    disposals.pop()!();
    expect(focusedMonacoSelection()).toBeUndefined();
});
