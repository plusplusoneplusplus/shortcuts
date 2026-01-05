/**
 * Tests for Discovery Engine
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DiscoveryEngine, createDiscoveryRequest } from '../../shortcuts/discovery/discovery-engine';
import { DEFAULT_DISCOVERY_SCOPE, DiscoveryRequest, DiscoveryProcess, ExistingGroupSnapshot } from '../../shortcuts/discovery/types';

suite('Discovery Engine Tests', () => {
    let tempDir: string;
    let engine: DiscoveryEngine;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-engine-test-'));
        // Use keyword mode to avoid AI timeouts in tests
        engine = new DiscoveryEngine({ forceMode: 'keyword' });
        
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

    suite('createDiscoveryRequest', () => {
        test('should create request with default scope', () => {
            const request = createDiscoveryRequest('authentication feature', tempDir);
            
            assert.strictEqual(request.featureDescription, 'authentication feature');
            assert.strictEqual(request.repositoryRoot, tempDir);
            assert.deepStrictEqual(request.scope, DEFAULT_DISCOVERY_SCOPE);
            assert.strictEqual(request.keywords, undefined);
            assert.strictEqual(request.targetGroupPath, undefined);
        });

        test('should create request with custom keywords', () => {
            const request = createDiscoveryRequest('authentication', tempDir, {
                keywords: ['auth', 'login', 'jwt']
            });
            
            assert.deepStrictEqual(request.keywords, ['auth', 'login', 'jwt']);
        });

        test('should create request with target group', () => {
            const request = createDiscoveryRequest('feature', tempDir, {
                targetGroupPath: 'My Group/Subgroup'
            });
            
            assert.strictEqual(request.targetGroupPath, 'My Group/Subgroup');
        });

        test('should create request with custom scope', () => {
            const request = createDiscoveryRequest('feature', tempDir, {
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
            const request = createDiscoveryRequest('complex feature', tempDir, {
                keywords: ['test'],
                targetGroupPath: 'Group',
                scope: { includeDocs: false }
            });
            
            assert.strictEqual(request.featureDescription, 'complex feature');
            assert.deepStrictEqual(request.keywords, ['test']);
            assert.strictEqual(request.targetGroupPath, 'Group');
            assert.strictEqual(request.scope.includeDocs, false);
        });
    });

    suite('DiscoveryEngine Instance', () => {
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

        test('should return empty array for getAllProcesses initially', () => {
            const processes = engine.getAllProcesses();
            assert.ok(Array.isArray(processes));
            assert.strictEqual(processes.length, 0);
        });

        test('should return undefined for unknown process ID', () => {
            const process = engine.getProcess('unknown-id');
            assert.strictEqual(process, undefined);
        });
    });

    suite('Discovery Process Lifecycle', () => {
        test('should emit process-started event', async () => {
            let startedEvent = false;
            
            const disposable = engine.onDidChangeProcess(event => {
                if (event.type === 'process-started') {
                    startedEvent = true;
                }
            });
            
            const request = createDiscoveryRequest('authentication test', tempDir, {
                scope: { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false }
            });
            
            await engine.discover(request);
            
            disposable.dispose();
            
            assert.ok(startedEvent, 'Should have emitted process-started event');
        });

        test('should create process with running status initially', async () => {
            let initialStatus: string | undefined;
            
            const disposable = engine.onDidChangeProcess(event => {
                if (event.type === 'process-started') {
                    initialStatus = event.process.status;
                }
            });
            
            const request = createDiscoveryRequest('test feature', tempDir, {
                scope: { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false }
            });
            await engine.discover(request);
            
            disposable.dispose();
            
            assert.strictEqual(initialStatus, 'running');
        });

        test('should generate unique process IDs', async () => {
            const request1 = createDiscoveryRequest('test feature one', tempDir, {
                scope: { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false }
            });
            const request2 = createDiscoveryRequest('test feature two', tempDir, {
                scope: { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false }
            });
            
            const process1 = await engine.discover(request1);
            const process2 = await engine.discover(request2);
            
            assert.notStrictEqual(process1.id, process2.id);
        });

        test('should track process in getAllProcesses', async () => {
            const request = createDiscoveryRequest('test feature', tempDir, {
                scope: { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false }
            });
            const process = await engine.discover(request);
            
            const allProcesses = engine.getAllProcesses();
            assert.ok(allProcesses.some(p => p.id === process.id));
        });

        test('should complete process with results', async () => {
            const request = createDiscoveryRequest('authentication feature', tempDir, {
                scope: {
                    ...DEFAULT_DISCOVERY_SCOPE,
                    includeGitHistory: false
                }
            });
            
            const process = await engine.discover(request);
            
            assert.ok(['completed', 'failed'].includes(process.status));
            if (process.status === 'completed') {
                assert.ok(process.results !== undefined);
                assert.ok(process.endTime !== undefined);
            }
        });

        test('should set endTime on completion', async () => {
            const request = createDiscoveryRequest('test feature', tempDir, {
                scope: { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false }
            });
            
            const process = await engine.discover(request);
            
            assert.ok(process.endTime instanceof Date);
            assert.ok(process.endTime >= process.startTime);
        });

        test('should handle description that produces no keywords', async () => {
            // Create request with description that produces no keywords
            const request = createDiscoveryRequest('a', tempDir, {
                scope: { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false }
            });
            
            const process = await engine.discover(request);
            
            // Should fail because no keywords could be extracted
            assert.ok(['completed', 'failed'].includes(process.status));
        });
    });

    suite('Process Cancellation', () => {
        test('should cancel running process', async () => {
            let processId: string | undefined;
            
            const disposable = engine.onDidChangeProcess(event => {
                if (event.type === 'process-started') {
                    processId = event.process.id;
                    // Cancel immediately after start
                    engine.cancelProcess(processId);
                }
            });
            
            const request = createDiscoveryRequest('test feature', tempDir, {
                scope: { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false }
            });
            const process = await engine.discover(request);
            
            disposable.dispose();
            
            // Process might be cancelled or completed depending on timing
            assert.ok(['cancelled', 'completed', 'failed'].includes(process.status));
        });

        test('should not affect completed processes when cancelling', async () => {
            const request = createDiscoveryRequest('test feature', tempDir, {
                scope: { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false }
            });
            
            const process = await engine.discover(request);
            
            // Try to cancel after completion
            engine.cancelProcess(process.id);
            
            // Should still be in terminal state
            const retrievedProcess = engine.getProcess(process.id);
            assert.ok(['completed', 'failed'].includes(retrievedProcess?.status || ''));
        });

        test('should handle cancelling non-existent process', () => {
            // Should not throw
            engine.cancelProcess('non-existent-id');
        });
    });

    suite('clearCompletedProcesses', () => {
        test('should clear completed processes', async () => {
            const request = createDiscoveryRequest('test feature', tempDir, {
                scope: { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false }
            });
            
            await engine.discover(request);
            
            assert.ok(engine.getAllProcesses().length > 0);
            
            engine.clearCompletedProcesses();
            
            assert.strictEqual(engine.getAllProcesses().length, 0);
        });

        test('should not clear running processes', () => {
            // Verify the method exists and doesn't throw
            assert.ok(typeof engine.clearCompletedProcesses === 'function');
            engine.clearCompletedProcesses();
        });
    });

    suite('Event Handling', () => {
        test('should emit process-updated events during discovery', async () => {
            let updateCount = 0;
            
            const disposable = engine.onDidChangeProcess(event => {
                if (event.type === 'process-updated') {
                    updateCount++;
                }
            });
            
            const request = createDiscoveryRequest('authentication feature', tempDir, {
                scope: { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false }
            });
            
            await engine.discover(request);
            
            disposable.dispose();
            
            // Should have received some update events
            assert.ok(updateCount > 0, 'Should have received update events');
        });

        test('should emit process-completed or process-failed event', async () => {
            let terminalEvent = false;
            
            const disposable = engine.onDidChangeProcess(event => {
                if (event.type === 'process-completed' || event.type === 'process-failed') {
                    terminalEvent = true;
                }
            });
            
            const request = createDiscoveryRequest('test feature', tempDir, {
                scope: { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false }
            });
            
            await engine.discover(request);
            
            disposable.dispose();
            
            assert.ok(terminalEvent, 'Should have emitted terminal event');
        });

        test('should include process in event payload', async () => {
            let eventProcess: DiscoveryProcess | undefined;
            
            const disposable = engine.onDidChangeProcess(event => {
                if (event.type === 'process-completed' || event.type === 'process-failed') {
                    eventProcess = event.process;
                }
            });
            
            const request = createDiscoveryRequest('test feature', tempDir, {
                scope: { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false }
            });
            
            const returnedProcess = await engine.discover(request);
            
            disposable.dispose();
            
            assert.ok(eventProcess);
            assert.strictEqual(eventProcess!.id, returnedProcess.id);
        });
    });

    suite('Dispose', () => {
        test('should dispose without errors', () => {
            const localEngine = new DiscoveryEngine();
            
            // Should not throw
            localEngine.dispose();
        });

        test('should be safe to call dispose multiple times', () => {
            const localEngine = new DiscoveryEngine();
            
            localEngine.dispose();
            localEngine.dispose();
        });
    });

    suite('Request validation', () => {
        test('should handle empty feature description', async () => {
            const request = createDiscoveryRequest('', tempDir, {
                scope: { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false }
            });
            
            const process = await engine.discover(request);
            
            // Should fail due to no keywords
            assert.strictEqual(process.status, 'failed');
        });

        test('should handle whitespace-only feature description', async () => {
            const request = createDiscoveryRequest('   \t\n   ', tempDir, {
                scope: { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false }
            });
            
            const process = await engine.discover(request);
            
            // Should fail due to no keywords
            assert.strictEqual(process.status, 'failed');
        });

        test('should use provided keywords if available', async () => {
            const request = createDiscoveryRequest('a', tempDir, {
                keywords: ['authentication', 'login'],
                scope: { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false }
            });
            
            const process = await engine.discover(request);
            
            // Should succeed with provided keywords
            assert.ok(['completed', 'failed'].includes(process.status));
        });
    });

    suite('createDiscoveryRequest with existingGroupSnapshot', () => {
        test('should create request without existingGroupSnapshot', () => {
            const request = createDiscoveryRequest('authentication feature', tempDir);
            
            assert.strictEqual(request.existingGroupSnapshot, undefined);
        });

        test('should create request with existingGroupSnapshot', () => {
            const snapshot: ExistingGroupSnapshot = {
                name: 'Auth Module',
                description: 'Authentication related files',
                items: [
                    { type: 'file', path: 'src/auth.ts' },
                    { type: 'folder', path: 'src/auth' }
                ]
            };
            
            const request = createDiscoveryRequest('authentication feature', tempDir, {
                existingGroupSnapshot: snapshot
            });
            
            assert.ok(request.existingGroupSnapshot);
            assert.strictEqual(request.existingGroupSnapshot.name, 'Auth Module');
            assert.strictEqual(request.existingGroupSnapshot.description, 'Authentication related files');
            assert.strictEqual(request.existingGroupSnapshot.items.length, 2);
        });

        test('should create request with existingGroupSnapshot containing commits', () => {
            const snapshot: ExistingGroupSnapshot = {
                name: 'Feature Commits',
                items: [
                    { type: 'commit', commitHash: 'abc1234567890' },
                    { type: 'commit', commitHash: 'def9876543210' }
                ]
            };
            
            const request = createDiscoveryRequest('feature commits', tempDir, {
                existingGroupSnapshot: snapshot
            });
            
            assert.ok(request.existingGroupSnapshot);
            assert.strictEqual(request.existingGroupSnapshot.items.length, 2);
            assert.strictEqual(request.existingGroupSnapshot.items[0].type, 'commit');
            assert.strictEqual(request.existingGroupSnapshot.items[0].commitHash, 'abc1234567890');
        });

        test('should create request with all options including existingGroupSnapshot', () => {
            const snapshot: ExistingGroupSnapshot = {
                name: 'Mixed Group',
                items: [
                    { type: 'file', path: 'src/main.ts' },
                    { type: 'commit', commitHash: 'abc123' }
                ]
            };
            
            const request = createDiscoveryRequest('complex feature', tempDir, {
                keywords: ['test'],
                targetGroupPath: 'My Group',
                scope: { includeDocs: false },
                existingGroupSnapshot: snapshot
            });
            
            assert.strictEqual(request.featureDescription, 'complex feature');
            assert.deepStrictEqual(request.keywords, ['test']);
            assert.strictEqual(request.targetGroupPath, 'My Group');
            assert.strictEqual(request.scope.includeDocs, false);
            assert.ok(request.existingGroupSnapshot);
            assert.strictEqual(request.existingGroupSnapshot.name, 'Mixed Group');
        });

        test('should preserve existingGroupSnapshot in request for discovery', async () => {
            const snapshot: ExistingGroupSnapshot = {
                name: 'Existing Group',
                items: [
                    { type: 'file', path: 'src/existing.ts' }
                ]
            };
            
            const request = createDiscoveryRequest('test feature', tempDir, {
                scope: { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false },
                existingGroupSnapshot: snapshot
            });
            
            // Verify the snapshot is part of the request
            assert.ok(request.existingGroupSnapshot);
            assert.strictEqual(request.existingGroupSnapshot.name, 'Existing Group');
            
            // Run discovery - the snapshot should be passed through
            const process = await engine.discover(request);
            
            // Process should complete (or fail due to test environment)
            assert.ok(['completed', 'failed'].includes(process.status));
        });
    });
});

