import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { FollowPromptDialog } from '../../../src/server/spa/client/react/shared/FollowPromptDialog';

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    global.fetch = mockFetch;
});

function renderDialog(onClose = vi.fn()) {
    return render(
        <AppProvider>
            <FollowPromptDialog wsId="ws-1" taskPath="test/task.md" taskName="task" onClose={onClose} />
        </AppProvider>
    );
}

describe('FollowPromptDialog', () => {
    it('renders Follow Prompt title', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });
        await act(async () => {
            renderDialog();
        });
        expect(screen.getByText('Follow Prompt')).toBeDefined();
    });

    it('populates model select from /api/models', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(['gpt-4', 'gpt-3.5']),
                });
            }
            if (url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ lastModel: 'gpt-4' }),
                });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ prompts: [], skills: [] }),
            });
        });

        await act(async () => {
            renderDialog();
        });

        await waitFor(() => {
            const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
            const options = Array.from(select.options).map(o => o.value);
            expect(options).toContain('gpt-4');
            expect(options).toContain('gpt-3.5');
        });
    });

    it('renders prompt items when prompts exist', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/prompts')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ prompts: [{ name: 'review', relativePath: '.vscode/review.prompt.md' }] }),
                });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [] }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        await act(async () => {
            renderDialog();
        });

        await waitFor(() => {
            expect(screen.getByText('review')).toBeDefined();
        });
    });

    it('submits to /api/queue/tasks on prompt click', async () => {
        const onClose = vi.fn();

        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/prompts')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ prompts: [{ name: 'impl', relativePath: '.vscode/impl.prompt.md' }] }),
                });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [] }),
                });
            }
            if (url.includes('/tasks/settings')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ folderPath: '.vscode/tasks' }),
                });
            }
            if (opts?.method === 'POST' && url.includes('/queue/tasks')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'q-1' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderDialog(onClose);
        });

        await waitFor(() => {
            expect(screen.getByText('impl')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('impl'));
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(
                ([_, opts]: [string, any]) => opts?.method === 'POST' && _.includes('/queue/tasks')
            );
            expect(postCalls.length).toBe(1);
            const body = JSON.parse(postCalls[0][1].body);
            expect(body.type).toBe('follow-prompt');
            expect(body.payload.promptFilePath).toContain('impl.prompt.md');
        });
    });
});
