/**
 * Tests for InteractiveSessionManager
 *
 * Tests for managing interactive AI CLI sessions running in external terminals.
 */

import * as assert from 'assert';
import { ChildProcess } from 'child_process';
import {
    InteractiveSessionManager,
    StartSessionOptions
} from '../../shortcuts/ai-service/interactive-session-manager';
import {
    ExternalTerminalLauncher
} from '../../shortcuts/ai-service/external-terminal-launcher';
import {
    InteractiveSession,
    InteractiveSessionEvent,
    InteractiveSessionStatus,
    ExternalTerminalLaunchResult
} from '../../shortcuts/ai-service/types';

// ============================================================================
// Mock Factories
// ============================================================================

/**
 * Create a mock ExternalTerminalLauncher
 */
function createMockLauncher(launchResult: ExternalTerminalLaunchResult): ExternalTerminalLauncher {
    const mockExecSync = (() => Buffer.from('')) as unknown as typeof import('child_process').execSync;
    const mockSpawn = (() => ({
        pid: launchResult.pid,
        unref: () => { }
    })) as unknown as typeof import('child_process').spawn;

    // Create a launcher that we can mock
    const launcher = new ExternalTerminalLauncher('darwin', mockExecSync, mockSpawn);

    // Override the launch method
    (launcher as any).launch = async () => launchResult;

    return launcher;
}

/**
 * Create a mock launcher that succeeds
 */
function createSuccessfulLauncher(): ExternalTerminalLauncher {
    return createMockLauncher({
        success: true,
        terminalType: 'terminal.app',
        pid: 12345
    });
}

/**
 * Create a mock launcher that fails
 */
function createFailingLauncher(error: string): ExternalTerminalLauncher {
    return createMockLauncher({
        success: false,
        terminalType: 'unknown',
        error
    });
}

// ============================================================================
// Session Lifecycle Tests
// ============================================================================

suite('InteractiveSessionManager - Session Lifecycle', () => {
    test('should start a session successfully', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const sessionId = await manager.startSession({
            workingDirectory: '/test/project',
            tool: 'copilot'
        });

        assert.ok(sessionId, 'Should return a session ID');

        const session = manager.getSession(sessionId);
        assert.ok(session, 'Session should exist');
        assert.strictEqual(session.status, 'active');
        assert.strictEqual(session.workingDirectory, '/test/project');
        assert.strictEqual(session.tool, 'copilot');
        assert.strictEqual(session.terminalType, 'terminal.app');
        assert.strictEqual(session.pid, 12345);

        manager.dispose();
    });

    test('should return undefined when launch fails', async () => {
        const launcher = createFailingLauncher('No terminal found');
        const manager = new InteractiveSessionManager(launcher);

        const sessionId = await manager.startSession({
            workingDirectory: '/test/project',
            tool: 'copilot'
        });

        assert.strictEqual(sessionId, undefined, 'Should return undefined on failure');

        // The session should still be tracked but with error status
        const sessions = manager.getSessions();
        assert.strictEqual(sessions.length, 1);
        assert.strictEqual(sessions[0].status, 'error');
        assert.strictEqual(sessions[0].error, 'No terminal found');

        manager.dispose();
    });

    test('should end a session', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const sessionId = await manager.startSession({
            workingDirectory: '/test',
            tool: 'copilot'
        });

        assert.ok(sessionId);

        const result = manager.endSession(sessionId);
        assert.strictEqual(result, true);

        const session = manager.getSession(sessionId);
        assert.strictEqual(session?.status, 'ended');
        assert.ok(session?.endTime, 'Should have end time');

        manager.dispose();
    });

    test('should return false when ending non-existent session', () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const result = manager.endSession('non-existent-id');
        assert.strictEqual(result, false);

        manager.dispose();
    });

    test('should return false when ending already ended session', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const sessionId = await manager.startSession({
            workingDirectory: '/test',
            tool: 'copilot'
        });

        assert.ok(sessionId);

        manager.endSession(sessionId);
        const result = manager.endSession(sessionId);

        assert.strictEqual(result, false);

        manager.dispose();
    });

    test('should generate unique session IDs', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const id1 = await manager.startSession({
            workingDirectory: '/test1',
            tool: 'copilot'
        });

        const id2 = await manager.startSession({
            workingDirectory: '/test2',
            tool: 'copilot'
        });

        assert.ok(id1);
        assert.ok(id2);
        assert.notStrictEqual(id1, id2);

        manager.dispose();
    });
});

