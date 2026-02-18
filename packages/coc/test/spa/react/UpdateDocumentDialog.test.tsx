import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { UpdateDocumentDialog } from '../../../src/server/spa/client/react/shared/UpdateDocumentDialog';

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    global.fetch = mockFetch;
});

function renderDialog(onClose = vi.fn()) {
    return render(
        <AppProvider>
            <UpdateDocumentDialog wsId="ws-1" taskPath="test/task.md" taskName="task" onClose={onClose} />
        </AppProvider>
    );
}

describe('UpdateDocumentDialog', () => {
    it('renders Update Document title', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([]),
        });
        await act(async () => {
            renderDialog();
        });
        expect(screen.getByText('Update Document')).toBeDefined();
    });

    it('populates model select from /api/models', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(['gpt-4', 'claude-3']),
                });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({}),
            });
        });

        await act(async () => {
            renderDialog();
        });

        await waitFor(() => {
            const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
            const options = Array.from(select.options).map(o => o.value);
            expect(options).toContain('gpt-4');
            expect(options).toContain('claude-3');
        });
    });

    it('has a pre-filled prompt textarea', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([]),
        });
        await act(async () => {
            renderDialog();
        });
        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(textarea.value).toContain('task');
    });

    it('submits to /api/queue/tasks on Submit click', async () => {
        const onClose = vi.fn();

        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/tasks/settings')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ folderPath: '.vscode/tasks' }),
                });
            }
            if (opts?.method === 'POST' && url.includes('/queue/tasks')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'q-1' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        await act(async () => {
            renderDialog(onClose);
        });

        await act(async () => {
            fireEvent.click(screen.getByText('Submit'));
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(
                ([_, opts]: [string, any]) => opts?.method === 'POST' && _.includes('/queue/tasks')
            );
            expect(postCalls.length).toBe(1);
            const body = JSON.parse(postCalls[0][1].body);
            expect(body.type).toBe('update-document');
            expect(body.payload.promptContent).toContain('task');
        });
    });

    it('Cancel button calls onClose', async () => {
        const onClose = vi.fn();
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([]),
        });
        await act(async () => {
            renderDialog(onClose);
        });
        fireEvent.click(screen.getByText('Cancel'));
        expect(onClose).toHaveBeenCalled();
    });
});
