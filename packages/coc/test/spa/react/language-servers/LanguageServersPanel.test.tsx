/**
 * LanguageServersPanel — settings behavior for AC-01.
 *
 * Covers the enable toggle, the effective definition list, custom definition
 * editing, and the field-level rejection path that must preserve the last
 * valid configuration. The panel is exercised through the DOM, not by reading
 * its source.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LanguageServerDefinition } from '@plusplusoneplusplus/coc-client';

const get = vi.fn();
const update = vi.fn();
const retry = vi.fn();
const parseLanguageServerRejection = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/language-servers/languageServersApi', () => ({
    languageServersApi: {
        get: (...args: unknown[]) => get(...args),
        update: (...args: unknown[]) => update(...args),
        retry: (...args: unknown[]) => retry(...args),
        replace: vi.fn(),
    },
    parseLanguageServerRejection: (...args: unknown[]) => parseLanguageServerRejection(...args),
}));

const { LanguageServersPanel } = await import(
    '../../../../src/server/spa/client/react/features/language-servers/LanguageServersPanel'
);

const WS = 'ws-lsp-settings';

function def(overrides: Partial<LanguageServerDefinition> = {}): LanguageServerDefinition {
    return {
        id: 'typescript',
        displayName: 'TypeScript',
        languageIds: ['typescript'],
        filePatterns: ['**/*.ts'],
        command: 'typescript-language-server',
        args: ['--stdio'],
        rootMarkers: ['tsconfig.json'],
        enabled: false,
        builtIn: true,
        ...overrides,
    };
}

function response(overrides: Record<string, unknown> = {}) {
    return {
        enabled: false,
        definitions: [],
        effective: [def()],
        startable: [],
        status: 'missing' as const,
        warnings: [],
        runtimes: [],
        ...overrides,
    };
}

async function renderPanel(initial = response()) {
    get.mockResolvedValue(initial);
    render(<LanguageServersPanel workspaceId={WS} />);
    await screen.findByTestId('language-servers-section');
}

function typeDraft(fields: Record<string, string>) {
    for (const [field, value] of Object.entries(fields)) {
        fireEvent.change(screen.getByTestId(`server-field-${field}`), { target: { value } });
    }
}