// ============================================================================
// Session Options Tests
// ============================================================================

suite('InteractiveSessionManager - Session Options', () => {
    test('should use default tool when not specified', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const sessionId = await manager.startSession({
            workingDirectory: '/test'
        });

        assert.ok(sessionId);

        const session = manager.getSession(sessionId);
        assert.strictEqual(session?.tool, 'copilot');

        manager.dispose();
    });

    test('should use specified tool', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const sessionId = await manager.startSession({
            workingDirectory: '/test',
            tool: 'claude'
        });

        assert.ok(sessionId);

        const session = manager.getSession(sessionId);
        assert.strictEqual(session?.tool, 'claude');

        manager.dispose();
    });

    test('should store initial prompt', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const sessionId = await manager.startSession({
            workingDirectory: '/test',
            tool: 'copilot',
            initialPrompt: 'Explain this code'
        });

        assert.ok(sessionId);

        const session = manager.getSession(sessionId);
        assert.strictEqual(session?.initialPrompt, 'Explain this code');

        manager.dispose();
    });

    test('should handle undefined initial prompt', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const sessionId = await manager.startSession({
            workingDirectory: '/test',
            tool: 'copilot'
        });

        assert.ok(sessionId);

        const session = manager.getSession(sessionId);
        assert.strictEqual(session?.initialPrompt, undefined);

        manager.dispose();
    });
});

// ============================================================================
// Session Retrieval Tests
// ============================================================================

suite('InteractiveSessionManager - Session Retrieval', () => {
    test('should get all sessions', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        await manager.startSession({ workingDirectory: '/test1', tool: 'copilot' });
        await manager.startSession({ workingDirectory: '/test2', tool: 'claude' });

        const sessions = manager.getSessions();
        assert.strictEqual(sessions.length, 2);

        manager.dispose();
    });

    test('should get active sessions only', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const id1 = await manager.startSession({ workingDirectory: '/test1', tool: 'copilot' });
        await manager.startSession({ workingDirectory: '/test2', tool: 'copilot' });

        assert.ok(id1);
        manager.endSession(id1);

        const activeSessions = manager.getActiveSessions();
        assert.strictEqual(activeSessions.length, 1);
        assert.strictEqual(activeSessions[0].workingDirectory, '/test2');

        manager.dispose();
    });

    test('should get ended sessions only', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const id1 = await manager.startSession({ workingDirectory: '/test1', tool: 'copilot' });
        await manager.startSession({ workingDirectory: '/test2', tool: 'copilot' });

        assert.ok(id1);
        manager.endSession(id1);

        const endedSessions = manager.getEndedSessions();
        assert.strictEqual(endedSessions.length, 1);
        assert.strictEqual(endedSessions[0].workingDirectory, '/test1');

        manager.dispose();
    });

    test('should include error sessions in ended sessions', async () => {
        const failingLauncher = createFailingLauncher('Launch failed');
        const manager = new InteractiveSessionManager(failingLauncher);

        await manager.startSession({ workingDirectory: '/test', tool: 'copilot' });

        const endedSessions = manager.getEndedSessions();
        assert.strictEqual(endedSessions.length, 1);
        assert.strictEqual(endedSessions[0].status, 'error');

        manager.dispose();
    });

    test('should get session by ID', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const sessionId = await manager.startSession({
            workingDirectory: '/test',
            tool: 'copilot'
        });

        assert.ok(sessionId);

        const session = manager.getSession(sessionId);
        assert.ok(session);
        assert.strictEqual(session.id, sessionId);

        manager.dispose();
    });

    test('should return undefined for non-existent session ID', () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const session = manager.getSession('non-existent');
        assert.strictEqual(session, undefined);

        manager.dispose();
    });
});

// ============================================================================
// Session Status Tests
// ============================================================================

