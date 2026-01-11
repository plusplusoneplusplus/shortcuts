/**
 * Tests for AI Process Manager integration with Diff Review Editor
 * Verifies that AI clarification requests from the diff view are tracked in the AI Processes section
 */

import * as assert from 'assert';
import { MockAIProcessManager } from '../../shortcuts/ai-service';

suite('Diff AI Process Integration Tests', () => {

    suite('AIProcessManager Registration', () => {

        test('should register process when AI clarification is invoked', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerProcess('Test prompt');

            assert.ok(processId.startsWith('process-'));
            assert.strictEqual(manager.getProcesses().length, 1);

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'running');

            manager.dispose();
        });

        test('should track multiple processes', () => {
            const manager = new MockAIProcessManager();

            const id1 = manager.registerProcess('Prompt 1');
            const id2 = manager.registerProcess('Prompt 2');
            const id3 = manager.registerProcess('Prompt 3');

            assert.strictEqual(manager.getProcesses().length, 3);
            assert.ok(manager.hasRunningProcesses());

            const counts = manager.getProcessCounts();
            assert.strictEqual(counts.running, 3);
            assert.strictEqual(counts.completed, 0);

            manager.dispose();
        });

        test('should update process status on completion', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerProcess('Test prompt');
            manager.completeProcess(processId, 'AI response text');

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'completed');
            assert.strictEqual(process.result, 'AI response text');

            manager.dispose();
        });

        test('should update process status on failure', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerProcess('Test prompt');
            manager.failProcess(processId, 'Connection timeout');

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'failed');
            assert.strictEqual(process.error, 'Connection timeout');

            manager.dispose();
        });

        test('should cancel running process', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerProcess('Test prompt');
            const cancelled = manager.cancelProcess(processId);

            assert.strictEqual(cancelled, true);

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'cancelled');

            manager.dispose();
        });

        test('should not cancel already completed process', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerProcess('Test prompt');
            manager.completeProcess(processId, 'Result');

            const cancelled = manager.cancelProcess(processId);

            assert.strictEqual(cancelled, false);

            const process = manager.getProcess(processId);
            assert.strictEqual(process?.status, 'completed');

            manager.dispose();
        });

        test('should create prompt preview for long prompts', () => {
            const manager = new MockAIProcessManager();

            const longPrompt = 'Please clarify this very long piece of code that spans multiple lines and contains complex logic that needs explanation';
            const processId = manager.registerProcess(longPrompt);

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.ok(process.promptPreview.length <= 50);
            assert.ok(process.promptPreview.endsWith('...'));
            assert.strictEqual(process.fullPrompt, longPrompt);

            manager.dispose();
        });

        test('should emit events on process changes', () => {
            const manager = new MockAIProcessManager();
            const events: string[] = [];

            manager.onDidChangeProcesses(event => {
                events.push(event.type);
            });

            const processId = manager.registerProcess('Test prompt');
            manager.completeProcess(processId);
            manager.removeProcess(processId);

            assert.ok(events.includes('process-added'));
            assert.ok(events.includes('process-updated'));
            assert.ok(events.includes('process-removed'));

            manager.dispose();
        });

        test('should clear completed processes', () => {
            const manager = new MockAIProcessManager();

            const id1 = manager.registerProcess('Prompt 1');
            const id2 = manager.registerProcess('Prompt 2');
            const id3 = manager.registerProcess('Prompt 3');

            manager.completeProcess(id1, 'Result 1');
            manager.failProcess(id2, 'Error');
            // id3 still running

            manager.clearCompletedProcesses();

            // Only running process should remain
            assert.strictEqual(manager.getProcesses().length, 1);
            assert.strictEqual(manager.getProcess(id3)?.status, 'running');
            assert.strictEqual(manager.getProcess(id1), undefined);
            assert.strictEqual(manager.getProcess(id2), undefined);

            manager.dispose();
        });

        test('should get running processes only', () => {
            const manager = new MockAIProcessManager();

            const id1 = manager.registerProcess('Prompt 1');
            const id2 = manager.registerProcess('Prompt 2');
            const id3 = manager.registerProcess('Prompt 3');

            manager.completeProcess(id1, 'Result');
            manager.failProcess(id2, 'Error');

            const running = manager.getRunningProcesses();

            assert.strictEqual(running.length, 1);
            assert.strictEqual(running[0].id, id3);

            manager.dispose();
        });

        test('should track process timing', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerProcess('Test prompt');

            const processBefore = manager.getProcess(processId);
            assert.ok(processBefore);
            assert.ok(processBefore.startTime instanceof Date);
            assert.strictEqual(processBefore.endTime, undefined);

            manager.completeProcess(processId, 'Result');

            const processAfter = manager.getProcess(processId);
            assert.ok(processAfter);
            assert.ok(processAfter.endTime instanceof Date);
            assert.ok(processAfter.endTime >= processAfter.startTime);

            manager.dispose();
        });
    });

    suite('Process Counts', () => {

        test('should return correct counts for mixed statuses', () => {
            const manager = new MockAIProcessManager();

            const id1 = manager.registerProcess('Prompt 1');
            const id2 = manager.registerProcess('Prompt 2');
            const id3 = manager.registerProcess('Prompt 3');
            const id4 = manager.registerProcess('Prompt 4');
            const id5 = manager.registerProcess('Prompt 5');

            manager.completeProcess(id1);
            manager.completeProcess(id2);
            manager.failProcess(id3, 'Error');
            manager.cancelProcess(id4);
            // id5 still running

            const counts = manager.getProcessCounts();

            assert.strictEqual(counts.completed, 2);
            assert.strictEqual(counts.failed, 1);
            assert.strictEqual(counts.cancelled, 1);
            assert.strictEqual(counts.running, 1);

            manager.dispose();
        });

        test('should return zero counts for empty manager', () => {
            const manager = new MockAIProcessManager();

            const counts = manager.getProcessCounts();

            assert.strictEqual(counts.completed, 0);
            assert.strictEqual(counts.failed, 0);
            assert.strictEqual(counts.cancelled, 0);
            assert.strictEqual(counts.running, 0);

            manager.dispose();
        });
    });

    suite('Integration with Diff Clarification Context', () => {

        interface DiffClarificationContext {
            selectedText: string;
            selectionRange: { startLine: number; endLine: number };
            side: 'old' | 'new' | 'both';
            filePath: string;
            surroundingContent: string;
            instructionType: 'clarify' | 'go-deeper' | 'custom';
            customInstruction?: string;
        }

        /**
         * Simulate building a prompt from diff context (simplified version)
         */
        function buildDiffPrompt(context: DiffClarificationContext): string {
            const instructionMap: Record<string, string> = {
                'clarify': 'Please clarify',
                'go-deeper': 'Please provide an in-depth explanation and analysis of',
                'custom': context.customInstruction || 'Please explain'
            };

            const instruction = instructionMap[context.instructionType];
            const sideInfo = context.side === 'old'
                ? ' (from old version)'
                : context.side === 'new'
                    ? ' (from new version)'
                    : '';

            return `${instruction} "${context.selectedText}"${sideInfo} in the file ${context.filePath}`;
        }

        test('should track diff clarification request', () => {
            const manager = new MockAIProcessManager();

            const context: DiffClarificationContext = {
                selectedText: 'async function fetchData()',
                selectionRange: { startLine: 10, endLine: 15 },
                side: 'new',
                filePath: 'src/api/client.ts',
                surroundingContent: '// API client',
                instructionType: 'clarify'
            };

            const prompt = buildDiffPrompt(context);
            const processId = manager.registerProcess(prompt);

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.ok(process.fullPrompt.includes('async function fetchData()'));
            assert.ok(process.fullPrompt.includes('(from new version)'));
            assert.ok(process.fullPrompt.includes('src/api/client.ts'));

            manager.dispose();
        });

        test('should track go-deeper request from old version', () => {
            const manager = new MockAIProcessManager();

            const context: DiffClarificationContext = {
                selectedText: 'deprecated API call',
                selectionRange: { startLine: 5, endLine: 5 },
                side: 'old',
                filePath: 'src/legacy/utils.ts',
                surroundingContent: '',
                instructionType: 'go-deeper'
            };

            const prompt = buildDiffPrompt(context);
            const processId = manager.registerProcess(prompt);

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.ok(process.fullPrompt.includes('in-depth explanation'));
            assert.ok(process.fullPrompt.includes('(from old version)'));

            manager.dispose();
        });

        test('should track custom instruction request', () => {
            const manager = new MockAIProcessManager();

            const context: DiffClarificationContext = {
                selectedText: 'user.isAdmin && !user.isBanned',
                selectionRange: { startLine: 20, endLine: 20 },
                side: 'new',
                filePath: 'src/auth/permissions.ts',
                surroundingContent: '',
                instructionType: 'custom',
                customInstruction: 'Explain the security implications of'
            };

            const prompt = buildDiffPrompt(context);
            const processId = manager.registerProcess(prompt);

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.ok(process.fullPrompt.includes('security implications'));
            assert.ok(process.fullPrompt.includes('user.isAdmin'));

            manager.dispose();
        });

        test('should complete process with AI response', () => {
            const manager = new MockAIProcessManager();

            const context: DiffClarificationContext = {
                selectedText: 'const result = await fetch(url)',
                selectionRange: { startLine: 1, endLine: 1 },
                side: 'new',
                filePath: 'test.ts',
                surroundingContent: '',
                instructionType: 'clarify'
            };

            const prompt = buildDiffPrompt(context);
            const processId = manager.registerProcess(prompt);

            // Simulate AI response
            const aiResponse = `This line makes an HTTP request using the Fetch API.

**Key aspects:**
- Uses async/await for asynchronous handling
- Returns a Promise that resolves to a Response object
- The URL is passed as a parameter`;

            manager.completeProcess(processId, aiResponse);

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'completed');
            assert.strictEqual(process.result, aiResponse);

            manager.dispose();
        });
    });

    suite('Disposal', () => {

        test('should cancel all running processes on dispose', () => {
            const manager = new MockAIProcessManager();

            manager.registerProcess('Prompt 1');
            manager.registerProcess('Prompt 2');
            manager.registerProcess('Prompt 3');

            assert.strictEqual(manager.getRunningProcesses().length, 3);

            manager.dispose();

            // After dispose, all processes should be cleared
            assert.strictEqual(manager.getProcesses().length, 0);
        });
    });
});
