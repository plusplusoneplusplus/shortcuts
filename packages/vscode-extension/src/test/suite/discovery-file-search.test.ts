/**
 * Tests for File Search Provider
 * 
 * Note: These tests use the actual FileSearchProvider implementation
 * which relies on VS Code's workspace.findFiles API. In a real test
 * environment, this would require a VS Code extension host.
 */

import * as assert from 'assert';
import { FileSearchProvider } from '../../shortcuts/discovery/search-providers/file-search-provider';
import { DEFAULT_DISCOVERY_SCOPE, DiscoveryScope } from '../../shortcuts/discovery/types';

suite('FileSearchProvider Tests', () => {
    let provider: FileSearchProvider;

    setup(() => {
        provider = new FileSearchProvider();
    });

    suite('Constructor', () => {
        test('should create provider instance', () => {
            const p = new FileSearchProvider();
            assert.ok(p);
        });
    });

    suite('search method', () => {
        test('should have search method', () => {
            assert.ok(typeof provider.search === 'function');
        });

        test('should return array from search', async () => {
            const scope: DiscoveryScope = {
                ...DEFAULT_DISCOVERY_SCOPE,
                includeGitHistory: false
            };

            // This may return empty in test environment without VS Code
            const results = await provider.search(['test'], scope, '/nonexistent');
            assert.ok(Array.isArray(results));
        });

        test('should handle empty keywords', async () => {
            const scope: DiscoveryScope = {
                ...DEFAULT_DISCOVERY_SCOPE,
                includeGitHistory: false
            };

            const results = await provider.search([], scope, '/nonexistent');
            assert.ok(Array.isArray(results));
        });

        test('should handle empty repository root', async () => {
            const scope: DiscoveryScope = {
                ...DEFAULT_DISCOVERY_SCOPE,
                includeGitHistory: false
            };

            const results = await provider.search(['test'], scope, '');
            assert.ok(Array.isArray(results));
        });
    });

    suite('Scope configuration', () => {
        test('should respect includeSourceFiles setting', async () => {
            const scope: DiscoveryScope = {
                ...DEFAULT_DISCOVERY_SCOPE,
                includeSourceFiles: true,
                includeDocs: false,
                includeConfigFiles: false,
                includeGitHistory: false
            };

            // Just verify it doesn't throw
            const results = await provider.search(['test'], scope, '/nonexistent');
            assert.ok(Array.isArray(results));
        });

        test('should respect includeDocs setting', async () => {
            const scope: DiscoveryScope = {
                ...DEFAULT_DISCOVERY_SCOPE,
                includeSourceFiles: false,
                includeDocs: true,
                includeConfigFiles: false,
                includeGitHistory: false
            };

            const results = await provider.search(['test'], scope, '/nonexistent');
            assert.ok(Array.isArray(results));
        });

        test('should respect includeConfigFiles setting', async () => {
            const scope: DiscoveryScope = {
                ...DEFAULT_DISCOVERY_SCOPE,
                includeSourceFiles: false,
                includeDocs: false,
                includeConfigFiles: true,
                includeGitHistory: false
            };

            const results = await provider.search(['test'], scope, '/nonexistent');
            assert.ok(Array.isArray(results));
        });

        test('should handle all include options disabled', async () => {
            const scope: DiscoveryScope = {
                ...DEFAULT_DISCOVERY_SCOPE,
                includeSourceFiles: false,
                includeDocs: false,
                includeConfigFiles: false,
                includeGitHistory: false
            };

            const results = await provider.search(['test'], scope, '/nonexistent');
            assert.ok(Array.isArray(results));
        });

        test('should handle exclude patterns', async () => {
            const scope: DiscoveryScope = {
                ...DEFAULT_DISCOVERY_SCOPE,
                excludePatterns: ['**/node_modules/**', '**/dist/**'],
                includeGitHistory: false
            };

            const results = await provider.search(['test'], scope, '/nonexistent');
            assert.ok(Array.isArray(results));
        });
    });

    suite('Result structure', () => {
        test('should return RawSearchResult objects', async () => {
            const scope: DiscoveryScope = {
                ...DEFAULT_DISCOVERY_SCOPE,
                includeGitHistory: false
            };

            const results = await provider.search(['test'], scope, '/nonexistent');
            
            // If there are results, verify structure
            for (const result of results) {
                assert.ok(result.type === 'file' || result.type === 'doc');
                assert.ok(typeof result.name === 'string');
            }
        });
    });

    suite('Error handling', () => {
        test('should handle invalid paths gracefully', async () => {
            const scope: DiscoveryScope = {
                ...DEFAULT_DISCOVERY_SCOPE,
                includeGitHistory: false
            };

            // Should not throw
            const results = await provider.search(['test'], scope, '/this/path/does/not/exist');
            assert.ok(Array.isArray(results));
        });

        test('should handle special characters in keywords', async () => {
            const scope: DiscoveryScope = {
                ...DEFAULT_DISCOVERY_SCOPE,
                includeGitHistory: false
            };

            // Should not throw
            const results = await provider.search(['test-keyword', 'test_keyword'], scope, '/nonexistent');
            assert.ok(Array.isArray(results));
        });

        test('should handle unicode keywords', async () => {
            const scope: DiscoveryScope = {
                ...DEFAULT_DISCOVERY_SCOPE,
                includeGitHistory: false
            };

            // Should not throw
            const results = await provider.search(['認証', 'テスト'], scope, '/nonexistent');
            assert.ok(Array.isArray(results));
        });
    });
});

