import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { AdminPanel } from '../../../src/server/spa/client/react/admin/AdminPanel';

// Mock fetch globally
const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    global.fetch = mockFetch;
});

function renderWithProviders() {
    return render(
        <AppProvider>
            <AdminPanel />
        </AppProvider>
    );
}

describe('AdminPanel', () => {
    it('renders the Admin heading', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
            headers: new Headers(),
        });
        await act(async () => {
            renderWithProviders();
        });
        expect(screen.getByText('Admin')).toBeDefined();
    });

    it('renders storage stats section', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/data/stats')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ processCount: 42, wikiCount: 5, totalBytes: 1048576 }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderWithProviders();
        });

        await waitFor(() => {
            expect(screen.getByTestId('stat-processes').textContent).toContain('42');
            expect(screen.getByTestId('stat-wikis').textContent).toContain('5');
            expect(screen.getByTestId('stat-disk').textContent).toContain('1.0 MB');
        });
    });

    it('renders configuration section with editable fields', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/config')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        resolved: { model: 'gpt-4', parallel: 2, timeout: 60, output: 'json' },
                        sources: { model: 'file' },
                        configFilePath: '/home/user/.coc.yaml',
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderWithProviders();
        });

        await waitFor(() => {
            const modelInput = screen.getByDisplayValue('gpt-4') as HTMLInputElement;
            expect(modelInput).toBeDefined();
        });
    });

    it('renders export section with Export button', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
            headers: new Headers(),
        });
        await act(async () => {
            renderWithProviders();
        });
        // Navigate to Data tab
        await act(async () => {
            fireEvent.click(screen.getByTestId('admin-tab-data'));
        });
        expect(screen.getByText('Export JSON ↓')).toBeDefined();
    });

    it('renders danger zone with wipe button', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/storage/status')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ backend: 'file', stats: { processes: 0, workspaces: 0 } }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}), headers: new Headers() });
        });
        await act(async () => {
            renderWithProviders();
        });
        // Navigate to Data tab
        await act(async () => {
            fireEvent.click(screen.getByTestId('admin-tab-data'));
        });
        expect(screen.getByText('Danger Zone')).toBeDefined();
        expect(screen.getByText('Wipe Data')).toBeDefined();
    });

    it('wipe two-step confirm flow — shows confirm after first click', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/data/wipe-token')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ token: 'test-token-123' }),
                });
            }
            if (url.includes('/admin/storage/status')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ backend: 'file', stats: { processes: 0, workspaces: 0 } }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderWithProviders();
        });

        // Navigate to Data tab
        await act(async () => {
            fireEvent.click(screen.getByTestId('admin-tab-data'));
        });

        // Step 1: click Wipe Data
        await act(async () => {
            fireEvent.click(screen.getByText('Wipe Data'));
        });

        // Step 2: Confirm button should appear
        await waitFor(() => {
            expect(screen.getByText('Confirm Wipe')).toBeDefined();
            expect(screen.getByText('Cancel')).toBeDefined();
        });
    });

    it('wipe confirm calls DELETE with token', async () => {
        mockFetch.mockImplementation((url: string, options?: any) => {
            if (url.includes('/admin/data/wipe-token')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ token: 'abc' }),
                });
            }
            if (url.includes('/admin/storage/status')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ backend: 'file', stats: { processes: 0, workspaces: 0 } }),
                });
            }
            if (options?.method === 'DELETE') {
                expect(url).toContain('confirm=abc');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderWithProviders();
        });

        // Navigate to Data tab
        await act(async () => {
            fireEvent.click(screen.getByTestId('admin-tab-data'));
        });

        await act(async () => {
            fireEvent.click(screen.getByText('Wipe Data'));
        });

        await waitFor(() => {
            expect(screen.getByText('Confirm Wipe')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('Confirm Wipe'));
        });

        // Verify DELETE was called
        const deleteCalls = mockFetch.mock.calls.filter(
            ([_, opts]: [string, any]) => opts?.method === 'DELETE'
        );
        expect(deleteCalls.length).toBe(1);
        expect(deleteCalls[0][0]).toContain('confirm=abc');
    });

    it('renders Display section with show intent announcements toggle', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/config')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        resolved: { model: 'gpt-4', parallel: 2, timeout: 60, output: 'json', showReportIntent: false },
                        sources: { showReportIntent: 'default' },
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderWithProviders();
        });

        await waitFor(() => {
            expect(screen.getByText('Intent announcements')).toBeDefined();
        });

        const toggle = screen.getByTestId('toggle-show-report-intent') as HTMLInputElement;
        expect(toggle.checked).toBe(false);
    });

    it('save config with blank model omits model from payload', async () => {
        let capturedBody: any = null;
        mockFetch.mockImplementation((url: string, options?: any) => {
            if (url.includes('/admin/config') && options?.method === 'PUT') {
                capturedBody = JSON.parse(options.body);
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        resolved: { parallel: 3, output: 'table' },
                        sources: {},
                    }),
                });
            }
            if (url.includes('/admin/config')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        resolved: { model: '', parallel: 3, output: 'table' },
                        sources: {},
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderWithProviders();
        });

        // Wait for config to load
        await waitFor(() => {
            expect(screen.getAllByText('Save').length).toBeGreaterThan(0);
        });

        await act(async () => {
            fireEvent.click(screen.getAllByText('Save')[0]);
        });

        await waitFor(() => {
            const putCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, any]) => url.includes('/admin/config') && opts?.method === 'PUT'
            );
            expect(putCalls.length).toBe(1);
        });

        // model must NOT be in payload when blank
        expect(capturedBody).not.toBeNull();
        expect('model' in capturedBody).toBe(false);
    });

    it('save config with non-empty model includes model in payload', async () => {
        let capturedBody: any = null;
        mockFetch.mockImplementation((url: string, options?: any) => {
            if (url.includes('/admin/config') && options?.method === 'PUT') {
                capturedBody = JSON.parse(options.body);
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        resolved: { model: 'gpt-4', parallel: 2, output: 'table' },
                        sources: { model: 'file' },
                    }),
                });
            }
            if (url.includes('/admin/config')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        resolved: { model: 'gpt-4', parallel: 2, output: 'table' },
                        sources: { model: 'file' },
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderWithProviders();
        });

        await waitFor(() => {
            expect(screen.getByDisplayValue('gpt-4')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getAllByText('Save')[0]);
        });

        await waitFor(() => {
            const putCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, any]) => url.includes('/admin/config') && opts?.method === 'PUT'
            );
            expect(putCalls.length).toBe(1);
        });

        expect(capturedBody).not.toBeNull();
        expect(capturedBody.model).toBe('gpt-4');
    });

    it('Display toggle sends PUT with showReportIntent when clicked', async () => {
        mockFetch.mockImplementation((url: string, options?: any) => {
            if (url.includes('/admin/config') && options?.method === 'PUT') {
                const body = JSON.parse(options.body);
                expect(body.showReportIntent).toBe(true);
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        resolved: { showReportIntent: true },
                        sources: { showReportIntent: 'file' },
                    }),
                });
            }
            if (url.includes('/admin/config')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        resolved: { model: 'gpt-4', parallel: 2, timeout: 60, output: 'json', showReportIntent: false },
                        sources: { showReportIntent: 'default' },
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderWithProviders();
        });

        await waitFor(() => {
            expect(screen.getByTestId('toggle-show-report-intent')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('toggle-show-report-intent'));
        });

        const putCalls = mockFetch.mock.calls.filter(
            ([url, opts]: [string, any]) => url.includes('/admin/config') && opts?.method === 'PUT'
        );
        expect(putCalls.length).toBe(1);
    });

    describe('tool compactness segmented control', () => {
        function mockConfig(toolCompactness: number, sources: Record<string, string> = {}) {
            mockFetch.mockImplementation((url: string) => {
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            resolved: { toolCompactness },
                            sources,
                        }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });
        }

        it('defaults to Compact (1) when server returns no toolCompactness (regression)', async () => {
            // Bug: AdminPanel used ?? 0 (Full) while useDisplaySettings defaults to 1 (Compact).
            // When toolCompactness is absent from the server response, Compact should be selected.
            mockFetch.mockImplementation((url: string) => {
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            resolved: { model: 'gpt-4', parallel: 2 },
                            sources: {},
                        }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });
            await act(async () => { renderWithProviders(); });
            await waitFor(() => {
                expect(screen.getByTestId('tool-compactness-compact')).toBeDefined();
            });
            const full = screen.getByTestId('tool-compactness-full') as HTMLButtonElement;
            const compact = screen.getByTestId('tool-compactness-compact') as HTMLButtonElement;
            expect(full.getAttribute('aria-pressed')).toBe('false');
            expect(compact.getAttribute('aria-pressed')).toBe('true');
        });

        it('renders segmented control with correct aria-pressed for initial value', async () => {
            mockConfig(1);
            await act(async () => { renderWithProviders(); });
            await waitFor(() => {
                expect(screen.getByTestId('tool-compactness-full')).toBeDefined();
            });
            const full = screen.getByTestId('tool-compactness-full') as HTMLButtonElement;
            const compact = screen.getByTestId('tool-compactness-compact') as HTMLButtonElement;
            const minimal = screen.getByTestId('tool-compactness-minimal') as HTMLButtonElement;
            const whisper = screen.getByTestId('tool-compactness-whisper') as HTMLButtonElement;
            expect(full.getAttribute('aria-pressed')).toBe('false');
            expect(compact.getAttribute('aria-pressed')).toBe('true');
            expect(minimal.getAttribute('aria-pressed')).toBe('false');
            expect(whisper.getAttribute('aria-pressed')).toBe('false');
        });

        it('renders Whisper button with correct aria-pressed when toolCompactness is 3', async () => {
            mockConfig(3);
            await act(async () => { renderWithProviders(); });
            await waitFor(() => {
                expect(screen.getByTestId('tool-compactness-whisper')).toBeDefined();
            });
            const whisper = screen.getByTestId('tool-compactness-whisper') as HTMLButtonElement;
            expect(whisper.getAttribute('aria-pressed')).toBe('true');
        });

        it('clicking a segment fires PUT with the new value', async () => {
            let capturedBody: any = null;
            mockFetch.mockImplementation((url: string, options?: any) => {
                if (url.includes('/admin/config') && options?.method === 'PUT') {
                    capturedBody = JSON.parse(options.body);
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ resolved: { toolCompactness: 1 }, sources: {} }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });

            await act(async () => { renderWithProviders(); });
            await waitFor(() => expect(screen.getByTestId('tool-compactness-minimal')).toBeDefined());

            await act(async () => {
                fireEvent.click(screen.getByTestId('tool-compactness-minimal'));
            });

            await waitFor(() => expect(capturedBody).not.toBeNull());
            expect(capturedBody.toolCompactness).toBe(2);
            expect((screen.getByTestId('tool-compactness-minimal') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
        });

        it('reverts to previous value on server error', async () => {
            mockFetch.mockImplementation((url: string, options?: any) => {
                if (url.includes('/admin/config') && options?.method === 'PUT') {
                    return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'Save failed' }) });
                }
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ resolved: { toolCompactness: 1 }, sources: {} }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });

            await act(async () => { renderWithProviders(); });
            await waitFor(() => expect(screen.getByTestId('tool-compactness-compact')).toBeDefined());

            await act(async () => {
                fireEvent.click(screen.getByTestId('tool-compactness-full'));
            });

            await waitFor(() => {
                // Should revert back to compact (value 1)
                expect((screen.getByTestId('tool-compactness-compact') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
                expect((screen.getByTestId('tool-compactness-full') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false');
            });
        });

        it('renders SourceBadge for toolCompactness source', async () => {
            mockConfig(0, { toolCompactness: 'file' });
            await act(async () => { renderWithProviders(); });
            await waitFor(() => expect(screen.getByTestId('tool-compactness-full')).toBeDefined());
            expect(screen.getByText('file')).toBeDefined();
        });
    });

    describe('task card density segmented control', () => {
        function mockConfigWithDensity(taskCardDensity: string, sources: Record<string, string> = {}) {
            mockFetch.mockImplementation((url: string) => {
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            resolved: { taskCardDensity },
                            sources,
                        }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });
        }

        it('defaults to Compact when server returns no taskCardDensity', async () => {
            mockFetch.mockImplementation((url: string) => {
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            resolved: {},
                            sources: {},
                        }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });
            await act(async () => { renderWithProviders(); });
            await waitFor(() => {
                expect(screen.getByTestId('task-card-density-compact')).toBeDefined();
            });
            const compact = screen.getByTestId('task-card-density-compact') as HTMLButtonElement;
            const dense = screen.getByTestId('task-card-density-dense') as HTMLButtonElement;
            expect(compact.getAttribute('aria-pressed')).toBe('true');
            expect(dense.getAttribute('aria-pressed')).toBe('false');
        });

        it('renders Dense button with aria-pressed true when taskCardDensity is dense', async () => {
            mockConfigWithDensity('dense');
            await act(async () => { renderWithProviders(); });
            await waitFor(() => {
                expect(screen.getByTestId('task-card-density-dense')).toBeDefined();
            });
            const dense = screen.getByTestId('task-card-density-dense') as HTMLButtonElement;
            expect(dense.getAttribute('aria-pressed')).toBe('true');
        });

        it('clicking Dense fires PUT with taskCardDensity dense', async () => {
            let capturedBody: any = null;
            mockFetch.mockImplementation((url: string, options?: any) => {
                if (options?.method === 'PUT' && url.includes('/admin/config')) {
                    capturedBody = JSON.parse(options.body);
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ resolved: { taskCardDensity: 'compact' }, sources: {} }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });

            await act(async () => { renderWithProviders(); });
            await waitFor(() => expect(screen.getByTestId('task-card-density-dense')).toBeDefined());

            await act(async () => {
                fireEvent.click(screen.getByTestId('task-card-density-dense'));
            });

            await waitFor(() => expect(capturedBody).not.toBeNull());
            expect(capturedBody.taskCardDensity).toBe('dense');
            expect((screen.getByTestId('task-card-density-dense') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
        });

        it('reverts to previous value on server error', async () => {
            mockFetch.mockImplementation((url: string, options?: any) => {
                if (url.includes('/admin/config') && options?.method === 'PUT') {
                    return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'Save failed' }) });
                }
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ resolved: { taskCardDensity: 'compact' }, sources: {} }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });

            await act(async () => { renderWithProviders(); });
            await waitFor(() => expect(screen.getByTestId('task-card-density-compact')).toBeDefined());

            await act(async () => {
                fireEvent.click(screen.getByTestId('task-card-density-dense'));
            });

            await waitFor(() => {
                expect((screen.getByTestId('task-card-density-compact') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
                expect((screen.getByTestId('task-card-density-dense') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false');
            });
        });
    });

    describe('Relaunch Welcome Tour', () => {
        it('renders the relaunch welcome button in Settings tab', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({}),
                headers: new Headers(),
            });
            await act(async () => {
                renderWithProviders();
            });
            expect(screen.getByTestId('relaunch-welcome-btn')).toBeDefined();
            expect(screen.getByText('Welcome Tour')).toBeDefined();
            expect(screen.getByText('Re-show the welcome modal and reset onboarding progress.')).toBeDefined();
        });

        it('calls PATCH /preferences with reset payload on click', async () => {
            mockFetch.mockImplementation((url: string, options?: any) => {
                if (url.includes('/preferences') && options?.method === 'PATCH') {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });
            await act(async () => {
                renderWithProviders();
            });
            // Clear calls from mount-time PATCH (e.g., settingsVisited)
            mockFetch.mockClear();
            mockFetch.mockImplementation((url: string, options?: any) => {
                if (url.includes('/preferences') && options?.method === 'PATCH') {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });
            await act(async () => {
                fireEvent.click(screen.getByTestId('relaunch-welcome-btn'));
            });
            await waitFor(() => {
                const patchCalls = mockFetch.mock.calls.filter(
                    ([url, opts]: [string, any]) => typeof url === 'string' && url.includes('/preferences') && opts?.method === 'PATCH'
                );
                expect(patchCalls.length).toBe(1);
                const body = JSON.parse(patchCalls[0][1].body);
                expect(body).toEqual({
                    hasSeenWelcome: false,
                    onboardingProgress: {},
                    dismissedTips: [],
                });
            });
        });

        it('shows success toast after successful relaunch', async () => {
            mockFetch.mockImplementation((url: string, options?: any) => {
                if (url.includes('/preferences') && options?.method === 'PATCH') {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });
            await act(async () => {
                renderWithProviders();
            });
            await act(async () => {
                fireEvent.click(screen.getByTestId('relaunch-welcome-btn'));
            });
            await waitFor(() => {
                expect(screen.getByText('Welcome tour will appear on next page load')).toBeDefined();
            });
        });

        it('shows error toast on PATCH failure', async () => {
            mockFetch.mockImplementation((url: string, options?: any) => {
                if (url.includes('/preferences') && options?.method === 'PATCH') {
                    return Promise.resolve({
                        ok: false,
                        json: () => Promise.resolve({ error: 'Server error' }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });
            await act(async () => {
                renderWithProviders();
            });
            await act(async () => {
                fireEvent.click(screen.getByTestId('relaunch-welcome-btn'));
            });
            await waitFor(() => {
                expect(screen.getByText('Server error')).toBeDefined();
            });
        });

        it('shows loading state during PATCH request', async () => {
            let resolvePatch!: (value: any) => void;
            mockFetch.mockImplementation((url: string, options?: any) => {
                if (url.includes('/preferences') && options?.method === 'PATCH') {
                    return new Promise(resolve => { resolvePatch = resolve; });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });
            await act(async () => {
                renderWithProviders();
            });
            const btn = screen.getByTestId('relaunch-welcome-btn');
            await act(async () => {
                fireEvent.click(btn);
            });
            // Button should be in loading state (disabled)
            expect(btn.closest('button')?.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.className.includes('loading') || btn.querySelector('[class*="spinner"], [class*="animate"]') !== null).toBeTruthy();
            // Resolve the request
            await act(async () => {
                resolvePatch({ ok: true, json: () => Promise.resolve({}) });
            });
        });
    });
});
