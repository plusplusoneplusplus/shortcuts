/**
 * Shared test utilities for SPA React tests.
 *
 * Provides context-provider wrappers, mock context factories, and a mock-fetch
 * builder so every component/hook test starts from a consistent foundation.
 */

import { render, type RenderOptions } from '@testing-library/react';
import { type ReactElement, type ReactNode } from 'react';
import { vi } from 'vitest';

import { AppProvider, type AppContextState, type AppAction } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider, type QueueContextState, type QueueAction, type QueueStats } from '../../../src/server/spa/client/react/context/QueueContext';
import { TaskProvider, type TaskContextState, type TaskAction } from '../../../src/server/spa/client/react/context/TaskContext';
import { ToastProvider, type ToastContextValue } from '../../../src/server/spa/client/react/context/ToastContext';

// ── Default state factories ────────────────────────────────────────────

function defaultAppState(): AppContextState {
    return {
        processes: [],
        selectedId: null,
        workspace: '__all',
        statusFilter: '__all',
        searchQuery: '',
        expandedGroups: {},
        activeTab: 'repos',
        workspaces: [],
        selectedRepoId: null,
        activeRepoSubTab: 'info',
        reposSidebarCollapsed: false,
        selectedWikiId: null,
        selectedWikiComponentId: null,
        wikiView: 'list',
        wikiDetailInitialTab: null,
        wikiDetailInitialAdminTab: null,
        wikiAutoGenerate: false,
        wikis: [],
        selectedPipelineName: null,
        conversationCache: {},
        wsStatus: 'closed',
        repoTabState: {},
    };
}

function defaultQueueStats(): QueueStats {
    return {
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        total: 0,
        isPaused: false,
        isDraining: false,
    };
}

function defaultQueueState(): QueueContextState {
    return {
        queued: [],
        running: [],
        history: [],
        stats: defaultQueueStats(),
        repoQueueMap: {},
        showDialog: false,
        dialogInitialFolderPath: null,
        showHistory: false,
        isFollowUpStreaming: false,
        currentStreamingTurnIndex: null,
        draining: false,
        drainQueued: 0,
        drainRunning: 0,
        selectedTaskId: null,
        queueInitialized: false,
    };
}

function defaultTaskState(): TaskContextState {
    return {
        openFilePath: null,
        selectedFilePaths: new Set(),
        showContextFiles: true,
        lastTasksChangedWsId: null,
        tasksChangedAt: 0,
        selectedFolderPath: null,
    };
}

function defaultToastContext(): ToastContextValue {
    return {
        addToast: vi.fn(),
        removeToast: vi.fn(),
        toasts: [],
    };
}

// ── Mock context creators ──────────────────────────────────────────────

export function createMockAppContext(overrides?: Partial<AppContextState>): {
    state: AppContextState;
    dispatch: ReturnType<typeof vi.fn<[AppAction], void>>;
} {
    return {
        state: { ...defaultAppState(), ...overrides },
        dispatch: vi.fn(),
    };
}

export function createMockQueueContext(overrides?: Partial<QueueContextState>): {
    state: QueueContextState;
    dispatch: ReturnType<typeof vi.fn<[QueueAction], void>>;
} {
    return {
        state: { ...defaultQueueState(), ...overrides },
        dispatch: vi.fn(),
    };
}

export function createMockTaskContext(overrides?: Partial<TaskContextState>): {
    state: TaskContextState;
    dispatch: ReturnType<typeof vi.fn<[TaskAction], void>>;
} {
    return {
        state: { ...defaultTaskState(), ...overrides },
        dispatch: vi.fn(),
    };
}

export function createMockToastContext(overrides?: Partial<ToastContextValue>): ToastContextValue {
    return { ...defaultToastContext(), ...overrides };
}

// ── renderWithProviders ────────────────────────────────────────────────

/**
 * Renders a component wrapped in all SPA context providers.
 *
 * Uses the real Provider components (which internally call `useReducer`)
 * so hooks like `useApp()` / `useQueue()` / `useTaskContext()` work as
 * expected. This is the simplest viable approach — tests that need to
 * seed specific state can dispatch actions via the returned helpers or
 * use a "seeded" wrapper component pattern (see ProcessesQueue.test.tsx).
 *
 * For ToastContext, mock values are injected directly since `ToastProvider`
 * accepts a `value` prop rather than using `useReducer`.
 */
export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
    toastValue?: Partial<ToastContextValue>;
}

export function renderWithProviders(
    ui: ReactElement,
    options: RenderWithProvidersOptions = {},
) {
    const { toastValue, ...renderOptions } = options;

    const toastCtx: ToastContextValue = { ...defaultToastContext(), ...toastValue };

    function AllProviders({ children }: { children: ReactNode }) {
        return (
            <AppProvider>
                <QueueProvider>
                    <TaskProvider>
                        <ToastProvider value={toastCtx}>
                            {children}
                        </ToastProvider>
                    </TaskProvider>
                </QueueProvider>
            </AppProvider>
        );
    }

    return {
        ...render(ui, { wrapper: AllProviders, ...renderOptions }),
        toastContext: toastCtx,
    };
}

// ── createMockFetch ────────────────────────────────────────────────────

export interface MockFetchHandler {
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
}

/**
 * Creates a `vi.fn()` typed as `typeof globalThis.fetch` that routes
 * requests to handlers matched by URL substring. Unmatched routes return
 * a 404 JSON response. Sets `globalThis.fetch` to the mock automatically.
 *
 * @example
 * ```ts
 * const fetchMock = createMockFetch({
 *     '/api/processes': { body: [{ id: '1' }] },
 *     '/api/queue':     { body: { queued: [], running: [] } },
 * });
 * // ... test code ...
 * expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/processes'), expect.anything());
 * ```
 */
export function createMockFetch(
    handlers: Record<string, MockFetchHandler | unknown> = {},
): ReturnType<typeof vi.fn> & typeof globalThis.fetch {
    const mock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

        for (const [pattern, handlerOrBody] of Object.entries(handlers)) {
            if (url.includes(pattern)) {
                const handler: MockFetchHandler =
                    handlerOrBody !== null && typeof handlerOrBody === 'object' && 'body' in (handlerOrBody as any)
                        ? (handlerOrBody as MockFetchHandler)
                        : { body: handlerOrBody };
                const status = handler.status ?? 200;
                const body = JSON.stringify(handler.body ?? null);
                const headers = new Headers({ 'content-type': 'application/json', ...(handler.headers ?? {}) });
                return new Response(body, { status, headers });
            }
        }

        // Default: 404 for unmatched routes
        return new Response(JSON.stringify({ error: 'Not Found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
        });
    }) as any;

    globalThis.fetch = mock;
    return mock;
}