describe('LanguageServersPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        parseLanguageServerRejection.mockReturnValue(null);
        retry.mockReset();
    });

    it('loads the owning workspace configuration', async () => {
        await renderPanel();
        expect(get).toHaveBeenCalledWith(WS);
        expect(screen.getByText('TypeScript')).toBeDefined();
        expect(screen.getByTestId('built-in-badge')).toBeDefined();
        expect(screen.getByTestId('language-server-runtime-status').textContent).toBe('Not started');
    });

    it('shows a loading placeholder before the config arrives', () => {
        get.mockReturnValue(new Promise(() => {}));
        render(<LanguageServersPanel workspaceId={WS} />);
        expect(screen.getByTestId('language-servers-loading')).toBeDefined();
    });

    it('reports a load failure instead of rendering an empty form', async () => {
        get.mockRejectedValue(new Error('host offline'));
        render(<LanguageServersPanel workspaceId={WS} />);
        expect((await screen.findByTestId('language-servers-error')).textContent).toBe('host offline');
    });

    it('turns language support on through the workspace-scoped update', async () => {
        await renderPanel();
        update.mockResolvedValue(response({ enabled: true }));
        fireEvent.click(screen.getByTestId('language-support-toggle'));
        await waitFor(() => expect(update).toHaveBeenCalledWith(WS, { enabled: true }));
        await waitFor(() => {
            expect((screen.getByTestId('language-support-toggle') as HTMLInputElement).checked).toBe(true);
        });
    });

    it('enables a preset by writing an override, not by deleting the preset', async () => {
        await renderPanel();
        update.mockResolvedValue(response({ definitions: [def({ enabled: true })] }));
        fireEvent.click(screen.getByTestId('language-server-enabled'));
        await waitFor(() => expect(update).toHaveBeenCalled());
        const [, body] = update.mock.calls[0];
        expect(body.definitions).toHaveLength(1);
        expect(body.definitions[0]).toMatchObject({ id: 'typescript', enabled: true, builtIn: true });
    });

    it('renders an empty state when no definitions are effective', async () => {
        await renderPanel(response({ effective: [] }));
        expect(screen.getByTestId('no-language-servers')).toBeDefined();
    });

    it('surfaces config warnings from the server', async () => {
        await renderPanel(response({ warnings: [{ kind: 'invalid-entry', message: 'Dropped one invalid definition' }] }));
        expect(screen.getByTestId('language-servers-warning').textContent).toBe('Dropped one invalid definition');
    });

    it('aggregates mixed root states without claiming the whole server is healthy', async () => {
        await renderPanel(response({
            enabled: true,
            effective: [def({ id: 'rust', displayName: 'Rust', enabled: true })],
            runtimes: [
                {
                    sessionId: 'ready',
                    workspaceId: WS,
                    definitionId: 'rust',
                    displayName: 'Rust',
                    projectRoot: 'crates/one',
                    status: 'ready',
                },
                {
                    sessionId: 'missing',
                    workspaceId: WS,
                    definitionId: 'rust',
                    displayName: 'Rust',
                    projectRoot: 'crates/two',
                    status: 'unavailable',
                    detail: 'rust-analyzer is not installed',
                    recoveryCommand: 'rustup component add rust-analyzer',
                    lastAttemptAt: '2026-09-12T05:00:00.000Z',
                },
            ],
        }));

        expect(screen.getByTestId('language-server-runtime-status').textContent)
            .toBe('Ready in 1 root · Needs setup in 1 root');
        fireEvent.click(screen.getByTestId('language-server-runtime-status'));
        expect(screen.getByTestId('language-server-runtime-details').textContent).toContain('crates/two');
    });

    it('retries the failed root and replaces the runtime summary', async () => {
        const failed = {
            sessionId: 'failed-root',
            workspaceId: WS,
            definitionId: 'typescript',
            displayName: 'TypeScript',
            projectRoot: '.',
            status: 'failed' as const,
            detail: 'Initialization rejected',
        };
        await renderPanel(response({ enabled: true, effective: [def({ enabled: true })], runtimes: [failed] }));
        retry.mockResolvedValue(response({
            enabled: true,
            effective: [def({ enabled: true })],
            runtimes: [{ ...failed, status: 'ready', detail: undefined }],
        }));

        fireEvent.click(screen.getByTestId('language-server-runtime-status'));
        fireEvent.click(screen.getByTestId('language-server-retry'));

        await waitFor(() => expect(retry).toHaveBeenCalledWith(WS, 'failed-root'));
        await waitFor(() => expect(screen.getByTestId('language-server-runtime-status').textContent).toBe('Ready in 1 root'));
    });

    it('saves a custom definition with list fields split from comma text', async () => {
        await renderPanel();
        update.mockResolvedValue(response());
        fireEvent.click(screen.getByTestId('add-server-btn'));
        typeDraft({
            id: 'fixture',
            displayName: 'Fixture Server',
            command: 'node',
            args: 'fixture-server.js, --stdio',
            filePatterns: '**/*.fixture, **/*.fx',
            languageIds: 'fixture',
            rootMarkers: 'fixture.json',
        });
        fireEvent.click(screen.getByTestId('save-server-btn'));
        await waitFor(() => expect(update).toHaveBeenCalled());
        expect(update.mock.calls[0][1].definitions[0]).toMatchObject({
            id: 'fixture',
            displayName: 'Fixture Server',
            command: 'node',
            args: ['fixture-server.js', '--stdio'],
            filePatterns: ['**/*.fixture', '**/*.fx'],
            languageIds: ['fixture'],
            rootMarkers: ['fixture.json'],
            enabled: true,
        });
        await waitFor(() => expect(screen.queryByTestId('server-editor')).toBeNull());
    });

    it('edits a preset as an override that keeps its id and built-in marking', async () => {
        await renderPanel();
        update.mockResolvedValue(response());
        fireEvent.click(screen.getByTestId('edit-server-btn'));
        expect((screen.getByTestId('server-field-command') as HTMLInputElement).value).toBe('typescript-language-server');
        expect((screen.getByTestId('server-field-id') as HTMLInputElement).disabled).toBe(true);
        typeDraft({ command: '/opt/ts/bin/server' });
        fireEvent.click(screen.getByTestId('save-server-btn'));
        await waitFor(() => expect(update).toHaveBeenCalled());
        expect(update.mock.calls[0][1].definitions[0]).toMatchObject({
            id: 'typescript',
            command: '/opt/ts/bin/server',
            builtIn: true,
        });
    });

    it('replaces an existing override rather than appending a duplicate id', async () => {
        const stored = def({ id: 'fixture', displayName: 'Fixture', builtIn: false, enabled: true });
        await renderPanel(response({ definitions: [stored], effective: [stored] }));
        update.mockResolvedValue(response());
        fireEvent.click(screen.getByTestId('edit-server-btn'));
        typeDraft({ displayName: 'Fixture Two' });
        fireEvent.click(screen.getByTestId('save-server-btn'));
        await waitFor(() => expect(update).toHaveBeenCalled());
        const sent = update.mock.calls[0][1].definitions;
        expect(sent).toHaveLength(1);
        expect(sent[0].displayName).toBe('Fixture Two');
    });

    it('removes a stored custom definition but offers no delete for a preset', async () => {
        const stored = def({ id: 'fixture', displayName: 'Fixture', builtIn: false });
        await renderPanel(response({ definitions: [stored], effective: [def(), stored] }));
        expect(screen.getAllByTestId('remove-server-btn')).toHaveLength(1);
        update.mockResolvedValue(response());
        fireEvent.click(screen.getByTestId('remove-server-btn'));
        await waitFor(() => expect(update).toHaveBeenCalledWith(WS, { definitions: [] }));
    });

    it('anchors a rejection on the offending input and keeps the editor open', async () => {
        await renderPanel();
        parseLanguageServerRejection.mockReturnValue({
            errors: [{ field: 'definitions.0.command', message: 'Command must not contain shell metacharacters' }],
            config: { enabled: false, definitions: [] },
        });
        update.mockRejectedValue(new Error('Bad Request'));
        fireEvent.click(screen.getByTestId('add-server-btn'));
        typeDraft({ id: 'fixture', command: 'node && rm -rf /' });
        fireEvent.click(screen.getByTestId('save-server-btn'));
        const message = await screen.findByTestId('server-field-error-command');
        expect(message.textContent).toBe('Command must not contain shell metacharacters');
        expect(screen.getByTestId('server-editor')).toBeDefined();
        expect((screen.getByTestId('server-field-command') as HTMLInputElement).value).toBe('node && rm -rf /');
    });

    it('restores the last valid configuration echoed with a rejection', async () => {
        await renderPanel(response({ enabled: true }));
        parseLanguageServerRejection.mockReturnValue({
            errors: [{ field: 'definitions.0.id', message: 'id is required' }],
            config: { enabled: false, definitions: [] },
        });
        update.mockRejectedValue(new Error('Bad Request'));
        fireEvent.click(screen.getByTestId('add-server-btn'));
        fireEvent.click(screen.getByTestId('save-server-btn'));
        await waitFor(() => {
            expect((screen.getByTestId('language-support-toggle') as HTMLInputElement).checked).toBe(false);
        });
    });

    it('reports a non-validation failure as a plain error', async () => {
        await renderPanel();
        parseLanguageServerRejection.mockReturnValue(null);
        update.mockRejectedValue(new Error('network down'));
        fireEvent.click(screen.getByTestId('language-support-toggle'));
        expect((await screen.findByTestId('language-servers-error')).textContent).toBe('network down');
    });

    it('clears field errors when the editor is reopened', async () => {
        await renderPanel();
        parseLanguageServerRejection.mockReturnValue({
            errors: [{ field: 'definitions.0.id', message: 'id is required' }],
        });
        update.mockRejectedValue(new Error('Bad Request'));
        fireEvent.click(screen.getByTestId('add-server-btn'));
        fireEvent.click(screen.getByTestId('save-server-btn'));
        await screen.findByTestId('server-field-error-id');
        fireEvent.click(screen.getByTestId('cancel-server-btn'));
        fireEvent.click(screen.getByTestId('add-server-btn'));
        expect(screen.queryByTestId('server-field-error-id')).toBeNull();
    });
});
