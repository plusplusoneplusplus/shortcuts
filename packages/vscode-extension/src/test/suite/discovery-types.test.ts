/**
 * Tests for Discovery Types
 */

import * as assert from 'assert';
import {
    DiscoverySourceType,
    DiscoveryResult,
    DiscoveryScope,
    DiscoveryRequest,
    DiscoveryPhase,
    DiscoveryProcess,
    DEFAULT_DISCOVERY_SCOPE
} from '../../shortcuts/discovery/types';

suite('Discovery Types Tests', () => {

    suite('DiscoverySourceType', () => {
        test('should support file type', () => {
            const type: DiscoverySourceType = 'file';
            assert.strictEqual(type, 'file');
        });

        test('should support folder type', () => {
            const type: DiscoverySourceType = 'folder';
            assert.strictEqual(type, 'folder');
        });

        test('should support commit type', () => {
            const type: DiscoverySourceType = 'commit';
            assert.strictEqual(type, 'commit');
        });

        test('should support doc type', () => {
            const type: DiscoverySourceType = 'doc';
            assert.strictEqual(type, 'doc');
        });
    });

    suite('DiscoveryResult interface', () => {
        test('should create file result with required properties', () => {
            const result: DiscoveryResult = {
                id: 'file-123',
                type: 'file',
                name: 'auth.ts',
                path: 'src/auth.ts',
                relevanceScore: 85,
                matchedKeywords: ['auth', 'login'],
                relevanceReason: 'High keyword match in filename and content',
                selected: false
            };

            assert.strictEqual(result.id, 'file-123');
            assert.strictEqual(result.type, 'file');
            assert.strictEqual(result.name, 'auth.ts');
            assert.strictEqual(result.path, 'src/auth.ts');
            assert.strictEqual(result.relevanceScore, 85);
            assert.deepStrictEqual(result.matchedKeywords, ['auth', 'login']);
            assert.strictEqual(result.relevanceReason, 'High keyword match in filename and content');
            assert.strictEqual(result.selected, false);
        });

        test('should create commit result with commit details', () => {
            const result: DiscoveryResult = {
                id: 'commit-abc123',
                type: 'commit',
                name: 'feat: Add authentication module',
                commit: {
                    hash: 'abc123def456789',
                    shortHash: 'abc123d',
                    subject: 'feat: Add authentication module',
                    authorName: 'John Doe',
                    date: '2024-01-15T10:30:00Z',
                    repositoryRoot: '/path/to/repo'
                },
                relevanceScore: 92,
                matchedKeywords: ['authentication', 'module'],
                relevanceReason: 'Commit message directly mentions feature',
                selected: true
            };

            assert.strictEqual(result.id, 'commit-abc123');
            assert.strictEqual(result.type, 'commit');
            assert.ok(result.commit);
            assert.strictEqual(result.commit?.hash, 'abc123def456789');
            assert.strictEqual(result.commit?.shortHash, 'abc123d');
            assert.strictEqual(result.commit?.subject, 'feat: Add authentication module');
            assert.strictEqual(result.commit?.authorName, 'John Doe');
            assert.strictEqual(result.selected, true);
        });

        test('should create doc result', () => {
            const result: DiscoveryResult = {
                id: 'doc-readme',
                type: 'doc',
                name: 'README.md',
                path: 'docs/README.md',
                relevanceScore: 70,
                matchedKeywords: ['api', 'documentation'],
                relevanceReason: 'Documentation file mentioning API',
                selected: false
            };

            assert.strictEqual(result.type, 'doc');
            assert.strictEqual(result.name, 'README.md');
        });

        test('should create folder result', () => {
            const result: DiscoveryResult = {
                id: 'folder-auth',
                type: 'folder',
                name: 'auth',
                path: 'src/auth',
                relevanceScore: 80,
                matchedKeywords: ['auth'],
                relevanceReason: 'Folder name matches keyword',
                selected: false
            };

            assert.strictEqual(result.type, 'folder');
            assert.strictEqual(result.path, 'src/auth');
        });

        test('should handle result without optional path', () => {
            const result: DiscoveryResult = {
                id: 'commit-xyz',
                type: 'commit',
                name: 'Some commit',
                relevanceScore: 50,
                matchedKeywords: [],
                relevanceReason: 'Low relevance',
                selected: false
            };

            assert.strictEqual(result.path, undefined);
        });

        test('should handle empty matchedKeywords', () => {
            const result: DiscoveryResult = {
                id: 'file-empty',
                type: 'file',
                name: 'empty.ts',
                path: 'src/empty.ts',
                relevanceScore: 30,
                matchedKeywords: [],
                relevanceReason: 'No direct keyword matches',
                selected: false
            };

            assert.deepStrictEqual(result.matchedKeywords, []);
        });

        test('should handle relevance score edge cases', () => {
            const minScore: DiscoveryResult = {
                id: '1',
                type: 'file',
                name: 'min.ts',
                relevanceScore: 0,
                matchedKeywords: [],
                relevanceReason: 'Minimum score',
                selected: false
            };

            const maxScore: DiscoveryResult = {
                id: '2',
                type: 'file',
                name: 'max.ts',
                relevanceScore: 100,
                matchedKeywords: ['all', 'keywords'],
                relevanceReason: 'Maximum score',
                selected: true
            };

            assert.strictEqual(minScore.relevanceScore, 0);
            assert.strictEqual(maxScore.relevanceScore, 100);
        });
    });

    suite('DiscoveryScope interface', () => {
        test('should create scope with all options enabled', () => {
            const scope: DiscoveryScope = {
                includeSourceFiles: true,
                includeDocs: true,
                includeConfigFiles: true,
                includeGitHistory: true,
                maxCommits: 100,
                excludePatterns: ['**/node_modules/**', '**/dist/**']
            };

            assert.strictEqual(scope.includeSourceFiles, true);
            assert.strictEqual(scope.includeDocs, true);
            assert.strictEqual(scope.includeConfigFiles, true);
            assert.strictEqual(scope.includeGitHistory, true);
            assert.strictEqual(scope.maxCommits, 100);
            assert.deepStrictEqual(scope.excludePatterns, ['**/node_modules/**', '**/dist/**']);
        });

        test('should create scope with all options disabled', () => {
            const scope: DiscoveryScope = {
                includeSourceFiles: false,
                includeDocs: false,
                includeConfigFiles: false,
                includeGitHistory: false,
                maxCommits: 0,
                excludePatterns: []
            };

            assert.strictEqual(scope.includeSourceFiles, false);
            assert.strictEqual(scope.maxCommits, 0);
            assert.deepStrictEqual(scope.excludePatterns, []);
        });

        test('should handle large maxCommits value', () => {
            const scope: DiscoveryScope = {
                includeSourceFiles: true,
                includeDocs: true,
                includeConfigFiles: true,
                includeGitHistory: true,
                maxCommits: 1000,
                excludePatterns: []
            };

            assert.strictEqual(scope.maxCommits, 1000);
        });

        test('should handle multiple exclude patterns', () => {
            const scope: DiscoveryScope = {
                includeSourceFiles: true,
                includeDocs: true,
                includeConfigFiles: true,
                includeGitHistory: true,
                maxCommits: 50,
                excludePatterns: [
                    '**/node_modules/**',
                    '**/dist/**',
                    '**/.git/**',
                    '**/coverage/**',
                    '**/*.test.ts',
                    '**/*.spec.ts'
                ]
            };

            assert.strictEqual(scope.excludePatterns.length, 6);
        });
    });

    suite('DEFAULT_DISCOVERY_SCOPE', () => {
        test('should have default values', () => {
            assert.strictEqual(DEFAULT_DISCOVERY_SCOPE.includeSourceFiles, true);
            assert.strictEqual(DEFAULT_DISCOVERY_SCOPE.includeDocs, true);
            assert.strictEqual(DEFAULT_DISCOVERY_SCOPE.includeConfigFiles, true);
            assert.strictEqual(DEFAULT_DISCOVERY_SCOPE.includeGitHistory, true);
            assert.strictEqual(DEFAULT_DISCOVERY_SCOPE.maxCommits, 50);
        });

        test('should have default exclude patterns', () => {
            assert.ok(Array.isArray(DEFAULT_DISCOVERY_SCOPE.excludePatterns));
            assert.ok(DEFAULT_DISCOVERY_SCOPE.excludePatterns.includes('**/node_modules/**'));
            assert.ok(DEFAULT_DISCOVERY_SCOPE.excludePatterns.includes('**/dist/**'));
            assert.ok(DEFAULT_DISCOVERY_SCOPE.excludePatterns.includes('**/.git/**'));
        });

        test('should be usable as base for custom scope', () => {
            const customScope: DiscoveryScope = {
                ...DEFAULT_DISCOVERY_SCOPE,
                includeGitHistory: false,
                maxCommits: 100
            };

            assert.strictEqual(customScope.includeSourceFiles, true);
            assert.strictEqual(customScope.includeGitHistory, false);
            assert.strictEqual(customScope.maxCommits, 100);
        });
    });

    suite('DiscoveryRequest interface', () => {
        test('should create request with all properties', () => {
            const request: DiscoveryRequest = {
                featureDescription: 'Implement user authentication with OAuth2',
                keywords: ['auth', 'oauth', 'login', 'user'],
                scope: DEFAULT_DISCOVERY_SCOPE,
                targetGroupPath: 'Features/Authentication',
                repositoryRoot: '/path/to/repo'
            };

            assert.strictEqual(request.featureDescription, 'Implement user authentication with OAuth2');
            assert.deepStrictEqual(request.keywords, ['auth', 'oauth', 'login', 'user']);
            assert.strictEqual(request.targetGroupPath, 'Features/Authentication');
            assert.strictEqual(request.repositoryRoot, '/path/to/repo');
        });

        test('should create request without optional keywords', () => {
            const request: DiscoveryRequest = {
                featureDescription: 'Add new feature',
                scope: DEFAULT_DISCOVERY_SCOPE,
                repositoryRoot: '/path/to/repo'
            };

            assert.strictEqual(request.keywords, undefined);
        });

        test('should create request without optional targetGroupPath', () => {
            const request: DiscoveryRequest = {
                featureDescription: 'Add new feature',
                scope: DEFAULT_DISCOVERY_SCOPE,
                repositoryRoot: '/path/to/repo'
            };

            assert.strictEqual(request.targetGroupPath, undefined);
        });

        test('should handle empty keywords array', () => {
            const request: DiscoveryRequest = {
                featureDescription: 'Feature',
                keywords: [],
                scope: DEFAULT_DISCOVERY_SCOPE,
                repositoryRoot: '/path'
            };

            assert.deepStrictEqual(request.keywords, []);
        });

        test('should handle nested target group path', () => {
            const request: DiscoveryRequest = {
                featureDescription: 'Feature',
                scope: DEFAULT_DISCOVERY_SCOPE,
                targetGroupPath: 'Level1/Level2/Level3/DeepGroup',
                repositoryRoot: '/path'
            };

            assert.strictEqual(request.targetGroupPath, 'Level1/Level2/Level3/DeepGroup');
        });
    });

    suite('DiscoveryPhase type', () => {
        test('should support initializing phase', () => {
            const phase: DiscoveryPhase = 'initializing';
            assert.strictEqual(phase, 'initializing');
        });

        test('should support extracting-keywords phase', () => {
            const phase: DiscoveryPhase = 'extracting-keywords';
            assert.strictEqual(phase, 'extracting-keywords');
        });

        test('should support scanning-files phase', () => {
            const phase: DiscoveryPhase = 'scanning-files';
            assert.strictEqual(phase, 'scanning-files');
        });

        test('should support scanning-git phase', () => {
            const phase: DiscoveryPhase = 'scanning-git';
            assert.strictEqual(phase, 'scanning-git');
        });

        test('should support scoring-relevance phase', () => {
            const phase: DiscoveryPhase = 'scoring-relevance';
            assert.strictEqual(phase, 'scoring-relevance');
        });

        test('should support completed phase', () => {
            const phase: DiscoveryPhase = 'completed';
            assert.strictEqual(phase, 'completed');
        });
    });

    suite('DiscoveryProcess interface', () => {
        test('should create running process', () => {
            const now = new Date();
            const process: DiscoveryProcess = {
                id: 'process-123',
                status: 'running',
                featureDescription: 'Test feature',
                phase: 'scanning-files',
                progress: 45,
                startTime: now
            };

            assert.strictEqual(process.id, 'process-123');
            assert.strictEqual(process.status, 'running');
            assert.strictEqual(process.featureDescription, 'Test feature');
            assert.strictEqual(process.phase, 'scanning-files');
            assert.strictEqual(process.progress, 45);
            assert.strictEqual(process.startTime, now);
            assert.strictEqual(process.endTime, undefined);
            assert.strictEqual(process.results, undefined);
            assert.strictEqual(process.error, undefined);
        });

        test('should create completed process with results', () => {
            const startTime = new Date(Date.now() - 5000);
            const endTime = new Date();
            const results: DiscoveryResult[] = [
                {
                    id: 'r1',
                    type: 'file',
                    name: 'test.ts',
                    path: 'src/test.ts',
                    relevanceScore: 80,
                    matchedKeywords: ['test'],
                    relevanceReason: 'Match',
                    selected: false
                }
            ];

            const process: DiscoveryProcess = {
                id: 'process-456',
                status: 'completed',
                featureDescription: 'Completed feature',
                phase: 'completed',
                progress: 100,
                startTime,
                endTime,
                results
            };

            assert.strictEqual(process.status, 'completed');
            assert.strictEqual(process.progress, 100);
            assert.strictEqual(process.phase, 'completed');
            assert.ok(process.endTime);
            assert.strictEqual(process.results?.length, 1);
        });

        test('should create failed process with error', () => {
            const process: DiscoveryProcess = {
                id: 'process-error',
                status: 'failed',
                featureDescription: 'Failed feature',
                phase: 'scanning-git',
                progress: 60,
                startTime: new Date(),
                endTime: new Date(),
                error: 'Git repository not found'
            };

            assert.strictEqual(process.status, 'failed');
            assert.strictEqual(process.error, 'Git repository not found');
            assert.ok(process.endTime);
        });

        test('should create cancelled process', () => {
            const process: DiscoveryProcess = {
                id: 'process-cancelled',
                status: 'cancelled',
                featureDescription: 'Cancelled feature',
                phase: 'extracting-keywords',
                progress: 15,
                startTime: new Date(),
                endTime: new Date()
            };

            assert.strictEqual(process.status, 'cancelled');
        });

        test('should handle process with empty results', () => {
            const process: DiscoveryProcess = {
                id: 'process-empty',
                status: 'completed',
                featureDescription: 'Empty results',
                phase: 'completed',
                progress: 100,
                startTime: new Date(),
                endTime: new Date(),
                results: []
            };

            assert.deepStrictEqual(process.results, []);
        });

        test('should handle process with many results', () => {
            const results: DiscoveryResult[] = [];
            for (let i = 0; i < 100; i++) {
                results.push({
                    id: `result-${i}`,
                    type: 'file',
                    name: `file${i}.ts`,
                    path: `src/file${i}.ts`,
                    relevanceScore: Math.floor(Math.random() * 100),
                    matchedKeywords: ['keyword'],
                    relevanceReason: 'Match',
                    selected: false
                });
            }

            const process: DiscoveryProcess = {
                id: 'process-many',
                status: 'completed',
                featureDescription: 'Many results',
                phase: 'completed',
                progress: 100,
                startTime: new Date(),
                endTime: new Date(),
                results
            };

            assert.strictEqual(process.results?.length, 100);
        });

        test('should handle progress edge cases', () => {
            const zeroProgress: DiscoveryProcess = {
                id: '1',
                status: 'running',
                featureDescription: 'Test',
                phase: 'initializing',
                progress: 0,
                startTime: new Date()
            };

            const fullProgress: DiscoveryProcess = {
                id: '2',
                status: 'completed',
                featureDescription: 'Test',
                phase: 'completed',
                progress: 100,
                startTime: new Date(),
                endTime: new Date()
            };

            assert.strictEqual(zeroProgress.progress, 0);
            assert.strictEqual(fullProgress.progress, 100);
        });
    });
});
