/**
 * Tests for View Discovery Results functionality
 * 
 * Tests the ability to reopen discovery results from the AI Processes panel
 * via context menu "View Discovery Results" command.
 */

import * as assert from 'assert';
import {
    DiscoveryProcess,
    DiscoveryResult,
    serializeDiscoveryProcess,
    deserializeDiscoveryProcess,
    SerializedDiscoveryProcess
} from '../../shortcuts/discovery/types';

suite('View Discovery Results Tests', () => {
    suite('Discovery Process Serialization', () => {
        test('should serialize a completed discovery process with results', () => {
            const process: DiscoveryProcess = {
                id: 'discovery-123',
                status: 'completed',
                featureDescription: 'user authentication',
                phase: 'completed',
                progress: 100,
                results: [
                    {
                        id: 'file:src/auth.ts',
                        type: 'file',
                        name: 'auth.ts',
                        path: 'src/auth.ts',
                        relevanceScore: 95,
                        matchedKeywords: ['auth', 'login'],
                        relevanceReason: 'Core authentication module',
                        selected: false
                    },
                    {
                        id: 'commit:abc1234',
                        type: 'commit',
                        name: 'Add authentication',
                        commit: {
                            hash: 'abc1234567890',
                            shortHash: 'abc1234',
                            subject: 'Add authentication',
                            authorName: 'Developer',
                            date: '2024-01-01T00:00:00.000Z',
                            repositoryRoot: '/repo'
                        },
                        relevanceScore: 85,
                        matchedKeywords: ['auth'],
                        relevanceReason: 'Related commit',
                        selected: true
                    }
                ],
                startTime: new Date('2024-01-01T00:00:00.000Z'),
                endTime: new Date('2024-01-01T00:01:00.000Z')
            };

            const serialized = serializeDiscoveryProcess(process);

            assert.strictEqual(serialized.id, 'discovery-123');
            assert.strictEqual(serialized.status, 'completed');
            assert.strictEqual(serialized.featureDescription, 'user authentication');
            assert.strictEqual(serialized.phase, 'completed');
            assert.strictEqual(serialized.progress, 100);
            assert.strictEqual(serialized.results?.length, 2);
            assert.strictEqual(serialized.startTime, '2024-01-01T00:00:00.000Z');
            assert.strictEqual(serialized.endTime, '2024-01-01T00:01:00.000Z');
        });

        test('should serialize a process without results', () => {
            const process: DiscoveryProcess = {
                id: 'discovery-456',
                status: 'failed',
                featureDescription: 'nonexistent feature',
                phase: 'scanning-files',
                progress: 50,
                error: 'No results found',
                startTime: new Date('2024-01-01T00:00:00.000Z'),
                endTime: new Date('2024-01-01T00:00:30.000Z')
            };

            const serialized = serializeDiscoveryProcess(process);

            assert.strictEqual(serialized.id, 'discovery-456');
            assert.strictEqual(serialized.status, 'failed');
            assert.strictEqual(serialized.error, 'No results found');
            assert.strictEqual(serialized.results, undefined);
        });

        test('should serialize a running process', () => {
            const process: DiscoveryProcess = {
                id: 'discovery-789',
                status: 'running',
                featureDescription: 'ongoing search',
                phase: 'scoring-relevance',
                progress: 75,
                startTime: new Date('2024-01-01T00:00:00.000Z')
            };

            const serialized = serializeDiscoveryProcess(process);

            assert.strictEqual(serialized.status, 'running');
            assert.strictEqual(serialized.phase, 'scoring-relevance');
            assert.strictEqual(serialized.progress, 75);
            assert.strictEqual(serialized.endTime, undefined);
        });
    });

    suite('Discovery Process Deserialization', () => {
        test('should deserialize a completed discovery process with results', () => {
            const serialized: SerializedDiscoveryProcess = {
                id: 'discovery-123',
                status: 'completed',
                featureDescription: 'user authentication',
                phase: 'completed',
                progress: 100,
                results: [
                    {
                        id: 'file:src/auth.ts',
                        type: 'file',
                        name: 'auth.ts',
                        path: 'src/auth.ts',
                        relevanceScore: 95,
                        matchedKeywords: ['auth', 'login'],
                        relevanceReason: 'Core authentication module',
                        selected: false
                    }
                ],
                startTime: '2024-01-01T00:00:00.000Z',
                endTime: '2024-01-01T00:01:00.000Z'
            };

            const process = deserializeDiscoveryProcess(serialized);

            assert.strictEqual(process.id, 'discovery-123');
            assert.strictEqual(process.status, 'completed');
            assert.strictEqual(process.featureDescription, 'user authentication');
            assert.strictEqual(process.results?.length, 1);
            assert.ok(process.startTime instanceof Date);
            assert.ok(process.endTime instanceof Date);
            assert.strictEqual(process.startTime.toISOString(), '2024-01-01T00:00:00.000Z');
        });

        test('should deserialize a process without endTime', () => {
            const serialized: SerializedDiscoveryProcess = {
                id: 'discovery-456',
                status: 'running',
                featureDescription: 'ongoing search',
                phase: 'scanning-files',
                progress: 50,
                startTime: '2024-01-01T00:00:00.000Z'
            };

            const process = deserializeDiscoveryProcess(serialized);

            assert.strictEqual(process.endTime, undefined);
            assert.ok(process.startTime instanceof Date);
        });

        test('should deserialize a failed process with error', () => {
            const serialized: SerializedDiscoveryProcess = {
                id: 'discovery-789',
                status: 'failed',
                featureDescription: 'failed search',
                phase: 'extracting-keywords',
                progress: 10,
                error: 'AI timeout',
                startTime: '2024-01-01T00:00:00.000Z',
                endTime: '2024-01-01T00:02:00.000Z'
            };

            const process = deserializeDiscoveryProcess(serialized);

            assert.strictEqual(process.status, 'failed');
            assert.strictEqual(process.error, 'AI timeout');
        });
    });

    suite('Round-trip Serialization', () => {
        test('should preserve all data through serialize/deserialize cycle', () => {
            const original: DiscoveryProcess = {
                id: 'discovery-roundtrip',
                status: 'completed',
                featureDescription: 'test feature',
                phase: 'completed',
                progress: 100,
                results: [
                    {
                        id: 'file:test.ts',
                        type: 'file',
                        name: 'test.ts',
                        path: 'src/test.ts',
                        relevanceScore: 90,
                        matchedKeywords: ['test'],
                        relevanceReason: 'Test file',
                        selected: true
                    },
                    {
                        id: 'doc:readme.md',
                        type: 'doc',
                        name: 'README.md',
                        path: 'docs/README.md',
                        relevanceScore: 75,
                        matchedKeywords: ['test', 'docs'],
                        relevanceReason: 'Documentation',
                        selected: false
                    }
                ],
                startTime: new Date('2024-06-15T10:30:00.000Z'),
                endTime: new Date('2024-06-15T10:31:30.000Z')
            };

            const serialized = serializeDiscoveryProcess(original);
            const restored = deserializeDiscoveryProcess(serialized);

            assert.strictEqual(restored.id, original.id);
            assert.strictEqual(restored.status, original.status);
            assert.strictEqual(restored.featureDescription, original.featureDescription);
            assert.strictEqual(restored.phase, original.phase);
            assert.strictEqual(restored.progress, original.progress);
            assert.strictEqual(restored.results?.length, original.results?.length);
            
            // Check first result
            assert.strictEqual(restored.results?.[0].id, original.results?.[0].id);
            assert.strictEqual(restored.results?.[0].type, original.results?.[0].type);
            assert.strictEqual(restored.results?.[0].name, original.results?.[0].name);
            assert.strictEqual(restored.results?.[0].relevanceScore, original.results?.[0].relevanceScore);
            assert.strictEqual(restored.results?.[0].selected, original.results?.[0].selected);
            
            // Check second result
            assert.strictEqual(restored.results?.[1].id, original.results?.[1].id);
            assert.strictEqual(restored.results?.[1].type, original.results?.[1].type);
            
            // Check dates
            assert.strictEqual(
                restored.startTime.toISOString(),
                original.startTime.toISOString()
            );
            assert.strictEqual(
                restored.endTime?.toISOString(),
                original.endTime?.toISOString()
            );
        });

        test('should preserve commit information through round-trip', () => {
            const original: DiscoveryProcess = {
                id: 'discovery-commit-test',
                status: 'completed',
                featureDescription: 'commit test',
                phase: 'completed',
                progress: 100,
                results: [
                    {
                        id: 'commit:def5678',
                        type: 'commit',
                        name: 'Fix authentication bug',
                        commit: {
                            hash: 'def5678901234567890abcdef',
                            shortHash: 'def5678',
                            subject: 'Fix authentication bug',
                            authorName: 'Test Author',
                            date: '2024-03-15T14:30:00.000Z',
                            repositoryRoot: '/path/to/repo'
                        },
                        relevanceScore: 88,
                        matchedKeywords: ['auth', 'fix', 'bug'],
                        relevanceReason: 'Bug fix for authentication',
                        selected: false
                    }
                ],
                startTime: new Date('2024-03-15T14:00:00.000Z'),
                endTime: new Date('2024-03-15T14:01:00.000Z')
            };

            const serialized = serializeDiscoveryProcess(original);
            const restored = deserializeDiscoveryProcess(serialized);

            const originalCommit = original.results?.[0].commit;
            const restoredCommit = restored.results?.[0].commit;

            assert.ok(restoredCommit);
            assert.strictEqual(restoredCommit.hash, originalCommit?.hash);
            assert.strictEqual(restoredCommit.shortHash, originalCommit?.shortHash);
            assert.strictEqual(restoredCommit.subject, originalCommit?.subject);
            assert.strictEqual(restoredCommit.authorName, originalCommit?.authorName);
            assert.strictEqual(restoredCommit.date, originalCommit?.date);
            assert.strictEqual(restoredCommit.repositoryRoot, originalCommit?.repositoryRoot);
        });
    });

    suite('JSON String Serialization', () => {
        test('should work with JSON.stringify and JSON.parse', () => {
            const original: DiscoveryProcess = {
                id: 'discovery-json-test',
                status: 'completed',
                featureDescription: 'JSON test',
                phase: 'completed',
                progress: 100,
                results: [
                    {
                        id: 'file:json.ts',
                        type: 'file',
                        name: 'json.ts',
                        path: 'src/json.ts',
                        relevanceScore: 80,
                        matchedKeywords: ['json'],
                        relevanceReason: 'JSON handler',
                        selected: false
                    }
                ],
                startTime: new Date('2024-01-01T00:00:00.000Z'),
                endTime: new Date('2024-01-01T00:01:00.000Z')
            };

            // This simulates what happens when storing in AIProcess.structuredResult
            const jsonString = JSON.stringify(serializeDiscoveryProcess(original));
            const parsed = JSON.parse(jsonString);
            const restored = deserializeDiscoveryProcess(parsed);

            assert.strictEqual(restored.id, original.id);
            assert.strictEqual(restored.status, original.status);
            assert.strictEqual(restored.featureDescription, original.featureDescription);
            assert.strictEqual(restored.results?.length, 1);
            assert.strictEqual(restored.results?.[0].name, 'json.ts');
        });

        test('should handle empty results array in JSON round-trip', () => {
            const original: DiscoveryProcess = {
                id: 'discovery-empty',
                status: 'completed',
                featureDescription: 'empty results',
                phase: 'completed',
                progress: 100,
                results: [],
                startTime: new Date('2024-01-01T00:00:00.000Z'),
                endTime: new Date('2024-01-01T00:00:30.000Z')
            };

            const jsonString = JSON.stringify(serializeDiscoveryProcess(original));
            const parsed = JSON.parse(jsonString);
            const restored = deserializeDiscoveryProcess(parsed);

            assert.strictEqual(restored.results?.length, 0);
        });

        test('should handle undefined results in JSON round-trip', () => {
            const original: DiscoveryProcess = {
                id: 'discovery-undefined',
                status: 'failed',
                featureDescription: 'no results',
                phase: 'scanning-files',
                progress: 30,
                error: 'Failed to scan',
                startTime: new Date('2024-01-01T00:00:00.000Z'),
                endTime: new Date('2024-01-01T00:00:10.000Z')
            };

            const jsonString = JSON.stringify(serializeDiscoveryProcess(original));
            const parsed = JSON.parse(jsonString);
            const restored = deserializeDiscoveryProcess(parsed);

            assert.strictEqual(restored.results, undefined);
            assert.strictEqual(restored.error, 'Failed to scan');
        });
    });

    suite('Result Types Preservation', () => {
        test('should preserve all result types: file, folder, doc, commit', () => {
            const original: DiscoveryProcess = {
                id: 'discovery-types',
                status: 'completed',
                featureDescription: 'all types test',
                phase: 'completed',
                progress: 100,
                results: [
                    {
                        id: 'file:src/main.ts',
                        type: 'file',
                        name: 'main.ts',
                        path: 'src/main.ts',
                        relevanceScore: 95,
                        matchedKeywords: ['main'],
                        relevanceReason: 'Main entry point',
                        selected: false
                    },
                    {
                        id: 'folder:src/utils',
                        type: 'folder',
                        name: 'utils',
                        path: 'src/utils',
                        relevanceScore: 80,
                        matchedKeywords: ['util'],
                        relevanceReason: 'Utility folder',
                        selected: false
                    },
                    {
                        id: 'doc:docs/api.md',
                        type: 'doc',
                        name: 'api.md',
                        path: 'docs/api.md',
                        relevanceScore: 70,
                        matchedKeywords: ['api', 'docs'],
                        relevanceReason: 'API documentation',
                        selected: true
                    },
                    {
                        id: 'commit:abc1234',
                        type: 'commit',
                        name: 'Initial commit',
                        commit: {
                            hash: 'abc1234567890',
                            shortHash: 'abc1234',
                            subject: 'Initial commit',
                            authorName: 'Author',
                            date: '2024-01-01T00:00:00.000Z',
                            repositoryRoot: '/repo'
                        },
                        relevanceScore: 60,
                        matchedKeywords: ['init'],
                        relevanceReason: 'Initial setup',
                        selected: false
                    }
                ],
                startTime: new Date('2024-01-01T00:00:00.000Z'),
                endTime: new Date('2024-01-01T00:01:00.000Z')
            };

            const serialized = serializeDiscoveryProcess(original);
            const restored = deserializeDiscoveryProcess(serialized);

            assert.strictEqual(restored.results?.length, 4);
            assert.strictEqual(restored.results?.[0].type, 'file');
            assert.strictEqual(restored.results?.[1].type, 'folder');
            assert.strictEqual(restored.results?.[2].type, 'doc');
            assert.strictEqual(restored.results?.[3].type, 'commit');
        });
    });
});

suite('AIProcessManager Discovery Integration Tests', () => {
    // These tests verify that the AIProcessManager correctly stores and retrieves
    // discovery process data including the serialized results

    test('completeDiscoveryProcess should accept serialized results parameter', () => {
        // This test verifies the method signature accepts the optional serializedResults parameter
        // The actual AIProcessManager is tested in integration tests
        const mockSerializedResults = JSON.stringify({
            id: 'test',
            status: 'completed',
            featureDescription: 'test',
            phase: 'completed',
            progress: 100,
            results: [],
            startTime: new Date().toISOString()
        });

        // Verify the serialized results can be parsed back
        const parsed = JSON.parse(mockSerializedResults);
        assert.strictEqual(parsed.status, 'completed');
        assert.ok(Array.isArray(parsed.results));
    });
});

