/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { Router } from '../../../../src/server/spa/client/react/layout/Router';
import { QueueProvider, useQueue } from '../../../../src/server/spa/client/react/contexts/QueueContext';
import { queueJobHash } from '../../../../src/server/spa/client/react/queue/queueJobRoute';
import { resolveChatSubTab } from '../../../../src/server/spa/client/react/layout/dashboardRoutes';

const client = vi.hoisted(() => ({ options: {} as { baseUrl?: string; apiBasePath?: string } }));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRouting', () => ({ useCocClient: () => client }));
vi.mock('../../../../src/server/spa/client/react/layout/DashboardChatReferenceRoute', () => ({
    DashboardChatReferenceRoute: () => <div>Chat reference</div>,
}));

let queueDispatch: ReturnType<typeof useQueue>['dispatch'];
function SeedList() {
    const { dispatch } = useQueue();
    queueDispatch = dispatch;
    useLayoutEffect(() => {
        dispatch({ type: 'REPO_HISTORY_UPDATED', repoId: 'workspace', source: JSON.stringify([client.options.baseUrl ?? '', client.options.apiBasePath ?? '']),
            items: [{ id: 'queue_A' }, { id: 'queue_B' }], hasMore: false });
    }, [dispatch]);
    return null;
}
function tree() { return <QueueProvider><SeedList /><Router /></QueueProvider>; }
function list(items: { id: string; archived?: boolean }[], source?: string, repoId = 'workspace') {
    act(() => queueDispatch({ type: 'REPO_HISTORY_UPDATED', repoId, source, items, hasMore: false }));
}

