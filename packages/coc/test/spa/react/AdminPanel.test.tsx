import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { AdminPanel } from '../../../src/server/spa/client/react/admin/AdminPanel';

// Mock fetch globally
const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    global.fetch = mockFetch;
    // AdminPanel reads the URL fragment to choose the initial Settings sub-tab.
    // Reset between tests so each one starts on the default ('ai') sub-tab.
    if (typeof window !== 'undefined') {
        window.location.hash = '';
    }
});

function renderWithProviders() {
    return render(
        <AppProvider>
            <AdminPanel />
        </AppProvider>
    );
}

/**
 * Switch the Settings page to a specific sub-tab. The Settings page renders
 * one `SettingsCard` per sub-tab (ai / chat / appearance / features /
 * integrations / advanced), so tests interacting with controls outside of
 * the default 'ai' sub-tab must call this first.
 */
async function gotoSettingsSubTab(sub: 'ai' | 'chat' | 'appearance' | 'features' | 'integrations' | 'advanced'): Promise<void> {
    await waitFor(() => expect(screen.getByTestId(`settings-subtab-${sub}`)).toBeDefined());
    await act(async () => {
        fireEvent.click(screen.getByTestId(`settings-subtab-${sub}`));
    });
}

describe('AdminPanel', () => {
    it('does not render the Admin heading', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
            headers: new Headers(),
        });
        await act(async () => {
            renderWithProviders();
        });
        expect(screen.queryByRole('heading', { name: 'Admin' })).toBeNull();
    });

    it('does not render the sidebar usage stats block', async () => {
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

        expect(screen.queryByTestId('stat-processes')).toBeNull();
        expect(screen.queryByTestId('stat-wikis')).toBeNull();
        expect(screen.queryByTestId('stat-disk')).toBeNull();
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

    it('renders Display section with show intent announcements toggle in Chat Experience card', async () => {
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

        await gotoSettingsSubTab('chat');

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

        // Wait for the AI & Execution card to load
        await waitFor(() => {
            expect(screen.getByTestId('settings-ai-execution')).toBeDefined();
        });

        // Change a field to make the card dirty (parallel already has value, just touch output)
        const parallelInput = document.getElementById('admin-config-parallel') as HTMLInputElement;
        await act(async () => {
            fireEvent.change(parallelInput, { target: { value: '4' } });
        });

        // Click the AI & Execution card Save
        await act(async () => {
            fireEvent.click(screen.getByTestId('settings-ai-execution-save'));
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

        // Change parallel to make the card dirty
        const parallelInput = document.getElementById('admin-config-parallel') as HTMLInputElement;
        await act(async () => {
            fireEvent.change(parallelInput, { target: { value: '5' } });
        });

        // Click the AI & Execution card Save
        await act(async () => {
            fireEvent.click(screen.getByTestId('settings-ai-execution-save'));
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

    it('Intent toggle marks Chat Experience card dirty, Save sends PUT with showReportIntent', async () => {
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

        await gotoSettingsSubTab('chat');

        await waitFor(() => {
            expect(screen.getByTestId('toggle-show-report-intent')).toBeDefined();
        });

        // Toggle intent announcements — makes Chat card dirty
        await act(async () => {
            fireEvent.click(screen.getByTestId('toggle-show-report-intent'));
        });

        // Click Chat Experience card Save
        await act(async () => {
            fireEvent.click(screen.getByTestId('settings-chat-save'));
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
            await gotoSettingsSubTab('chat');
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
            await gotoSettingsSubTab('chat');
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
            await gotoSettingsSubTab('chat');
            await waitFor(() => {
                expect(screen.getByTestId('tool-compactness-whisper')).toBeDefined();
            });
            const whisper = screen.getByTestId('tool-compactness-whisper') as HTMLButtonElement;
            expect(whisper.getAttribute('aria-pressed')).toBe('true');
        });

        it('clicking a segment marks Chat card dirty, Save fires PUT with the new value', async () => {
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
            await gotoSettingsSubTab('chat');
            await waitFor(() => expect(screen.getByTestId('tool-compactness-minimal')).toBeDefined());

            // Click Minimal segment — marks Chat card dirty
            await act(async () => {
                fireEvent.click(screen.getByTestId('tool-compactness-minimal'));
            });

            expect((screen.getByTestId('tool-compactness-minimal') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');

            // Click Chat Experience card Save
            await act(async () => {
                fireEvent.click(screen.getByTestId('settings-chat-save'));
            });

            await waitFor(() => expect(capturedBody).not.toBeNull());
            expect(capturedBody.toolCompactness).toBe(2);
        });

        it('cancel reverts to previous value', async () => {
            mockFetch.mockImplementation((url: string) => {
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ resolved: { toolCompactness: 1 }, sources: {} }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });

            await act(async () => { renderWithProviders(); });
            await gotoSettingsSubTab('chat');
            await waitFor(() => expect(screen.getByTestId('tool-compactness-compact')).toBeDefined());

            // Click Full segment
            await act(async () => {
                fireEvent.click(screen.getByTestId('tool-compactness-full'));
            });

            expect((screen.getByTestId('tool-compactness-full') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');

            // Click Cancel on Chat card
            await act(async () => {
                fireEvent.click(screen.getByTestId('settings-chat-cancel'));
            });

            // Should revert back to compact (value 1)
            expect((screen.getByTestId('tool-compactness-compact') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
            expect((screen.getByTestId('tool-compactness-full') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false');
        });

        it('renders SourceBadge for toolCompactness source', async () => {
            mockConfig(0, { toolCompactness: 'file' });
            await act(async () => { renderWithProviders(); });
            await gotoSettingsSubTab('chat');
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
            await gotoSettingsSubTab('appearance');
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
            await gotoSettingsSubTab('appearance');
            await waitFor(() => {
                expect(screen.getByTestId('task-card-density-dense')).toBeDefined();
            });
            const dense = screen.getByTestId('task-card-density-dense') as HTMLButtonElement;
            expect(dense.getAttribute('aria-pressed')).toBe('true');
        });

        it('clicking Dense marks Appearance card dirty, Save fires PUT with taskCardDensity dense', async () => {
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
            await gotoSettingsSubTab('appearance');
            await waitFor(() => expect(screen.getByTestId('task-card-density-dense')).toBeDefined());

            // Click Dense segment
            await act(async () => {
                fireEvent.click(screen.getByTestId('task-card-density-dense'));
            });

            expect((screen.getByTestId('task-card-density-dense') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');

            // Click Appearance card Save
            await act(async () => {
                fireEvent.click(screen.getByTestId('settings-appearance-save'));
            });

            await waitFor(() => expect(capturedBody).not.toBeNull());
            expect(capturedBody.taskCardDensity).toBe('dense');
        });

        it('persists inline HTML previews as a global preference from Appearance', async () => {
            let capturedBody: any = null;
            mockFetch.mockImplementation((url: string, options?: any) => {
                if (options?.method === 'PATCH' && url.includes('/preferences')) {
                    capturedBody = JSON.parse(options.body);
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ resolved: { taskCardDensity: 'compact' }, sources: {} }),
                    });
                }
                if (url.includes('/preferences')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ theme: 'auto', reposSidebarCollapsed: false, uiLayoutMode: 'classic', htmlEmbed: { enabled: false } }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });

            await act(async () => { renderWithProviders(); });
            await gotoSettingsSubTab('appearance');
            await waitFor(() => expect(screen.getByTestId('pref-html-embed-enabled')).toBeDefined());
            capturedBody = null;

            await act(async () => {
                fireEvent.click(screen.getByTestId('pref-html-embed-enabled'));
            });
            await act(async () => {
                fireEvent.click(screen.getByTestId('settings-appearance-save'));
            });

            await waitFor(() => expect(capturedBody).not.toBeNull());
            expect(capturedBody.htmlEmbed).toEqual({ enabled: true });
        });

        it('persists prompt autocomplete AI toggles as global preferences from Appearance', async () => {
            let capturedBody: any = null;
            mockFetch.mockImplementation((url: string, options?: any) => {
                if (options?.method === 'PATCH' && url.includes('/preferences')) {
                    capturedBody = JSON.parse(options.body);
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ resolved: { taskCardDensity: 'compact' }, sources: {} }),
                    });
                }
                if (url.includes('/preferences')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            theme: 'auto',
                            reposSidebarCollapsed: false,
                            uiLayoutMode: 'classic',
                            htmlEmbed: { enabled: true },
                            promptAutocomplete: { enabled: true, ai: { enabled: false } },
                        }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });

            await act(async () => { renderWithProviders(); });
            await gotoSettingsSubTab('appearance');
            await waitFor(() => expect(screen.getByTestId('pref-prompt-autocomplete-ai-enabled')).toBeDefined());
            capturedBody = null;

            await act(async () => {
                fireEvent.click(screen.getByTestId('pref-prompt-autocomplete-ai-enabled'));
            });
            await act(async () => {
                fireEvent.click(screen.getByTestId('settings-appearance-save'));
            });

            await waitFor(() => expect(capturedBody).not.toBeNull());
            expect(capturedBody.promptAutocomplete).toEqual({
                enabled: true,
                ai: { enabled: true },
            });
        });

        it('cancel reverts to previous value', async () => {
            mockFetch.mockImplementation((url: string) => {
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ resolved: { taskCardDensity: 'compact' }, sources: {} }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });

            await act(async () => { renderWithProviders(); });
            await gotoSettingsSubTab('appearance');
            await waitFor(() => expect(screen.getByTestId('task-card-density-compact')).toBeDefined());

            // Click Dense
            await act(async () => {
                fireEvent.click(screen.getByTestId('task-card-density-dense'));
            });

            // Click Cancel on Appearance card
            await act(async () => {
                fireEvent.click(screen.getByTestId('settings-appearance-cancel'));
            });

            expect((screen.getByTestId('task-card-density-compact') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
            expect((screen.getByTestId('task-card-density-dense') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false');
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
            await gotoSettingsSubTab('advanced');
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
            await gotoSettingsSubTab('advanced');
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
                    onboardingProgress: {
                        hasRunWorkflow: false,
                        hasOpenedWiki: false,
                        hasUsedChat: false,
                        settingsVisited: false,
                        dismissed: false,
                        hasCompletedTour: false,
                    },
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
            await gotoSettingsSubTab('advanced');
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
            await gotoSettingsSubTab('advanced');
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
            await gotoSettingsSubTab('advanced');
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

    describe('Settings card structure', () => {
        function mockFullConfig() {
            mockFetch.mockImplementation((url: string) => {
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            resolved: {
                                model: 'gpt-4', parallel: 2, timeout: 60, output: 'json',
                                showReportIntent: false, toolCompactness: 1,
                                taskCardDensity: 'compact', historyGrouping: true,
                                terminal: { enabled: false }, notes: { enabled: false },
                                myWork: { enabled: false }, myLife: { enabled: false },
                                chat: { followUpSuggestions: { enabled: true, count: 3 }, askUser: { enabled: true } },
                                approvePermissions: false, mcpConfig: false, persist: true,
                            },
                            sources: {},
                        }),
                    });
                }
                if (url.includes('/preferences')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ theme: 'auto', reposSidebarCollapsed: false }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });
        }

        it('renders one settings card per sub-tab', async () => {
            // Settings is now split into per-sub-tab cards. Cycle through each
            // sub-tab and verify the corresponding card is mounted.
            const subTabToCard: Array<[
                'ai' | 'chat' | 'appearance' | 'features' | 'integrations' | 'advanced',
                string,
            ]> = [
                ['ai', 'settings-ai-execution'],
                ['chat', 'settings-chat'],
                ['appearance', 'settings-appearance'],
                ['features', 'settings-features'],
                ['integrations', 'settings-link-handlers'],
                ['advanced', 'settings-advanced'],
            ];
            mockFullConfig();
            await act(async () => { renderWithProviders(); });
            for (const [sub, testId] of subTabToCard) {
                await gotoSettingsSubTab(sub);
                await waitFor(() => expect(screen.getByTestId(testId)).toBeDefined());
            }
        });

        it('renders card titles for each sub-tab', async () => {
            // Each sub-tab maps to a `SettingsCard` whose `<header>` carries
            // the visible card title. We assert the title is rendered inside
            // the corresponding card (rather than e.g. the sub-tab button or
            // the breadcrumb crumb, which share the same text).
            const subTabToCard: Array<[
                'ai' | 'chat' | 'appearance' | 'features' | 'integrations' | 'advanced',
                string,
                string,
            ]> = [
                ['ai', 'settings-ai-execution', 'AI & Execution'],
                ['chat', 'settings-chat', 'Chat Experience'],
                ['appearance', 'settings-appearance', 'Appearance & Navigation'],
                ['features', 'settings-features', 'Workspace Features'],
                ['integrations', 'settings-link-handlers', 'Link handlers'],
                ['advanced', 'settings-advanced', 'Advanced & Recovery'],
            ];
            mockFullConfig();
            await act(async () => { renderWithProviders(); });
            for (const [sub, cardTestId, title] of subTabToCard) {
                await gotoSettingsSubTab(sub);
                await waitFor(() => {
                    const card = screen.getByTestId(cardTestId);
                    expect(card.textContent ?? '').toContain(title);
                });
            }
        });

        it('defaults absent HTML embeds and local file link handler to enabled', async () => {
            mockFullConfig();
            await act(async () => { renderWithProviders(); });
            await gotoSettingsSubTab('appearance');
            await waitFor(() => {
                expect((screen.getByTestId('pref-html-embed-enabled') as HTMLInputElement).checked).toBe(true);
            });
            await gotoSettingsSubTab('integrations');
            await waitFor(() => {
                expect((screen.getByTestId('toggle-link-handler-file') as HTMLInputElement).checked).toBe(true);
            });
        });

        it('Save buttons are disabled when cards are not dirty', async () => {
            mockFullConfig();
            await act(async () => { renderWithProviders(); });
            // AI sub-tab is the default landing tab.
            await waitFor(() => expect(screen.getByTestId('settings-ai-execution-save')).toBeDefined());
            expect((screen.getByTestId('settings-ai-execution-save') as HTMLButtonElement).disabled).toBe(true);

            await gotoSettingsSubTab('chat');
            await waitFor(() => expect(screen.getByTestId('settings-chat-save')).toBeDefined());
            expect((screen.getByTestId('settings-chat-save') as HTMLButtonElement).disabled).toBe(true);

            await gotoSettingsSubTab('appearance');
            await waitFor(() => expect(screen.getByTestId('settings-appearance-save')).toBeDefined());
            expect((screen.getByTestId('settings-appearance-save') as HTMLButtonElement).disabled).toBe(true);

            await gotoSettingsSubTab('features');
            await waitFor(() => expect(screen.getByTestId('settings-features-save')).toBeDefined());
            expect((screen.getByTestId('settings-features-save') as HTMLButtonElement).disabled).toBe(true);
        });

        it('AI & Execution Save enables when model is changed', async () => {
            mockFullConfig();
            await act(async () => { renderWithProviders(); });
            await waitFor(() => expect(screen.getByDisplayValue('gpt-4')).toBeDefined());

            const modelInput = document.getElementById('admin-config-model') as HTMLInputElement;
            await act(async () => {
                fireEvent.change(modelInput, { target: { value: 'gpt-5' } });
            });
            expect((screen.getByTestId('settings-ai-execution-save') as HTMLButtonElement).disabled).toBe(false);
        });

        it('Workspace Features Save enables when a toggle is changed', async () => {
            mockFullConfig();
            await act(async () => { renderWithProviders(); });
            await gotoSettingsSubTab('features');
            await waitFor(() => expect(screen.getByTestId('toggle-terminal-enabled')).toBeDefined());

            await act(async () => {
                fireEvent.click(screen.getByTestId('toggle-terminal-enabled'));
            });
            expect((screen.getByTestId('settings-features-save') as HTMLButtonElement).disabled).toBe(false);
        });

        it('Features card Save sends PUT with all feature flags', async () => {
            let capturedBody: any = null;
            mockFetch.mockImplementation((url: string, options?: any) => {
                if (url.includes('/admin/config') && options?.method === 'PUT') {
                    capturedBody = JSON.parse(options.body);
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            resolved: { terminal: { enabled: false }, notes: { enabled: false }, myWork: { enabled: false }, myLife: { enabled: false } },
                            sources: {},
                        }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });

            await act(async () => { renderWithProviders(); });
            await gotoSettingsSubTab('features');
            await waitFor(() => expect(screen.getByTestId('toggle-terminal-enabled')).toBeDefined());

            // Enable terminal
            await act(async () => {
                fireEvent.click(screen.getByTestId('toggle-terminal-enabled'));
            });

            // Save
            await act(async () => {
                fireEvent.click(screen.getByTestId('settings-features-save'));
            });

            await waitFor(() => expect(capturedBody).not.toBeNull());
            expect(capturedBody['terminal.enabled']).toBe(true);
            expect(capturedBody['notes.enabled']).toBe(false);
        });

        it('renders Servers toggle unchecked by default and includes servers.enabled in PUT', async () => {
            let capturedBody: any = null;
            mockFetch.mockImplementation((url: string, options?: any) => {
                if (url.includes('/admin/config') && options?.method === 'PUT') {
                    capturedBody = JSON.parse(options.body);
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            resolved: {
                                terminal: { enabled: false }, notes: { enabled: false },
                                myWork: { enabled: false }, myLife: { enabled: false },
                                servers: { enabled: false },
                            },
                            sources: {},
                        }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });

            await act(async () => { renderWithProviders(); });
            await gotoSettingsSubTab('features');
            await waitFor(() => expect(screen.getByTestId('toggle-servers-enabled')).toBeDefined());

            const toggle = screen.getByTestId('toggle-servers-enabled') as HTMLInputElement;
            expect(toggle.checked).toBe(false);

            await act(async () => {
                fireEvent.click(toggle);
            });
            expect((screen.getByTestId('settings-features-save') as HTMLButtonElement).disabled).toBe(false);

            await act(async () => {
                fireEvent.click(screen.getByTestId('settings-features-save'));
            });
            await waitFor(() => expect(capturedBody).not.toBeNull());
            expect(capturedBody['servers.enabled']).toBe(true);
        });

        it('focusedDiff toggle saves features.focusedDiff', async () => {
            let capturedBody: Record<string, unknown> | null = null;
            mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
                if (url.includes('/preferences')) {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                if (opts?.method === 'PUT' && url.includes('/admin/config')) {
                    capturedBody = JSON.parse(opts.body as string);
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            resolved: {
                                terminal: { enabled: false }, notes: { enabled: false },
                                myWork: { enabled: false }, myLife: { enabled: false },
                                features: { focusedDiff: false },
                            },
                            sources: {},
                        }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });

            await act(async () => { renderWithProviders(); });
            await gotoSettingsSubTab('features');
            await waitFor(() => expect(screen.getByTestId('toggle-focused-diff-enabled')).toBeDefined());

            const toggle = screen.getByTestId('toggle-focused-diff-enabled') as HTMLInputElement;
            expect(toggle.checked).toBe(false);

            await act(async () => {
                fireEvent.click(toggle);
            });
            expect((screen.getByTestId('settings-features-save') as HTMLButtonElement).disabled).toBe(false);

            await act(async () => {
                fireEvent.click(screen.getByTestId('settings-features-save'));
            });
            await waitFor(() => expect(capturedBody).not.toBeNull());
            expect(capturedBody!['features.focusedDiff']).toBe(true);
        });

        it('cross-clone cherry-pick toggle saves features.gitCrossCloneCherryPick', async () => {
            let capturedBody: Record<string, unknown> | null = null;
            mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
                if (url.includes('/preferences')) {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                if (opts?.method === 'PUT' && url.includes('/admin/config')) {
                    capturedBody = JSON.parse(opts.body as string);
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            resolved: {
                                terminal: { enabled: false }, notes: { enabled: false },
                                myWork: { enabled: false }, myLife: { enabled: false },
                                features: { focusedDiff: false, gitCrossCloneCherryPick: false },
                            },
                            sources: {},
                        }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });

            await act(async () => { renderWithProviders(); });
            await gotoSettingsSubTab('features');
            await waitFor(() => expect(screen.getByTestId('toggle-git-cross-clone-cherry-pick-enabled')).toBeDefined());

            const toggle = screen.getByTestId('toggle-git-cross-clone-cherry-pick-enabled') as HTMLInputElement;
            expect(toggle.checked).toBe(false);

            await act(async () => {
                fireEvent.click(toggle);
            });
            expect((screen.getByTestId('settings-features-save') as HTMLButtonElement).disabled).toBe(false);

            await act(async () => {
                fireEvent.click(screen.getByTestId('settings-features-save'));
            });
            await waitFor(() => expect(capturedBody).not.toBeNull());
            expect(capturedBody!['features.gitCrossCloneCherryPick']).toBe(true);
        });

        it('commit chat lens toggle saves features.commitChatLens', async () => {
            let capturedBody: Record<string, unknown> | null = null;
            mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
                if (url.includes('/preferences')) {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                if (opts?.method === 'PUT' && url.includes('/admin/config')) {
                    capturedBody = JSON.parse(opts.body as string);
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            resolved: {
                                terminal: { enabled: false }, notes: { enabled: false },
                                myWork: { enabled: false }, myLife: { enabled: false },
                                features: { commitChatLens: false },
                            },
                            sources: {},
                        }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });

            await act(async () => { renderWithProviders(); });
            await gotoSettingsSubTab('features');
            await waitFor(() => expect(screen.getByTestId('toggle-commit-chat-lens-enabled')).toBeDefined());

            const toggle = screen.getByTestId('toggle-commit-chat-lens-enabled') as HTMLInputElement;
            expect(toggle.checked).toBe(false);

            await act(async () => {
                fireEvent.click(toggle);
            });
            expect((screen.getByTestId('settings-features-save') as HTMLButtonElement).disabled).toBe(false);

            await act(async () => {
                fireEvent.click(screen.getByTestId('settings-features-save'));
            });
            await waitFor(() => expect(capturedBody).not.toBeNull());
            expect(capturedBody!['features.commitChatLens']).toBe(true);
        });

        it('Advanced card shows read-only diagnostics without Save button', async () => {
            mockFullConfig();
            await act(async () => { renderWithProviders(); });
            await gotoSettingsSubTab('advanced');
            await waitFor(() => expect(screen.getByTestId('settings-advanced')).toBeDefined());

            const advancedCard = screen.getByTestId('settings-advanced');
            expect(advancedCard.querySelector('[data-testid="settings-advanced-save"]')).toBeNull();
            expect(screen.getByText(/Approve Permissions/)).toBeDefined();
        });
    });

    describe('AI Provider tab — claude toggle', () => {
        function mockConfigWithClaude(claudeEnabled: boolean, defaultProvider: string) {
            mockFetch.mockImplementation((url: string) => {
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            resolved: {
                                model: 'gpt-4', parallel: 1, timeout: null, output: 'table',
                                codex: { enabled: false },
                                claude: { enabled: claudeEnabled },
                                defaultProvider,
                            },
                            sources: { 'claude.enabled': 'default', defaultProvider: 'default' },
                        }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });
        }

        it('renders claude provider toggle in the AI Provider tab', async () => {
            mockConfigWithClaude(false, 'copilot');
            await act(async () => { renderWithProviders(); });

            // Navigate to AI Provider tab
            await act(async () => {
                fireEvent.click(screen.getByTestId('admin-tab-agents'));
            });

            await waitFor(() => expect(screen.getByTestId('toggle-claude-enabled')).toBeDefined());
            const toggle = screen.getByTestId('toggle-claude-enabled');
            expect(toggle.getAttribute('aria-checked')).toBe('false');
        });

        it('claude toggle reflects enabled=true from config', async () => {
            mockConfigWithClaude(true, 'claude');
            await act(async () => { renderWithProviders(); });

            await act(async () => {
                fireEvent.click(screen.getByTestId('admin-tab-agents'));
            });

            await waitFor(() => expect(screen.getByTestId('toggle-claude-enabled')).toBeDefined());
            const toggle = screen.getByTestId('toggle-claude-enabled');
            expect(toggle.getAttribute('aria-checked')).toBe('true');
        });

        it('default provider select includes "claude" option', async () => {
            mockConfigWithClaude(false, 'copilot');
            await act(async () => { renderWithProviders(); });

            await act(async () => {
                fireEvent.click(screen.getByTestId('admin-tab-agents'));
            });

            await waitFor(() => expect(screen.getByTestId('select-default-provider-copilot')).toBeDefined());
            expect(screen.getByTestId('select-default-provider-copilot')).toBeDefined();
            expect(screen.getByTestId('select-default-provider-codex')).toBeDefined();
            expect(screen.getByTestId('select-default-provider-claude')).toBeDefined();
        });

        it('saves claude.enabled when toggling and saving', async () => {
            let capturedBody: Record<string, any> | null = null;
            mockFetch.mockImplementation((url: string, options?: any) => {
                if (url.includes('/admin/config') && options?.method === 'PUT') {
                    capturedBody = JSON.parse(options.body);
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            resolved: { model: 'gpt-4', codex: { enabled: false }, claude: { enabled: false }, defaultProvider: 'copilot' },
                            sources: {},
                        }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });

            await act(async () => { renderWithProviders(); });

            await act(async () => {
                fireEvent.click(screen.getByTestId('admin-tab-agents'));
            });

            await waitFor(() => expect(screen.getByTestId('toggle-claude-enabled')).toBeDefined());

            // Toggle claude on
            await act(async () => {
                fireEvent.click(screen.getByTestId('toggle-claude-enabled'));
            });

            // Save button should now be enabled
            await waitFor(() => {
                const saveBtn = screen.getByTestId('settings-default-provider-save') as HTMLButtonElement;
                expect(saveBtn.disabled).toBe(false);
            });

            // Click Save
            await act(async () => {
                fireEvent.click(screen.getByTestId('settings-default-provider-save'));
            });

            await waitFor(() => expect(capturedBody).not.toBeNull());
            expect(capturedBody!['claude.enabled']).toBe(true);
        });
    });

    describe('AI Provider tab — quota cache loading', () => {
        it('loads cached quota when the AI Provider tab becomes active', async () => {
            const quotaCalls: string[] = [];
            mockFetch.mockImplementation((url: string) => {
                if (url.includes('/agent-providers/quota')) {
                    quotaCalls.push(url);
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            lastUpdated: '2026-06-06T12:00:00.000Z',
                            providers: [
                                {
                                    id: 'copilot',
                                    quotaTypes: [
                                        {
                                            type: 'chat',
                                            isUnlimitedEntitlement: false,
                                            usedRequests: 20,
                                            entitlementRequests: 100,
                                            remainingPercentage: 0.8,
                                            usageAllowedWithExhaustedQuota: false,
                                            overage: 0,
                                            resetDate: '2026-06-07T00:00:00.000Z',
                                        },
                                    ],
                                },
                            ],
                        }),
                    });
                }
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            resolved: {
                                model: 'gpt-4', parallel: 1, timeout: null, output: 'table',
                                codex: { enabled: false },
                                claude: { enabled: false },
                                defaultProvider: 'copilot',
                            },
                            sources: {},
                        }),
                    });
                }
                if (url.includes('/agent-providers') && !url.includes('quota')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            providers: [
                                { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
                                { id: 'codex', label: 'Codex', enabled: false, available: false, installStatus: 'installed' },
                                { id: 'claude', label: 'Claude', enabled: false, available: false, installStatus: 'not-installed' },
                            ],
                        }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });

            await act(async () => { renderWithProviders(); });

            await act(async () => {
                fireEvent.click(screen.getByTestId('admin-tab-agents'));
            });

            await waitFor(() => expect(quotaCalls).toHaveLength(1));
            expect(quotaCalls[0]).toContain('/agent-providers/quota');
            expect(quotaCalls[0]).not.toContain('force=1');
            await waitFor(() => expect(screen.getAllByText('80% remaining').length).toBeGreaterThan(0));
            expect(screen.queryByText('Quota not loaded')).toBeNull();
        });
    });

    describe('AI Provider tab — SDK install buttons and badges', () => {
        function mockWithInstallStatuses(
            codexInstallStatus: string,
            claudeInstallStatus: string,
        ) {
            mockFetch.mockImplementation((url: string) => {
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            resolved: {
                                model: 'gpt-4', parallel: 1, timeout: null, output: 'table',
                                codex: { enabled: false },
                                claude: { enabled: false },
                                defaultProvider: 'copilot',
                            },
                            sources: {},
                        }),
                    });
                }
                // Agent providers list endpoint — returns installStatus per provider.
                if (url.includes('/agent-providers') && !url.includes('quota')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            providers: [
                                { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
                                { id: 'codex', label: 'Codex', enabled: false, available: false, installStatus: codexInstallStatus },
                                { id: 'claude', label: 'Claude', enabled: false, available: false, installStatus: claudeInstallStatus },
                            ],
                        }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });
        }

        it('shows Install buttons when both providers are not-installed', async () => {
            mockWithInstallStatuses('not-installed', 'not-installed');
            await act(async () => { renderWithProviders(); });

            await act(async () => {
                fireEvent.click(screen.getByTestId('admin-tab-agents'));
            });

            await waitFor(() => {
                expect(screen.getByTestId('btn-install-codex')).toBeDefined();
                expect(screen.getByTestId('btn-install-claude')).toBeDefined();
            });
        });

        it('shows not-installed badge when codex status is not-installed', async () => {
            mockWithInstallStatuses('not-installed', 'not-installed');
            await act(async () => { renderWithProviders(); });

            await act(async () => {
                fireEvent.click(screen.getByTestId('admin-tab-agents'));
            });

            await waitFor(() => {
                expect(screen.getAllByTestId('sdk-install-badge-not-installed').length).toBeGreaterThan(0);
            });
        });

        it('shows installed badge and hides Install button when codex is installed', async () => {
            mockWithInstallStatuses('installed', 'not-installed');
            await act(async () => { renderWithProviders(); });

            await act(async () => {
                fireEvent.click(screen.getByTestId('admin-tab-agents'));
            });

            await waitFor(() => {
                expect(screen.queryByTestId('btn-install-codex')).toBeNull();
                expect(screen.getByTestId('sdk-install-badge-installed')).toBeDefined();
            });
        });

        it('shows install-failed badge and Install button when install failed', async () => {
            mockWithInstallStatuses('install-failed', 'not-installed');
            await act(async () => { renderWithProviders(); });

            await act(async () => {
                fireEvent.click(screen.getByTestId('admin-tab-agents'));
            });

            await waitFor(() => {
                expect(screen.getByTestId('btn-install-codex')).toBeDefined();
                expect(screen.getByTestId('sdk-install-badge-install-failed')).toBeDefined();
            });
        });

        it('clicking Install triggers POST to provider install endpoint', async () => {
            const postCalls: string[] = [];
            mockFetch.mockImplementation((url: string, options?: RequestInit) => {
                if (options?.method === 'POST' && url.includes('/providers/sdk/codex/install')) {
                    postCalls.push(url);
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ status: 'installing', message: 'Installing…' }),
                    });
                }
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            resolved: { model: 'gpt-4', parallel: 1, timeout: null, output: 'table', codex: { enabled: false }, claude: { enabled: false }, defaultProvider: 'copilot' },
                            sources: {},
                        }),
                    });
                }
                if (url.includes('/agent-providers') && !url.includes('quota')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            providers: [
                                { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
                                { id: 'codex', label: 'Codex', enabled: false, available: false, installStatus: 'not-installed' },
                                { id: 'claude', label: 'Claude', enabled: false, available: false, installStatus: 'not-installed' },
                            ],
                        }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            });

            await act(async () => { renderWithProviders(); });

            await act(async () => {
                fireEvent.click(screen.getByTestId('admin-tab-agents'));
            });

            await waitFor(() => expect(screen.getByTestId('btn-install-codex')).toBeDefined());

            await act(async () => {
                fireEvent.click(screen.getByTestId('btn-install-codex'));
            });

            await waitFor(() => expect(postCalls.length).toBeGreaterThan(0));
            expect(postCalls[0]).toContain('/providers/sdk/codex/install');
        });
    });

    describe('auto provider routing controls', () => {
        it('saves the Auto provider routing feature flag from the AI Provider page', async () => {
            let capturedBody: any = null;
            mockFetch.mockImplementation((url: string, options?: any) => {
                if (url.includes('/admin/config') && options?.method === 'PUT') {
                    capturedBody = JSON.parse(options.body);
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            resolved: {
                                features: { autoAgentProviderRouting: false },
                            },
                            sources: {},
                        }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}), headers: new Headers() });
            });

            await act(async () => { renderWithProviders(); });
            await act(async () => {
                fireEvent.click(screen.getByTestId('admin-tab-agents'));
            });
            await waitFor(() => expect(screen.getByTestId('toggle-auto-agent-provider-routing-enabled')).toBeDefined());

            await act(async () => {
                fireEvent.click(screen.getByTestId('toggle-auto-agent-provider-routing-enabled'));
            });
            await act(async () => {
                fireEvent.click(screen.getByTestId('settings-default-provider-save'));
            });

            await waitFor(() => expect(capturedBody).not.toBeNull());
            expect(capturedBody['features.autoAgentProviderRouting']).toBe(true);
            expect(capturedBody.defaultProvider).toBe('copilot');
        });

        it('saves Auto enablement with the edited routing profile', async () => {
            let capturedBody: any = null;
            mockFetch.mockImplementation((url: string, options?: any) => {
                if (url.includes('/admin/config') && options?.method === 'PUT') {
                    capturedBody = JSON.parse(options.body);
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                if (url.includes('/admin/config')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            resolved: {
                                codex: { enabled: true },
                                claude: { enabled: true },
                                defaultProvider: 'copilot',
                                features: { autoAgentProviderRouting: true },
                                agentProviderRouting: {
                                    auto: {
                                        rules: [
                                            { provider: 'claude', enabled: true, minimumRemainingPercent: 33, weeklyGuard: { enabled: true, minimumRemainingPercent: 33 } },
                                            { provider: 'codex', enabled: true, minimumRemainingPercent: 33, weeklyGuard: { enabled: true, minimumRemainingPercent: 33 } },
                                            { provider: 'copilot', enabled: true, minimumRemainingPercent: 10, weeklyGuard: { enabled: true, minimumRemainingPercent: 10 } },
                                        ],
                                        fallbackProvider: 'copilot',
                                    },
                                },
                            },
                            sources: {},
                        }),
                    });
                }
                if (url.includes('/admin/providers/availability')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ codex: { available: true }, claude: { available: true } }),
                    });
                }
                if (url.includes('/agent-providers/quota')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            lastUpdated: '2026-06-06T17:00:00Z',
                            providers: [
                                { id: 'claude', quotaTypes: [{ type: 'five_hour', isUnlimitedEntitlement: false, usedRequests: 10, entitlementRequests: 100, remainingPercentage: 0.9, usageAllowedWithExhaustedQuota: false, overage: 0 }] },
                                { id: 'codex', quotaTypes: [{ type: 'five_hour', isUnlimitedEntitlement: false, usedRequests: 10, entitlementRequests: 100, remainingPercentage: 0.9, usageAllowedWithExhaustedQuota: false, overage: 0 }] },
                                { id: 'copilot', quotaTypes: [{ type: 'five_hour', isUnlimitedEntitlement: false, usedRequests: 10, entitlementRequests: 100, remainingPercentage: 0.9, usageAllowedWithExhaustedQuota: false, overage: 0 }] },
                            ],
                        }),
                    });
                }
                if (url.includes('/agent-providers')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            providers: [
                                { id: 'codex', installStatus: 'installed' },
                                { id: 'claude', installStatus: 'installed' },
                            ],
                        }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}), headers: new Headers() });
            });

            await act(async () => { renderWithProviders(); });
            await act(async () => {
                fireEvent.click(screen.getByTestId('admin-tab-agents'));
            });
            await waitFor(() => expect(screen.getByTestId('toggle-auto-agent-provider-routing-enabled')).toBeDefined());

            await waitFor(() => expect(screen.getByTestId('auto-provider-threshold-claude')).toBeDefined());
            await act(async () => {
                fireEvent.change(screen.getByTestId('auto-provider-threshold-claude'), { target: { value: '35' } });
            });
            await act(async () => {
                fireEvent.click(screen.getByTestId('settings-default-provider-save'));
            });

            await waitFor(() => expect(capturedBody).not.toBeNull());
            expect(capturedBody.defaultProvider).toBe('copilot');
            expect(capturedBody['features.autoAgentProviderRouting']).toBe(true);
            expect(capturedBody['codex.enabled']).toBe(true);
            expect(capturedBody['claude.enabled']).toBe(true);
            expect(capturedBody['agentProviderRouting.auto']).toEqual(expect.objectContaining({
                fallbackProvider: 'copilot',
                rules: [
                    expect.objectContaining({ provider: 'claude', minimumRemainingPercent: 35 }),
                    expect.objectContaining({ provider: 'codex', minimumRemainingPercent: 33 }),
                    expect.objectContaining({ provider: 'copilot', minimumRemainingPercent: 10 }),
                ],
            }));
        });
    });
});