suite('InteractiveSessionManager - Session Status', () => {
    test('should check if has active sessions', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        assert.strictEqual(manager.hasActiveSessions(), false);

        await manager.startSession({ workingDirectory: '/test', tool: 'copilot' });

        assert.strictEqual(manager.hasActiveSessions(), true);

        manager.dispose();
    });

    test('should get session counts', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const id1 = await manager.startSession({ workingDirectory: '/test1', tool: 'copilot' });
        await manager.startSession({ workingDirectory: '/test2', tool: 'copilot' });

        assert.ok(id1);
        manager.endSession(id1);

        const counts = manager.getSessionCounts();
        assert.strictEqual(counts.active, 1);
        assert.strictEqual(counts.ended, 1);
        assert.strictEqual(counts.starting, 0);
        assert.strictEqual(counts.error, 0);

        manager.dispose();
    });

    test('should track error sessions in counts', async () => {
        const failingLauncher = createFailingLauncher('Failed');
        const manager = new InteractiveSessionManager(failingLauncher);

        await manager.startSession({ workingDirectory: '/test', tool: 'copilot' });

        const counts = manager.getSessionCounts();
        assert.strictEqual(counts.error, 1);

        manager.dispose();
    });

    test('should update session status', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const sessionId = await manager.startSession({
            workingDirectory: '/test',
            tool: 'copilot'
        });

        assert.ok(sessionId);

        const result = manager.updateSessionStatus(sessionId, 'ended');
        assert.strictEqual(result, true);

        const session = manager.getSession(sessionId);
        assert.strictEqual(session?.status, 'ended');

        manager.dispose();
    });

    test('should update session status with error', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const sessionId = await manager.startSession({
            workingDirectory: '/test',
            tool: 'copilot'
        });

        assert.ok(sessionId);

        manager.updateSessionStatus(sessionId, 'error', 'Terminal crashed');

        const session = manager.getSession(sessionId);
        assert.strictEqual(session?.status, 'error');
        assert.strictEqual(session?.error, 'Terminal crashed');
        assert.ok(session?.endTime);

        manager.dispose();
    });

    test('should return false when updating non-existent session', () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const result = manager.updateSessionStatus('non-existent', 'ended');
        assert.strictEqual(result, false);

        manager.dispose();
    });
});

// ============================================================================
// Session Removal Tests
// ============================================================================

suite('InteractiveSessionManager - Session Removal', () => {
    test('should remove a session', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const sessionId = await manager.startSession({
            workingDirectory: '/test',
            tool: 'copilot'
        });

        assert.ok(sessionId);

        const result = manager.removeSession(sessionId);
        assert.strictEqual(result, true);

        const session = manager.getSession(sessionId);
        assert.strictEqual(session, undefined);

        manager.dispose();
    });

    test('should return false when removing non-existent session', () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const result = manager.removeSession('non-existent');
        assert.strictEqual(result, false);

        manager.dispose();
    });

    test('should mark active session as ended when removing', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const events: InteractiveSessionEvent[] = [];
        manager.onDidChangeSessions(e => events.push(e));

        const sessionId = await manager.startSession({
            workingDirectory: '/test',
            tool: 'copilot'
        });

        assert.ok(sessionId);

        manager.removeSession(sessionId);

        // Should have fired session-ended event
        const endedEvent = events.find(e => e.type === 'session-ended');
        assert.ok(endedEvent);

        manager.dispose();
    });

    test('should clear ended sessions', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const id1 = await manager.startSession({ workingDirectory: '/test1', tool: 'copilot' });
        await manager.startSession({ workingDirectory: '/test2', tool: 'copilot' });

        assert.ok(id1);
        manager.endSession(id1);

        manager.clearEndedSessions();

        const sessions = manager.getSessions();
        assert.strictEqual(sessions.length, 1);
        assert.strictEqual(sessions[0].status, 'active');

        manager.dispose();
    });

    test('should clear all sessions', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        await manager.startSession({ workingDirectory: '/test1', tool: 'copilot' });
        await manager.startSession({ workingDirectory: '/test2', tool: 'copilot' });

        manager.clearAllSessions();

        const sessions = manager.getSessions();
        assert.strictEqual(sessions.length, 0);

        manager.dispose();
    });

    test('should end active sessions before clearing all', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const events: InteractiveSessionEvent[] = [];
        manager.onDidChangeSessions(e => events.push(e));

        await manager.startSession({ workingDirectory: '/test1', tool: 'copilot' });
        await manager.startSession({ workingDirectory: '/test2', tool: 'copilot' });

        manager.clearAllSessions();

        // Should have fired session-ended events for both active sessions
        const endedEvents = events.filter(e => e.type === 'session-ended');
        assert.strictEqual(endedEvents.length, 2);

        manager.dispose();
    });
});