const app = vi.hoisted(() => ({
    state: { activeTab: 'repos', selectedRepoId: 'workspace', repoRouteState: {}, repoTabState: {} },
    dispatch: vi.fn(),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({ useApp: () => app }));
vi.mock('../../../../src/server/spa/client/react/repos', () => ({ ReposView: () => {
    const { state } = useQueue();
    return <div data-testid="selected-chat">{state.selectedTaskIdByRepo[app.state.selectedRepoId]}</div>;
} }));

function href(id: string) {
    return queueJobHash(app.state.selectedRepoId, { id, processId: id }, resolveChatSubTab());
}
function visit(id: string) {
    act(() => {
        history.replaceState(null, '', href(id));
        window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
}
function press(init: KeyboardEventInit = {}, target: EventTarget = document) {
    const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft', ctrlKey: true, altKey: true, bubbles: true, cancelable: true, ...init,
    });
    act(() => { target.dispatchEvent(event); });
    // Apply the browser hash event through Router's real route resolver and queue reducer.
    act(() => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
    return event;
}
function setup() {
    history.replaceState(null, '', href('queue_A'));
    const view = render(tree());
    visit('queue_B');
    return view;
}
function editor(composer: boolean) {
    const wrapper = document.createElement('div');
    if (composer) wrapper.dataset.testid = 'chat-input-stack';
    const input = document.createElement('div');
    input.setAttribute('contenteditable', 'true');
    // jsdom does not implement inherited isContentEditable.
    Object.defineProperty(input, 'isContentEditable', { value: true });
    const child = document.createElement('span');
    Object.defineProperty(child, 'isContentEditable', { value: true });
    input.append(child);
    wrapper.append(input);
    document.body.append(wrapper);
    return { wrapper, input, child };
}

beforeEach(() => {
    app.state.activeTab = 'repos';
    app.state.selectedRepoId = 'workspace';
    client.options = {};
    app.dispatch.mockClear();
    history.replaceState(null, '', '#');
});
afterEach(() => {
    cleanup();
    history.replaceState(null, '', '#');
});

describe('Router previous chat shortcut', () => {
    it('toggles A to B through the same hash selection path as sidebar clicks', () => {
        setup();
        expect(screen.getByTestId('selected-chat').textContent).toBe('queue_B');
        expect(press().defaultPrevented).toBe(true);
        expect(location.hash).toBe(href('queue_A'));
        expect(screen.getByTestId('selected-chat').textContent).toBe('queue_A');
        expect(press().defaultPrevented).toBe(true);
        expect(location.hash).toBe(href('queue_B'));
        expect(screen.getByTestId('selected-chat').textContent).toBe('queue_B');
    });

    it('does not consume the key when only one chat has been selected', () => {
        history.replaceState(null, '', href('queue_A'));
        render(tree());
        expect(press().defaultPrevented).toBe(false);
        expect(location.hash).toBe(href('queue_A'));
    });

    it('keeps clone-qualified workspace ids in the destination hash', () => {
        app.state.selectedRepoId = 'remote:server:workspace';
        client.options = { baseUrl: 'https://remote.example' };
        setup();
        press();
        expect(location.hash).toBe(href('queue_A'));
        expect(screen.getByTestId('selected-chat').textContent).toBe('queue_A');
    });

    it.each(['deleted', 'archived', 'missing list'])('does not consume the key for a %s previous chat', reason => {
        setup();
        list(reason === 'missing list' ? [] : reason === 'archived'
            ? [{ id: 'queue_A', archived: true }, { id: 'queue_B' }]
            : [{ id: 'queue_B' }]);
        expect(press().defaultPrevented).toBe(false);
        expect(location.hash).toBe(href('queue_B'));
        expect(screen.getByTestId('selected-chat').textContent).toBe('queue_B');
    });

    it.each([
        { id: 'A' }, { id: 'different-task', processId: 'queue_A' },
    ])('recognizes the previous chat in queue snapshots: %j', job => {
        setup();
        list([]);
        act(() => queueDispatch({ type: 'REPO_QUEUE_UPDATED', repoId: 'workspace',
            queue: { running: [job], queued: [] } }));
        expect(press().defaultPrevented).toBe(true);
        expect(screen.getByTestId('selected-chat').textContent).toBe('queue_A');
    });

    it('ignores the shortcut outside the repos tab', () => {
        const view = setup();
        app.state.activeTab = 'reports';
        view.rerender(tree());
        expect(press().defaultPrevented).toBe(false);
        expect(location.hash).toBe(href('queue_B'));
    });

    it('ignores the shortcut on chat reference routes', () => {
        setup();
        act(() => {
            history.replaceState(null, '', '#chat-references/example');
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
        expect(press().defaultPrevented).toBe(false);
        expect(location.hash).toBe('#chat-references/example');
    });

    it('keeps workspace histories separate and restores the first workspace toggle', () => {
        const view = setup();
        app.state.selectedRepoId = 'other-workspace';
        view.rerender(tree());
        visit('queue_C');
        list([{ id: 'queue_A' }, { id: 'queue_B' }, { id: 'queue_C' }], undefined, 'other-workspace');
        expect(press().defaultPrevented).toBe(false);
        expect(location.hash).toBe(href('queue_C'));
        app.state.selectedRepoId = 'workspace';
        visit('queue_B');
        expect(press().defaultPrevented).toBe(true);
        expect(location.hash).toBe(href('queue_A'));
    });

    it.each(['unresolved', 'other server'])('does not use another owner list for a %s remote', reason => {
        const view = setup();
        app.state.selectedRepoId = 'remote:server:workspace';
        if (reason === 'other server') client.options = { baseUrl: 'https://remote.example' };
        view.rerender(tree());
        visit('queue_A');
        visit('queue_B');
        act(() => queueDispatch({ type: 'REPO_QUEUE_UPDATED', repoId: 'workspace',
            queue: { running: [{ id: 'A' }], queued: [] } }));
        // Page-origin history and queue contain A, but the remote owner's list does not.
        expect(press().defaultPrevented).toBe(false);
        expect(location.hash).toBe(href('queue_B'));
    });

    it.each<KeyboardEventInit>([
        { ctrlKey: false }, { altKey: false }, { metaKey: true }, { shiftKey: true },
        { key: 'ArrowRight' },
    ])('ignores other key combinations: %j', init => {
        setup();
        expect(press(init).defaultPrevented).toBe(false);
        expect(location.hash).toBe(href('queue_B'));
    });

    it('allows the composer, including nested rich text', () => {
        setup();
        const { wrapper, input, child } = editor(true);
        input.prepend(document.createTextNode('draft'));
        expect(press({}, child).defaultPrevented).toBe(true);
        expect(screen.getByTestId('selected-chat').textContent).toBe('queue_A');
        expect(input.textContent).toBe('draft');
        wrapper.remove();
    });

    it.each(['input', 'textarea', 'select'])('leaves %s controls alone, even in the composer toolbar', tag => {
        setup();
        const wrapper = document.createElement('div');
        wrapper.dataset.testid = 'chat-input-stack';
        const input = document.createElement(tag);
        wrapper.append(input);
        document.body.append(wrapper);
        expect(press({}, input).defaultPrevented).toBe(false);
        expect(location.hash).toBe(href('queue_B'));
        wrapper.remove();
    });

    it('leaves other rich text editors alone', () => {
        setup();
        const { wrapper, child } = editor(false);
        expect(press({}, child).defaultPrevented).toBe(false);
        expect(location.hash).toBe(href('queue_B'));
        wrapper.remove();
    });

    it('leaves Monaco alone, including its noneditable EditContext input', () => {
        setup();
        const wrapper = document.createElement('div');
        wrapper.className = 'monaco-editor';
        const input = document.createElement('div');
        wrapper.append(input);
        document.body.append(wrapper);
        expect(press({}, input).defaultPrevented).toBe(false);
        expect(location.hash).toBe(href('queue_B'));
        wrapper.remove();
    });
});
