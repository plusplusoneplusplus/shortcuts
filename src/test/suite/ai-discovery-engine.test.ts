/**
 * Tests for AI Discovery Engine
 * 
 * Comprehensive test coverage for the AI-powered discovery engine
 * that uses Copilot CLI for semantic search.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    AIDiscoveryEngine,
    AIDiscoveryConfig,
    AIDiscoveryResponse,
    AIDiscoveryItem,
    DEFAULT_AI_DISCOVERY_CONFIG,
    createAIDiscoveryRequest,
    parseDiscoveryResponse,
    buildExistingItemsSection
} from '../../shortcuts/discovery/ai-discovery-engine';
import { DiscoveryRequest, DEFAULT_DISCOVERY_SCOPE, ExistingGroupSnapshot } from '../../shortcuts/discovery/types';

suite('AI Discovery Engine Tests', () => {
    let tempDir: string;
    let engine: AIDiscoveryEngine;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-discovery-engine-test-'));
        engine = new AIDiscoveryEngine();
        
        // Create test files
        fs.writeFileSync(path.join(tempDir, 'auth.ts'), 'export function authenticate() { return true; }');
        fs.writeFileSync(path.join(tempDir, 'user.ts'), 'export class User { id: string; }');
        fs.writeFileSync(path.join(tempDir, 'README.md'), '# Authentication\n\nThis is the auth module.');
        fs.mkdirSync(path.join(tempDir, 'src'));
        fs.writeFileSync(path.join(tempDir, 'src', 'service.ts'), 'export class AuthService {}');
    });

    teardown(() => {
        engine.dispose();
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('DEFAULT_AI_DISCOVERY_CONFIG', () => {
        test('should have correct default values', () => {
            assert.strictEqual(DEFAULT_AI_DISCOVERY_CONFIG.enabled, true);
            assert.strictEqual(DEFAULT_AI_DISCOVERY_CONFIG.timeout, 120);
            assert.strictEqual(DEFAULT_AI_DISCOVERY_CONFIG.maxResults, 30);
            assert.strictEqual(DEFAULT_AI_DISCOVERY_CONFIG.minRelevance, 40);
            assert.strictEqual(DEFAULT_AI_DISCOVERY_CONFIG.focusAreas, undefined);
            assert.strictEqual(DEFAULT_AI_DISCOVERY_CONFIG.excludePatterns, undefined);
        });
    });

    suite('createAIDiscoveryRequest', () => {
        test('should create request with default scope', () => {
            const request = createAIDiscoveryRequest('authentication feature', tempDir);
            
            assert.strictEqual(request.featureDescription, 'authentication feature');
            assert.strictEqual(request.repositoryRoot, tempDir);
            assert.strictEqual(request.scope.includeSourceFiles, true);
            assert.strictEqual(request.scope.includeDocs, true);
            assert.strictEqual(request.scope.includeConfigFiles, true);
            assert.strictEqual(request.scope.includeGitHistory, true);
            assert.strictEqual(request.keywords, undefined);
            assert.strictEqual(request.targetGroupPath, undefined);
        });

        test('should create request with custom keywords', () => {
            const request = createAIDiscoveryRequest('authentication', tempDir, {
                keywords: ['auth', 'login', 'jwt']
            });
            
            assert.deepStrictEqual(request.keywords, ['auth', 'login', 'jwt']);
        });

        test('should create request with target group', () => {
            const request = createAIDiscoveryRequest('feature', tempDir, {
                targetGroupPath: 'My Group/Subgroup'
            });
            
            assert.strictEqual(request.targetGroupPath, 'My Group/Subgroup');
        });

        test('should create request with custom scope', () => {
            const request = createAIDiscoveryRequest('feature', tempDir, {
                scope: {
                    includeGitHistory: false,
                    maxCommits: 100
                }
            });
            
            assert.strictEqual(request.scope.includeGitHistory, false);
            assert.strictEqual(request.scope.maxCommits, 100);
            // Other defaults should be preserved
            assert.strictEqual(request.scope.includeSourceFiles, true);
        });

        test('should create request with all options', () => {
            const request = createAIDiscoveryRequest('complex feature', tempDir, {
                keywords: ['test'],
                targetGroupPath: 'Group',
                scope: { includeDocs: false }
            });
            
            assert.strictEqual(request.featureDescription, 'complex feature');
            assert.deepStrictEqual(request.keywords, ['test']);
            assert.strictEqual(request.targetGroupPath, 'Group');
            assert.strictEqual(request.scope.includeDocs, false);
        });

        test('should include default exclude patterns', () => {
            const request = createAIDiscoveryRequest('feature', tempDir);
            
            assert.ok(request.scope.excludePatterns.includes('**/node_modules/**'));
            assert.ok(request.scope.excludePatterns.includes('**/dist/**'));
            assert.ok(request.scope.excludePatterns.includes('**/.git/**'));
        });
    });

    suite('AIDiscoveryEngine Instance', () => {
        test('should create engine instance', () => {
            assert.ok(engine);
        });

        test('should have onDidChangeProcess event', () => {
            assert.ok(engine.onDidChangeProcess);
        });

        test('should have discover method', () => {
            assert.ok(typeof engine.discover === 'function');
        });

        test('should have cancelProcess method', () => {
            assert.ok(typeof engine.cancelProcess === 'function');
        });

        test('should have getProcess method', () => {
            assert.ok(typeof engine.getProcess === 'function');
        });

        test('should have getAllProcesses method', () => {
            assert.ok(typeof engine.getAllProcesses === 'function');
        });

        test('should have clearCompletedProcesses method', () => {
            assert.ok(typeof engine.clearCompletedProcesses === 'function');
        });

        test('should have getConfig method', () => {
            assert.ok(typeof engine.getConfig === 'function');
        });

        test('should return empty array for getAllProcesses initially', () => {
            const processes = engine.getAllProcesses();
            assert.ok(Array.isArray(processes));
            assert.strictEqual(processes.length, 0);
        });

        test('should return undefined for unknown process ID', () => {
            const process = engine.getProcess('unknown-id');
            assert.strictEqual(process, undefined);
        });

        test('should return config from getConfig', () => {
            const config = engine.getConfig();
            assert.ok(config);
            assert.ok(typeof config.timeout === 'number');
            assert.ok(typeof config.maxResults === 'number');
            assert.ok(typeof config.minRelevance === 'number');
        });
    });

    suite('Dispose', () => {
        test('should dispose without errors', () => {
            const localEngine = new AIDiscoveryEngine();
            
            // Should not throw
            localEngine.dispose();
        });

        test('should be safe to call dispose multiple times', () => {
            const localEngine = new AIDiscoveryEngine();
            
            localEngine.dispose();
            localEngine.dispose();
        });

        test('should clear all processes on dispose', () => {
            const localEngine = new AIDiscoveryEngine();
            
            localEngine.dispose();
            
            const processes = localEngine.getAllProcesses();
            assert.strictEqual(processes.length, 0);
        });
    });
});

suite('parseDiscoveryResponse Tests', () => {
    suite('Valid JSON Parsing', () => {
        test('should parse valid JSON response', () => {
            const response = JSON.stringify({
                feature: 'authentication',
                summary: 'Found 5 related files',
                results: [
                    {
                        type: 'source',
                        path: 'src/auth.ts',
                        relevance: 95,
                        reason: 'Core authentication module',
                        category: 'core'
                    }
                ]
            });

            const parsed = parseDiscoveryResponse(response);

            assert.strictEqual(parsed.feature, 'authentication');
            assert.strictEqual(parsed.summary, 'Found 5 related files');
            assert.strictEqual(parsed.results.length, 1);
            assert.strictEqual(parsed.results[0].type, 'source');
            assert.strictEqual(parsed.results[0].path, 'src/auth.ts');
            assert.strictEqual(parsed.results[0].relevance, 95);
        });

        test('should parse JSON from markdown code block', () => {
            const response = `Here's the result:

\`\`\`json
{
    "feature": "test feature",
    "summary": "Found results",
    "results": []
}
\`\`\`

That's all I found.`;

            const parsed = parseDiscoveryResponse(response);

            assert.strictEqual(parsed.feature, 'test feature');
            assert.strictEqual(parsed.summary, 'Found results');
            assert.deepStrictEqual(parsed.results, []);
        });

        test('should parse JSON from code block without language tag', () => {
            const response = `\`\`\`
{
    "feature": "feature",
    "summary": "summary",
    "results": []
}
\`\`\``;

            const parsed = parseDiscoveryResponse(response);

            assert.strictEqual(parsed.feature, 'feature');
        });

        test('should handle ANSI escape codes', () => {
            const response = '\x1b[32m{"feature": "test", "summary": "found", "results": []}\x1b[0m';

            const parsed = parseDiscoveryResponse(response);

            assert.strictEqual(parsed.feature, 'test');
        });
    });

    suite('Result Type Validation', () => {
        test('should accept valid source type', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [{
                    type: 'source',
                    path: 'src/file.ts',
                    relevance: 80,
                    reason: 'test',
                    category: 'core'
                }]
            });

            const parsed = parseDiscoveryResponse(response);
            assert.strictEqual(parsed.results[0].type, 'source');
        });

        test('should accept valid test type', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [{
                    type: 'test',
                    path: 'tests/file.test.ts',
                    relevance: 75,
                    reason: 'test file',
                    category: 'supporting'
                }]
            });

            const parsed = parseDiscoveryResponse(response);
            assert.strictEqual(parsed.results[0].type, 'test');
        });

        test('should accept valid doc type', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [{
                    type: 'doc',
                    path: 'docs/README.md',
                    relevance: 70,
                    reason: 'documentation',
                    category: 'related'
                }]
            });

            const parsed = parseDiscoveryResponse(response);
            assert.strictEqual(parsed.results[0].type, 'doc');
        });

        test('should accept valid config type', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [{
                    type: 'config',
                    path: 'config/settings.json',
                    relevance: 60,
                    reason: 'configuration',
                    category: 'tangential'
                }]
            });

            const parsed = parseDiscoveryResponse(response);
            assert.strictEqual(parsed.results[0].type, 'config');
        });

        test('should accept valid commit type with hash', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [{
                    type: 'commit',
                    hash: 'abc1234',
                    message: 'feat: add feature',
                    relevance: 85,
                    reason: 'relevant commit',
                    category: 'core'
                }]
            });

            const parsed = parseDiscoveryResponse(response);
            assert.strictEqual(parsed.results[0].type, 'commit');
            assert.strictEqual(parsed.results[0].hash, 'abc1234');
            assert.strictEqual(parsed.results[0].message, 'feat: add feature');
        });

        test('should skip invalid type', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [{
                    type: 'invalid',
                    path: 'file.ts',
                    relevance: 80,
                    reason: 'test',
                    category: 'core'
                }]
            });

            const parsed = parseDiscoveryResponse(response);
            assert.strictEqual(parsed.results.length, 0);
        });
    });

    suite('Result Validation', () => {
        test('should skip results with invalid relevance (negative)', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [{
                    type: 'source',
                    path: 'file.ts',
                    relevance: -10,
                    reason: 'test',
                    category: 'core'
                }]
            });

            const parsed = parseDiscoveryResponse(response);
            assert.strictEqual(parsed.results.length, 0);
        });

        test('should skip results with invalid relevance (over 100)', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [{
                    type: 'source',
                    path: 'file.ts',
                    relevance: 150,
                    reason: 'test',
                    category: 'core'
                }]
            });

            const parsed = parseDiscoveryResponse(response);
            assert.strictEqual(parsed.results.length, 0);
        });

        test('should skip commits without hash', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [{
                    type: 'commit',
                    message: 'feat: add feature',
                    relevance: 80,
                    reason: 'test',
                    category: 'core'
                }]
            });

            const parsed = parseDiscoveryResponse(response);
            assert.strictEqual(parsed.results.length, 0);
        });

        test('should skip files without path', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [{
                    type: 'source',
                    relevance: 80,
                    reason: 'test',
                    category: 'core'
                }]
            });

            const parsed = parseDiscoveryResponse(response);
            assert.strictEqual(parsed.results.length, 0);
        });

        test('should round relevance scores', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [{
                    type: 'source',
                    path: 'file.ts',
                    relevance: 85.7,
                    reason: 'test',
                    category: 'core'
                }]
            });

            const parsed = parseDiscoveryResponse(response);
            assert.strictEqual(parsed.results[0].relevance, 86);
        });

        test('should use default reason if not provided', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [{
                    type: 'source',
                    path: 'file.ts',
                    relevance: 80,
                    category: 'core'
                }]
            });

            const parsed = parseDiscoveryResponse(response);
            assert.strictEqual(parsed.results[0].reason, 'Matched search criteria');
        });

        test('should use default category for invalid category', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [{
                    type: 'source',
                    path: 'file.ts',
                    relevance: 80,
                    reason: 'test',
                    category: 'invalid'
                }]
            });

            const parsed = parseDiscoveryResponse(response);
            assert.strictEqual(parsed.results[0].category, 'related');
        });
    });

    suite('Category Validation', () => {
        test('should accept core category', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [{
                    type: 'source',
                    path: 'file.ts',
                    relevance: 80,
                    reason: 'test',
                    category: 'core'
                }]
            });

            const parsed = parseDiscoveryResponse(response);
            assert.strictEqual(parsed.results[0].category, 'core');
        });

        test('should accept supporting category', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [{
                    type: 'source',
                    path: 'file.ts',
                    relevance: 80,
                    reason: 'test',
                    category: 'supporting'
                }]
            });

            const parsed = parseDiscoveryResponse(response);
            assert.strictEqual(parsed.results[0].category, 'supporting');
        });

        test('should accept related category', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [{
                    type: 'source',
                    path: 'file.ts',
                    relevance: 80,
                    reason: 'test',
                    category: 'related'
                }]
            });

            const parsed = parseDiscoveryResponse(response);
            assert.strictEqual(parsed.results[0].category, 'related');
        });

        test('should accept tangential category', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [{
                    type: 'source',
                    path: 'file.ts',
                    relevance: 80,
                    reason: 'test',
                    category: 'tangential'
                }]
            });

            const parsed = parseDiscoveryResponse(response);
            assert.strictEqual(parsed.results[0].category, 'tangential');
        });
    });

    suite('Error Handling', () => {
        test('should throw error for missing JSON', () => {
            assert.throws(() => {
                parseDiscoveryResponse('No JSON here');
            }, /No JSON object found/);
        });

        test('should throw error for invalid JSON', () => {
            assert.throws(() => {
                parseDiscoveryResponse('{invalid json}');
            }, /Failed to parse JSON/);
        });

        test('should throw error for missing feature field', () => {
            assert.throws(() => {
                parseDiscoveryResponse('{"summary": "test", "results": []}');
            }, /Invalid response structure/);
        });

        test('should throw error for missing summary field', () => {
            assert.throws(() => {
                parseDiscoveryResponse('{"feature": "test", "results": []}');
            }, /Invalid response structure/);
        });

        test('should throw error for missing results field', () => {
            assert.throws(() => {
                parseDiscoveryResponse('{"feature": "test", "summary": "test"}');
            }, /Invalid response structure/);
        });

        test('should throw error for non-array results', () => {
            assert.throws(() => {
                parseDiscoveryResponse('{"feature": "test", "summary": "test", "results": "not array"}');
            }, /Invalid response structure/);
        });
    });

    suite('Complex Scenarios', () => {
        test('should parse mixed result types', () => {
            const response = JSON.stringify({
                feature: 'RocksDB integration',
                summary: 'Found 15 related items',
                results: [
                    {
                        type: 'source',
                        path: 'src/storage/rocks.rs',
                        relevance: 95,
                        reason: 'Core RocksDB wrapper',
                        category: 'core'
                    },
                    {
                        type: 'test',
                        path: 'tests/storage_test.rs',
                        relevance: 88,
                        reason: 'Integration tests',
                        category: 'supporting'
                    },
                    {
                        type: 'commit',
                        hash: 'abc1234',
                        message: 'feat: add RocksDB compaction',
                        relevance: 90,
                        reason: 'Recent feature addition',
                        category: 'core'
                    },
                    {
                        type: 'doc',
                        path: 'docs/storage.md',
                        relevance: 75,
                        reason: 'Storage documentation',
                        category: 'related'
                    },
                    {
                        type: 'config',
                        path: 'config/rocksdb.yaml',
                        relevance: 70,
                        reason: 'Configuration file',
                        category: 'tangential'
                    }
                ]
            });

            const parsed = parseDiscoveryResponse(response);

            assert.strictEqual(parsed.results.length, 5);
            assert.strictEqual(parsed.results[0].type, 'source');
            assert.strictEqual(parsed.results[1].type, 'test');
            assert.strictEqual(parsed.results[2].type, 'commit');
            assert.strictEqual(parsed.results[3].type, 'doc');
            assert.strictEqual(parsed.results[4].type, 'config');
        });

        test('should filter out invalid results while keeping valid ones', () => {
            const response = JSON.stringify({
                feature: 'test',
                summary: 'found',
                results: [
                    { type: 'source', path: 'valid.ts', relevance: 80, reason: 'valid', category: 'core' },
                    { type: 'invalid', path: 'invalid.ts', relevance: 80, reason: 'invalid type', category: 'core' },
                    { type: 'source', path: 'also-valid.ts', relevance: 70, reason: 'also valid', category: 'core' },
                    { type: 'commit', message: 'no hash', relevance: 60, reason: 'missing hash', category: 'core' }
                ]
            });

            const parsed = parseDiscoveryResponse(response);

            assert.strictEqual(parsed.results.length, 2);
            assert.strictEqual(parsed.results[0].path, 'valid.ts');
            assert.strictEqual(parsed.results[1].path, 'also-valid.ts');
        });

        test('should handle JSON embedded in verbose AI output', () => {
            const response = `I searched through the codebase and found the following related items:

\`\`\`json
{
    "feature": "authentication",
    "summary": "Found 3 files related to authentication",
    "results": [
        {
            "type": "source",
            "path": "src/auth/login.ts",
            "relevance": 95,
            "reason": "Main login implementation",
            "category": "core"
        }
    ]
}
\`\`\`

The main authentication logic is in the src/auth directory. I also found some related tests but they had lower relevance scores.`;

            const parsed = parseDiscoveryResponse(response);

            assert.strictEqual(parsed.feature, 'authentication');
            assert.strictEqual(parsed.results.length, 1);
            assert.strictEqual(parsed.results[0].path, 'src/auth/login.ts');
        });

        test('should handle empty results array', () => {
            const response = JSON.stringify({
                feature: 'nonexistent feature',
                summary: 'No related items found',
                results: []
            });

            const parsed = parseDiscoveryResponse(response);

            assert.strictEqual(parsed.feature, 'nonexistent feature');
            assert.strictEqual(parsed.summary, 'No related items found');
            assert.deepStrictEqual(parsed.results, []);
        });
    });
});

suite('AIDiscoveryEngine Process Management Tests', () => {
    let engine: AIDiscoveryEngine;

    setup(() => {
        engine = new AIDiscoveryEngine();
    });

    teardown(() => {
        engine.dispose();
    });

    test('should clear completed processes', () => {
        // This tests the clearCompletedProcesses method
        engine.clearCompletedProcesses();
        
        const processes = engine.getAllProcesses();
        assert.strictEqual(processes.length, 0);
    });

    test('should handle cancelling non-existent process', () => {
        // Should not throw
        engine.cancelProcess('non-existent-id');
    });

    test('should return undefined for non-existent process', () => {
        const process = engine.getProcess('non-existent-id');
        assert.strictEqual(process, undefined);
    });
});

suite('AIDiscoveryEngine Event Tests', () => {
    let engine: AIDiscoveryEngine;

    setup(() => {
        engine = new AIDiscoveryEngine();
    });

    teardown(() => {
        engine.dispose();
    });

    test('should have onDidChangeProcess event emitter', () => {
        assert.ok(engine.onDidChangeProcess);
        assert.ok(typeof engine.onDidChangeProcess === 'function');
    });

    test('should allow subscribing to events', () => {
        let eventReceived = false;
        
        const disposable = engine.onDidChangeProcess(() => {
            eventReceived = true;
        });
        
        assert.ok(disposable);
        disposable.dispose();
    });
});

suite('buildExistingItemsSection Tests', () => {
    test('should return empty string for undefined snapshot', () => {
        const result = buildExistingItemsSection(undefined);
        assert.strictEqual(result, '');
    });

    test('should return empty string for snapshot with empty items', () => {
        const snapshot: ExistingGroupSnapshot = {
            name: 'Test Group',
            items: []
        };
        const result = buildExistingItemsSection(snapshot);
        assert.strictEqual(result, '');
    });

    test('should include file paths in output', () => {
        const snapshot: ExistingGroupSnapshot = {
            name: 'Auth Module',
            description: 'Authentication related files',
            items: [
                { type: 'file', path: 'src/auth/login.ts' },
                { type: 'file', path: 'src/auth/logout.ts' }
            ]
        };
        const result = buildExistingItemsSection(snapshot);
        
        assert.ok(result.includes('Auth Module'));
        assert.ok(result.includes('src/auth/login.ts'));
        assert.ok(result.includes('src/auth/logout.ts'));
        assert.ok(result.includes('Existing Items to Skip'));
    });

    test('should include folder paths in output', () => {
        const snapshot: ExistingGroupSnapshot = {
            name: 'Components',
            items: [
                { type: 'folder', path: 'src/components' },
                { type: 'folder', path: 'src/shared' }
            ]
        };
        const result = buildExistingItemsSection(snapshot);
        
        assert.ok(result.includes('src/components'));
        assert.ok(result.includes('src/shared'));
        assert.ok(result.includes('Files/folders already in group'));
    });

    test('should include commit hashes in output', () => {
        const snapshot: ExistingGroupSnapshot = {
            name: 'Feature Commits',
            items: [
                { type: 'commit', commitHash: 'abc1234567890' },
                { type: 'commit', commitHash: 'def9876543210' }
            ]
        };
        const result = buildExistingItemsSection(snapshot);
        
        assert.ok(result.includes('abc1234567890'));
        assert.ok(result.includes('def9876543210'));
        assert.ok(result.includes('Commits already in group'));
    });

    test('should include both files and commits in output', () => {
        const snapshot: ExistingGroupSnapshot = {
            name: 'Mixed Group',
            items: [
                { type: 'file', path: 'src/main.ts' },
                { type: 'folder', path: 'src/utils' },
                { type: 'commit', commitHash: 'abc123' }
            ]
        };
        const result = buildExistingItemsSection(snapshot);
        
        assert.ok(result.includes('src/main.ts'));
        assert.ok(result.includes('src/utils'));
        assert.ok(result.includes('abc123'));
        assert.ok(result.includes('Files/folders already in group'));
        assert.ok(result.includes('Commits already in group'));
    });

    test('should filter out items with missing paths or hashes', () => {
        const snapshot: ExistingGroupSnapshot = {
            name: 'Partial Group',
            items: [
                { type: 'file', path: 'src/valid.ts' },
                { type: 'file' }, // Missing path
                { type: 'commit', commitHash: 'abc123' },
                { type: 'commit' } // Missing commitHash
            ]
        };
        const result = buildExistingItemsSection(snapshot);
        
        assert.ok(result.includes('src/valid.ts'));
        assert.ok(result.includes('abc123'));
        // The output should still be valid
        assert.ok(result.includes('Existing Items to Skip'));
    });
});

suite('createAIDiscoveryRequest with existingGroupSnapshot Tests', () => {
    const tempDir = '/tmp/test-repo';

    test('should create request without existingGroupSnapshot', () => {
        const request = createAIDiscoveryRequest('authentication feature', tempDir);
        
        assert.strictEqual(request.existingGroupSnapshot, undefined);
    });

    test('should create request with existingGroupSnapshot', () => {
        const snapshot: ExistingGroupSnapshot = {
            name: 'Auth',
            description: 'Authentication module',
            items: [
                { type: 'file', path: 'src/auth.ts' }
            ]
        };
        
        const request = createAIDiscoveryRequest('authentication feature', tempDir, {
            existingGroupSnapshot: snapshot
        });
        
        assert.ok(request.existingGroupSnapshot);
        assert.strictEqual(request.existingGroupSnapshot.name, 'Auth');
        assert.strictEqual(request.existingGroupSnapshot.description, 'Authentication module');
        assert.strictEqual(request.existingGroupSnapshot.items.length, 1);
        assert.strictEqual(request.existingGroupSnapshot.items[0].path, 'src/auth.ts');
    });

    test('should create request with all options including existingGroupSnapshot', () => {
        const snapshot: ExistingGroupSnapshot = {
            name: 'Feature Group',
            items: [
                { type: 'file', path: 'src/feature.ts' },
                { type: 'commit', commitHash: 'abc123' }
            ]
        };
        
        const request = createAIDiscoveryRequest('complex feature', tempDir, {
            keywords: ['test', 'feature'],
            targetGroupPath: 'My Group',
            scope: { includeDocs: false },
            existingGroupSnapshot: snapshot
        });
        
        assert.strictEqual(request.featureDescription, 'complex feature');
        assert.deepStrictEqual(request.keywords, ['test', 'feature']);
        assert.strictEqual(request.targetGroupPath, 'My Group');
        assert.strictEqual(request.scope.includeDocs, false);
        assert.ok(request.existingGroupSnapshot);
        assert.strictEqual(request.existingGroupSnapshot.name, 'Feature Group');
        assert.strictEqual(request.existingGroupSnapshot.items.length, 2);
    });
});