// ============================================================================
// Event Tests
// ============================================================================

suite('InteractiveSessionManager - Events', () => {
    test('should fire session-started event', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const events: InteractiveSessionEvent[] = [];
        manager.onDidChangeSessions(e => events.push(e));

        await manager.startSession({
            workingDirectory: '/test',
            tool: 'copilot'
        });

        const startedEvent = events.find(e => e.type === 'session-started');
        assert.ok(startedEvent);
        // Session is immediately active after successful launch
        assert.strictEqual(startedEvent.session.status, 'active');

        manager.dispose();
    });

    test('should fire session-updated event when session becomes active', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const events: InteractiveSessionEvent[] = [];
        manager.onDidChangeSessions(e => events.push(e));

        await manager.startSession({
            workingDirectory: '/test',
            tool: 'copilot'
        });

        const updatedEvent = events.find(e => e.type === 'session-updated');
        assert.ok(updatedEvent);
        assert.strictEqual(updatedEvent.session.status, 'active');

        manager.dispose();
    });

    test('should fire session-ended event', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const events: InteractiveSessionEvent[] = [];
        manager.onDidChangeSessions(e => events.push(e));

        const sessionId = await manager.startSession({
            workingDirectory: '/test',
            tool: 'copilot'
        });

        assert.ok(sessionId);
        manager.endSession(sessionId);

        const endedEvent = events.find(e => e.type === 'session-ended');
        assert.ok(endedEvent);
        assert.strictEqual(endedEvent.session.status, 'ended');

        manager.dispose();
    });

    test('should fire session-error event on launch failure', async () => {
        const launcher = createFailingLauncher('Launch failed');
        const manager = new InteractiveSessionManager(launcher);

        const events: InteractiveSessionEvent[] = [];
        manager.onDidChangeSessions(e => events.push(e));

        await manager.startSession({
            workingDirectory: '/test',
            tool: 'copilot'
        });

        const errorEvent = events.find(e => e.type === 'session-error');
        assert.ok(errorEvent);
        assert.strictEqual(errorEvent.session.status, 'error');
        assert.strictEqual(errorEvent.session.error, 'Launch failed');

        manager.dispose();
    });

    test('should fire session-error event when updating status to error', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const events: InteractiveSessionEvent[] = [];
        manager.onDidChangeSessions(e => events.push(e));

        const sessionId = await manager.startSession({
            workingDirectory: '/test',
            tool: 'copilot'
        });

        assert.ok(sessionId);
        manager.updateSessionStatus(sessionId, 'error', 'Something went wrong');

        const errorEvent = events.find(e => e.type === 'session-error');
        assert.ok(errorEvent);
        assert.strictEqual(errorEvent.session.error, 'Something went wrong');

        manager.dispose();
    });

    test('should include complete session data in events', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const events: InteractiveSessionEvent[] = [];
        manager.onDidChangeSessions(e => events.push(e));

        await manager.startSession({
            workingDirectory: '/path/to/project',
            tool: 'claude',
            initialPrompt: 'Help me debug'
        });

        const updatedEvent = events.find(e => e.type === 'session-updated');
        assert.ok(updatedEvent);

        const session = updatedEvent.session;
        assert.strictEqual(session.workingDirectory, '/path/to/project');
        assert.strictEqual(session.tool, 'claude');
        assert.strictEqual(session.initialPrompt, 'Help me debug');
        assert.strictEqual(session.terminalType, 'terminal.app');
        assert.strictEqual(session.pid, 12345);
        assert.ok(session.startTime);

        manager.dispose();
    });
});

// ============================================================================
// Dispose Tests
// ============================================================================

