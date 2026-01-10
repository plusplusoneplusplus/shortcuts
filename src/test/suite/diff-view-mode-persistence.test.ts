/**
 * Tests for Git Diff View Mode Persistence
 * Tests that the inline/split view mode preference is persisted across webview sessions
 */

import * as assert from 'assert';

/**
 * View mode type (matches the type in state.ts)
 */
type ViewMode = 'split' | 'inline';

/**
 * Persisted webview state interface (matches the interface in vscode-bridge.ts)
 */
interface PersistedWebviewState {
    viewMode?: ViewMode;
    initialData?: any;
}

/**
 * Mock VSCode webview state API
 * Simulates the behavior of vscode.getState() and vscode.setState()
 */
class MockWebviewStateAPI {
    private state: any = null;

    getState(): any {
        return this.state;
    }

    setState(newState: any): void {
        this.state = newState;
    }

    // Helper to reset state for testing
    reset(): void {
        this.state = null;
    }
}

suite('Diff View Mode Persistence Tests', () => {
    let mockApi: MockWebviewStateAPI;

    setup(() => {
        mockApi = new MockWebviewStateAPI();
    });

    suite('View Mode Storage', () => {
        test('should persist split view mode', () => {
            const state: PersistedWebviewState = {
                viewMode: 'split',
                initialData: { filePath: 'test.ts' }
            };

            mockApi.setState(state);
            const retrieved = mockApi.getState() as PersistedWebviewState;

            assert.strictEqual(retrieved.viewMode, 'split');
        });

        test('should persist inline view mode', () => {
            const state: PersistedWebviewState = {
                viewMode: 'inline',
                initialData: { filePath: 'test.ts' }
            };

            mockApi.setState(state);
            const retrieved = mockApi.getState() as PersistedWebviewState;

            assert.strictEqual(retrieved.viewMode, 'inline');
        });

        test('should return undefined view mode when not set', () => {
            mockApi.setState({ initialData: { filePath: 'test.ts' } });
            const retrieved = mockApi.getState() as PersistedWebviewState;

            assert.strictEqual(retrieved.viewMode, undefined);
        });

        test('should return null when no state exists', () => {
            const retrieved = mockApi.getState();

            assert.strictEqual(retrieved, null);
        });
    });

    suite('View Mode Updates', () => {
        test('should update view mode while preserving other state', () => {
            // Set initial state with split view
            const initialState: PersistedWebviewState = {
                viewMode: 'split',
                initialData: { filePath: 'test.ts', oldContent: 'old', newContent: 'new' }
            };
            mockApi.setState(initialState);

            // Update to inline view while preserving initialData
            const existingState = mockApi.getState() as PersistedWebviewState;
            const newState: PersistedWebviewState = {
                ...existingState,
                viewMode: 'inline'
            };
            mockApi.setState(newState);

            const retrieved = mockApi.getState() as PersistedWebviewState;

            assert.strictEqual(retrieved.viewMode, 'inline');
            assert.deepStrictEqual(retrieved.initialData, { filePath: 'test.ts', oldContent: 'old', newContent: 'new' });
        });

        test('should toggle view mode from split to inline', () => {
            mockApi.setState({ viewMode: 'split' });

            const currentState = mockApi.getState() as PersistedWebviewState;
            const newViewMode: ViewMode = currentState.viewMode === 'split' ? 'inline' : 'split';
            mockApi.setState({ ...currentState, viewMode: newViewMode });

            const retrieved = mockApi.getState() as PersistedWebviewState;
            assert.strictEqual(retrieved.viewMode, 'inline');
        });

        test('should toggle view mode from inline to split', () => {
            mockApi.setState({ viewMode: 'inline' });

            const currentState = mockApi.getState() as PersistedWebviewState;
            const newViewMode: ViewMode = currentState.viewMode === 'split' ? 'inline' : 'split';
            mockApi.setState({ ...currentState, viewMode: newViewMode });

            const retrieved = mockApi.getState() as PersistedWebviewState;
            assert.strictEqual(retrieved.viewMode, 'split');
        });
    });

    suite('Initial State Creation', () => {
        /**
         * Simulates the createInitialState function from state.ts
         */
        function createInitialState(persistedViewMode?: ViewMode): { viewMode: ViewMode } {
            return {
                viewMode: persistedViewMode || 'split'
            };
        }

        test('should default to split view when no persisted mode', () => {
            const state = createInitialState(undefined);
            assert.strictEqual(state.viewMode, 'split');
        });

        test('should use persisted split mode', () => {
            const state = createInitialState('split');
            assert.strictEqual(state.viewMode, 'split');
        });

        test('should use persisted inline mode', () => {
            const state = createInitialState('inline');
            assert.strictEqual(state.viewMode, 'inline');
        });
    });

    suite('Cross-Platform Compatibility', () => {
        test('should handle view mode string values (case sensitivity)', () => {
            // View modes should be lowercase
            const validModes: ViewMode[] = ['split', 'inline'];
            
            for (const mode of validModes) {
                assert.strictEqual(mode.toLowerCase(), mode, `View mode "${mode}" should be lowercase`);
            }
        });

        test('should serialize view mode as string in JSON', () => {
            const state: PersistedWebviewState = {
                viewMode: 'inline',
                initialData: { filePath: 'test.ts' }
            };

            // Simulate JSON serialization (as done by VSCode webview state)
            const serialized = JSON.stringify(state);
            const deserialized = JSON.parse(serialized) as PersistedWebviewState;

            assert.strictEqual(deserialized.viewMode, 'inline');
            assert.strictEqual(typeof deserialized.viewMode, 'string');
        });

        test('should handle empty state object', () => {
            mockApi.setState({});
            const retrieved = mockApi.getState() as PersistedWebviewState;

            assert.strictEqual(retrieved.viewMode, undefined);
        });
    });

    suite('State Restoration', () => {
        test('should restore inline view mode after webview recreation', () => {
            // Simulate setting state before webview is destroyed
            mockApi.setState({ viewMode: 'inline', initialData: { filePath: 'test.ts' } });

            // Simulate webview recreation - state should persist
            const restored = mockApi.getState() as PersistedWebviewState;

            assert.strictEqual(restored.viewMode, 'inline');
        });

        test('should restore split view mode after webview recreation', () => {
            // Simulate setting state before webview is destroyed
            mockApi.setState({ viewMode: 'split', initialData: { filePath: 'test.ts' } });

            // Simulate webview recreation - state should persist
            const restored = mockApi.getState() as PersistedWebviewState;

            assert.strictEqual(restored.viewMode, 'split');
        });

        test('should preserve view mode when updating initialData', () => {
            // Set initial state with inline view
            mockApi.setState({ viewMode: 'inline', initialData: { filePath: 'test.ts' } });

            // Update initialData while preserving viewMode (as done in initVSCodeAPI)
            const existingState = mockApi.getState() as PersistedWebviewState;
            const newState: PersistedWebviewState = {
                ...existingState,
                initialData: { filePath: 'updated.ts', oldContent: 'new old', newContent: 'new new' }
            };
            mockApi.setState(newState);

            const retrieved = mockApi.getState() as PersistedWebviewState;

            assert.strictEqual(retrieved.viewMode, 'inline', 'View mode should be preserved');
            assert.strictEqual(retrieved.initialData.filePath, 'updated.ts', 'InitialData should be updated');
        });
    });

    suite('Edge Cases', () => {
        test('should handle null initialData', () => {
            const state: PersistedWebviewState = {
                viewMode: 'inline',
                initialData: null
            };

            mockApi.setState(state);
            const retrieved = mockApi.getState() as PersistedWebviewState;

            assert.strictEqual(retrieved.viewMode, 'inline');
            assert.strictEqual(retrieved.initialData, null);
        });

        test('should handle undefined initialData', () => {
            const state: PersistedWebviewState = {
                viewMode: 'split'
            };

            mockApi.setState(state);
            const retrieved = mockApi.getState() as PersistedWebviewState;

            assert.strictEqual(retrieved.viewMode, 'split');
            assert.strictEqual(retrieved.initialData, undefined);
        });

        test('should handle rapid view mode changes', () => {
            // Simulate rapid toggling
            mockApi.setState({ viewMode: 'split' });
            mockApi.setState({ viewMode: 'inline' });
            mockApi.setState({ viewMode: 'split' });
            mockApi.setState({ viewMode: 'inline' });

            const retrieved = mockApi.getState() as PersistedWebviewState;
            assert.strictEqual(retrieved.viewMode, 'inline', 'Should reflect last set value');
        });
    });
});

suite('View Mode Toggle Logic Tests', () => {
    /**
     * Simulates the toggleViewMode function from state.ts
     */
    function toggleViewMode(currentMode: ViewMode): ViewMode {
        return currentMode === 'split' ? 'inline' : 'split';
    }

    test('should toggle from split to inline', () => {
        const result = toggleViewMode('split');
        assert.strictEqual(result, 'inline');
    });

    test('should toggle from inline to split', () => {
        const result = toggleViewMode('inline');
        assert.strictEqual(result, 'split');
    });

    test('should return to original after two toggles', () => {
        let mode: ViewMode = 'split';
        mode = toggleViewMode(mode);
        mode = toggleViewMode(mode);
        assert.strictEqual(mode, 'split');
    });
});