suite('InteractiveSessionManager - Dispose', () => {
    test('should clear all sessions on dispose', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        await manager.startSession({ workingDirectory: '/test1', tool: 'copilot' });
        await manager.startSession({ workingDirectory: '/test2', tool: 'copilot' });

        manager.dispose();

        // After dispose, getSessions should return empty
        // (though in practice the manager shouldn't be used after dispose)
        const sessions = manager.getSessions();
        assert.strictEqual(sessions.length, 0);
    });

    test('should fire session-ended events on dispose', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const events: InteractiveSessionEvent[] = [];
        manager.onDidChangeSessions(e => events.push(e));

        await manager.startSession({ workingDirectory: '/test', tool: 'copilot' });

        // Clear events from session start
        events.length = 0;

        manager.dispose();

        const endedEvent = events.find(e => e.type === 'session-ended');
        assert.ok(endedEvent);
    });
});

// ============================================================================
// Edge Cases
// ============================================================================

suite('InteractiveSessionManager - Edge Cases', () => {
    test('should handle multiple rapid session starts', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const promises = [
            manager.startSession({ workingDirectory: '/test1', tool: 'copilot' }),
            manager.startSession({ workingDirectory: '/test2', tool: 'copilot' }),
            manager.startSession({ workingDirectory: '/test3', tool: 'copilot' })
        ];

        const ids = await Promise.all(promises);

        // All should have unique IDs
        const uniqueIds = new Set(ids.filter(Boolean));
        assert.strictEqual(uniqueIds.size, 3);

        const sessions = manager.getSessions();
        assert.strictEqual(sessions.length, 3);

        manager.dispose();
    });

    test('should handle session with very long working directory', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const longPath = '/very/long/path'.repeat(50);

        const sessionId = await manager.startSession({
            workingDirectory: longPath,
            tool: 'copilot'
        });

        assert.ok(sessionId);

        const session = manager.getSession(sessionId);
        assert.strictEqual(session?.workingDirectory, longPath);

        manager.dispose();
    });

    test('should handle session with very long initial prompt', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const longPrompt = 'Explain this code: '.repeat(100);

        const sessionId = await manager.startSession({
            workingDirectory: '/test',
            tool: 'copilot',
            initialPrompt: longPrompt
        });

        assert.ok(sessionId);

        const session = manager.getSession(sessionId);
        assert.strictEqual(session?.initialPrompt, longPrompt);

        manager.dispose();
    });

    test('should handle session with special characters in working directory', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const specialPath = '/path/with spaces/and-dashes/and_underscores/and.dots';

        const sessionId = await manager.startSession({
            workingDirectory: specialPath,
            tool: 'copilot'
        });

        assert.ok(sessionId);

        const session = manager.getSession(sessionId);
        assert.strictEqual(session?.workingDirectory, specialPath);

        manager.dispose();
    });

    test('should handle session with special characters in initial prompt', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const specialPrompt = 'What does "request->set" do? It\'s unclear!';

        const sessionId = await manager.startSession({
            workingDirectory: '/test',
            tool: 'copilot',
            initialPrompt: specialPrompt
        });

        assert.ok(sessionId);

        const session = manager.getSession(sessionId);
        assert.strictEqual(session?.initialPrompt, specialPrompt);

        manager.dispose();
    });

    test('should preserve session timestamps', async () => {
        const launcher = createSuccessfulLauncher();
        const manager = new InteractiveSessionManager(launcher);

        const beforeStart = new Date();

        const sessionId = await manager.startSession({
            workingDirectory: '/test',
            tool: 'copilot'
        });

        const afterStart = new Date();

        assert.ok(sessionId);

        const session = manager.getSession(sessionId);
        assert.ok(session?.startTime);
        assert.ok(session.startTime >= beforeStart);
        assert.ok(session.startTime <= afterStart);

        manager.endSession(sessionId);

        const afterEnd = new Date();

        const endedSession = manager.getSession(sessionId);
        assert.ok(endedSession?.endTime);
        assert.ok(endedSession.endTime >= afterStart);
        assert.ok(endedSession.endTime <= afterEnd);

        manager.dispose();
    });
});
