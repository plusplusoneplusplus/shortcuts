import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    probeDeliveryWatchdogDatabase,
    type DeliveryWatchdogConfig,
    type WatchdogProbe,
} from '../../src/reliability/delivery-watchdog';
import {
    getDeliveryWatchdogStatus,
    requestDeliveryWatchdogStop,
    postDeliveryWatchdogRecovery,
    runDeliveryWatchdog,
    startDeliveryWatchdog,
    verifyDeliveryWatchdogServer,
    writeWatchdogJsonAtomic,
    WATCHDOG_CONFIG_FILENAME,
    WATCHDOG_LOCK_FILENAME,
    WATCHDOG_LOG_FILENAME,
    WATCHDOG_STATE_FILENAME,
    WATCHDOG_STOP_FILENAME,
} from '../../src/reliability/watchdog-runtime';
import { safeRmSync } from '../helpers/safe-rm';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        safeRmSync(dir);
    }
});

function fixture(): { root: string; config: DeliveryWatchdogConfig } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-watchdog-'));
    tempDirs.push(root);
    const worktree = path.join(root, 'worktree');
    const stateDir = path.join(root, 'state');
    const dataDir = path.join(root, 'data');
    fs.mkdirSync(worktree);
    fs.mkdirSync(stateDir);
    fs.mkdirSync(dataDir);
    const ledgerPath = path.join(root, 'DELIVERY.md');
    const promptFile = path.join(root, 'continue.txt');
    fs.writeFileSync(ledgerPath, '# Delivery\n');
    fs.writeFileSync(promptFile, 'Perform exactly one bounded action.');
    return {
        root,
        config: {
            workspaceId: 'ws-example',
            processId: 'queue_example',
            worktree,
            ledgerPath,
            promptFile,
            stateDir,
            dataDir,
            serverUrl: 'http://127.0.0.1:4000',
            mode: 'autopilot',
            completeMarker: 'DELIVERY_COMPLETE',
            blockedMarker: 'DELIVERY_BLOCKED',
            limits: {
                pollIntervalMs: 1,
                idlePolls: 3,
                cooldownMs: 100,
                ttlMs: 10_000,
                maxResumes: 2,
                heartbeatIntervalMs: 10,
            },
        },
    };
}

function healthyProbe(overrides: Partial<WatchdogProbe> = {}): WatchdogProbe {
    return {
        processStatus: 'completed',
        bindingMatches: true,
        targetInflight: 0,
        pendingWakeups: 0,
        splitBrain: false,
        duplicateWriterTaskIds: [],
        ...overrides,
    };
}

describe('delivery watchdog SQLite probe', () => {
    it('derives target activity and duplicate writers from a read-only fixture', () => {
        const { config } = fixture();
        const db = new Database(path.join(config.dataDir, 'processes.db'));
        db.exec(`
            CREATE TABLE processes (
                id TEXT PRIMARY KEY,
                workspace_id TEXT,
                status TEXT,
                end_time TEXT,
                error TEXT,
                working_directory TEXT,
                metadata TEXT
            );
            CREATE TABLE queue_tasks (
                id TEXT PRIMARY KEY,
                process_id TEXT,
                repo_id TEXT,
                status TEXT,
                folder_path TEXT,
                payload TEXT
            );
            CREATE TABLE wakeups (
                process_id TEXT,
                status TEXT,
                fires_at TEXT
            );
            CREATE TABLE queue_repo_paths (
                repo_id TEXT PRIMARY KEY,
                root_path TEXT NOT NULL
            );
        `);
        db.prepare('INSERT INTO processes VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            config.processId,
            config.workspaceId,
            'completed',
            new Date().toISOString(),
            null,
            config.worktree,
            JSON.stringify({ mode: 'autopilot' }),
        );
        db.prepare('INSERT INTO queue_tasks VALUES (?, ?, ?, ?, ?, ?)').run(
            'other-writer',
            'queue_other',
            'ws-alias',
            'running',
            null,
            JSON.stringify({ mode: 'autopilot', processId: 'queue_other' }),
        );
        db.prepare('INSERT INTO queue_repo_paths VALUES (?, ?)').run(
            'ws-alias',
            config.worktree,
        );
        db.close();
        const before = fs.readFileSync(path.join(config.dataDir, 'processes.db'));

        const probe = probeDeliveryWatchdogDatabase(config);

        expect(probe).toMatchObject({
            bindingMatches: true,
            targetInflight: 0,
            duplicateWriterTaskIds: ['other-writer'],
        });
        expect(fs.readFileSync(path.join(config.dataDir, 'processes.db'))).toEqual(before);
    });

    it('counts pending wakeups from replacement processes in the same Ralph session', () => {
        const { config } = fixture();
        config.mode = 'ralph';
        config.ralphSessionId = 'ralph-example';
        const db = new Database(path.join(config.dataDir, 'processes.db'));
        db.exec(`
            CREATE TABLE processes (
                id TEXT PRIMARY KEY,
                workspace_id TEXT,
                status TEXT,
                end_time TEXT,
                error TEXT,
                working_directory TEXT,
                metadata TEXT
            );
            CREATE TABLE queue_tasks (
                id TEXT PRIMARY KEY,
                process_id TEXT,
                repo_id TEXT,
                status TEXT,
                folder_path TEXT,
                payload TEXT
            );
            CREATE TABLE wakeups (
                process_id TEXT,
                status TEXT,
                fires_at TEXT
            );
            CREATE TABLE queue_repo_paths (
                repo_id TEXT PRIMARY KEY,
                root_path TEXT NOT NULL
            );
        `);
        const metadata = JSON.stringify({
            mode: 'ralph',
            ralph: { sessionId: config.ralphSessionId },
        });
        db.prepare('INSERT INTO processes VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            config.processId,
            config.workspaceId,
            'completed',
            new Date().toISOString(),
            null,
            config.worktree,
            metadata,
        );
        db.prepare('INSERT INTO processes VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            'queue_replacement',
            config.workspaceId,
            'completed',
            new Date().toISOString(),
            null,
            config.worktree,
            metadata,
        );
        db.prepare('INSERT INTO wakeups VALUES (?, ?, ?)').run(
            'queue_replacement',
            'pending',
            new Date(Date.now() - 60_000).toISOString(),
        );
        db.close();

        expect(probeDeliveryWatchdogDatabase(config)).toMatchObject({
            bindingMatches: true,
            pendingWakeups: 1,
        });
    });
});

describe('delivery watchdog detached lifecycle', () => {
    it('validates the target before writing deployment config and spawning', async () => {
        const { config } = fixture();
        const spawnDetached = vi.fn().mockReturnValue(4242);
        const verifyServer = vi.fn().mockResolvedValue(undefined);

        const result = await startDeliveryWatchdog(config, '/dist/watchdog-runner.js', {
            probe: () => healthyProbe(),
            verifyServer,
            spawnDetached,
            isProcessAlive: () => false,
        });

        expect(result).toEqual({
            pid: 4242,
            stateFile: path.join(config.stateDir, WATCHDOG_STATE_FILENAME),
        });
        expect(verifyServer).toHaveBeenCalledWith(config);
        expect(spawnDetached).toHaveBeenCalledWith(
            '/dist/watchdog-runner.js',
            path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME),
        );
        expect(fs.existsSync(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME))).toBe(true);
    });

    it('atomically rejects concurrent starts in the same state directory', async () => {
        const { config } = fixture();
        let nextPid = 5000;
        const spawnDetached = vi.fn(() => nextPid++);
        const deps = {
            probe: () => healthyProbe(),
            verifyServer: async () => undefined,
            spawnDetached,
            isProcessAlive: () => false,
        };

        const results = await Promise.allSettled([
            startDeliveryWatchdog(config, '/dist/watchdog-runner.js', deps),
            startDeliveryWatchdog(config, '/dist/watchdog-runner.js', deps),
        ]);

        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect(spawnDetached).toHaveBeenCalledOnce();
    });

    it('does not let stale process state remove another starter fresh claim', async () => {
        const { config } = fixture();
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_STATE_FILENAME), JSON.stringify({
            instanceId: 'stale-instance',
            pid: 4000,
            status: 'running',
            workspaceId: config.workspaceId,
            processId: config.processId,
            worktree: config.worktree,
            mode: config.mode,
            startedAtMs: 1,
            idleStreak: 0,
            resumeCount: 0,
            lastRecoveryAtMs: null,
            lastHeartbeatAtMs: 1,
            lastProbe: healthyProbe(),
            lastAction: 'stale',
        }));
        let nextPid = 6000;
        const spawnDetached = vi.fn(() => nextPid++);
        const deps = {
            probe: () => healthyProbe(),
            verifyServer: async () => undefined,
            spawnDetached,
            isProcessAlive: () => false,
        };

        const results = await Promise.allSettled([
            startDeliveryWatchdog(config, '/dist/watchdog-runner.js', deps),
            startDeliveryWatchdog(config, '/dist/watchdog-runner.js', deps),
        ]);

        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect(spawnDetached).toHaveBeenCalledOnce();
    });

    it('keeps a live startup claim through slow server verification', async () => {
        const { config } = fixture();
        let releaseVerification: (() => void) | undefined;
        const firstVerification = new Promise<void>(resolve => {
            releaseVerification = resolve;
        });
        let verificationCalls = 0;
        const deps = {
            now: () => verificationCalls === 0 ? 1_000 : 61_000,
            probe: () => healthyProbe(),
            verifyServer: async () => {
                verificationCalls++;
                if (verificationCalls === 1) {
                    await firstVerification;
                }
            },
            spawnDetached: () => 7000,
            isProcessAlive: () => false,
        };

        const first = startDeliveryWatchdog(config, '/dist/watchdog-runner.js', deps);
        await vi.waitFor(() => expect(verificationCalls).toBe(1));
        const second = startDeliveryWatchdog(config, '/dist/watchdog-runner.js', deps);

        await expect(second).rejects.toThrow('start is already in progress');
        releaseVerification!();
        await expect(first).resolves.toMatchObject({ pid: 7000 });
    });

    it('never reclaims an unreadable startup claim', async () => {
        const { config } = fixture();
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_LOCK_FILENAME), 'not a sqlite database');

        await expect(startDeliveryWatchdog(config, '/dist/watchdog-runner.js', {
            probe: () => healthyProbe(),
            verifyServer: async () => undefined,
            spawnDetached: () => 7001,
            isProcessAlive: () => false,
        })).rejects.toThrow('start claim is unreadable');
    });

    it('does not overwrite a child running acknowledgement with parent starting state', async () => {
        const { config } = fixture();

        await startDeliveryWatchdog(config, '/dist/watchdog-runner.js', {
            probe: () => healthyProbe(),
            verifyServer: async () => undefined,
            spawnDetached: (_runner, configFile) => {
                const deployment = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
                fs.writeFileSync(
                    path.join(config.stateDir, WATCHDOG_STATE_FILENAME),
                    JSON.stringify({
                        instanceId: deployment.instanceId,
                        pid: 8000,
                        status: 'running',
                        workspaceId: config.workspaceId,
                        processId: config.processId,
                        worktree: config.worktree,
                        mode: config.mode,
                        startedAtMs: 100,
                        idleStreak: 0,
                        resumeCount: 0,
                        lastRecoveryAtMs: null,
                        lastHeartbeatAtMs: 100,
                        lastProbe: healthyProbe(),
                        lastAction: 'startup',
                    }),
                );
                return 8000;
            },
            isProcessAlive: () => false,
        });

        expect(JSON.parse(fs.readFileSync(
            path.join(config.stateDir, WATCHDOG_STATE_FILENAME),
            'utf-8',
        ))).toMatchObject({
            pid: 8000,
            status: 'running',
        });
    });

    it('binds server verification to the configured process and store', async () => {
        const { config } = fixture();
        let verificationTarget: unknown;

        await startDeliveryWatchdog(config, '/dist/watchdog-runner.js', {
            probe: () => healthyProbe(),
            verifyServer: async target => {
                verificationTarget = target;
            },
            spawnDetached: () => 4242,
            isProcessAlive: () => false,
        });

        expect(verificationTarget).toMatchObject({
            workspaceId: config.workspaceId,
            processId: config.processId,
            worktree: config.worktree,
            mode: config.mode,
            dataDir: config.dataDir,
        });
    });

    it('verifies the real CoC health and process response contract', async () => {
        const { config } = fixture();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                process: {
                    id: config.processId,
                    workingDirectory: config.worktree,
                    metadata: {
                        workspaceId: config.workspaceId,
                        mode: config.mode,
                    },
                },
                children: [],
                total: 0,
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }));

        await expect(verifyDeliveryWatchdogServer(config, fetchMock)).resolves.toBeUndefined();
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            `${config.serverUrl}/api/health`,
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            `${config.serverUrl}/api/processes/queue_example?workspaceId=ws-example`,
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it('reports status and requests stop through an instance-bound file without signaling', () => {
        const { config } = fixture();
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_STATE_FILENAME), JSON.stringify({
            instanceId: 'instance-a',
            pid: 4242,
            status: 'running',
            workspaceId: config.workspaceId,
            processId: config.processId,
            worktree: config.worktree,
            mode: config.mode,
            startedAtMs: 100,
            idleStreak: 1,
            resumeCount: 1,
            lastRecoveryAtMs: null,
            lastHeartbeatAtMs: 200,
            lastProbe: healthyProbe(),
            lastAction: 'idle',
        }));

        expect(getDeliveryWatchdogStatus(config.stateDir, {
            isProcessAlive: pid => pid === 4242,
        })).toMatchObject({
            running: true,
            pid: 4242,
            resumeCount: 1,
        });
        expect(requestDeliveryWatchdogStop(config.stateDir)).toEqual({
            requested: true,
            pid: 4242,
        });
        expect(JSON.parse(fs.readFileSync(
            path.join(config.stateDir, WATCHDOG_STOP_FILENAME),
            'utf-8',
        ))).toMatchObject({ instanceId: 'instance-a' });
        expect(JSON.parse(fs.readFileSync(
            path.join(config.stateDir, WATCHDOG_STATE_FILENAME),
            'utf-8',
        ))).toMatchObject({ status: 'running' });
    });

    it('runs one recovery after an immediate recheck and exits on an exact marker', async () => {
        const { config } = fixture();
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), JSON.stringify({
            instanceId: 'instance-run',
            config,
        }));
        let now = 1_000;
        const postJson = vi.fn().mockImplementation(async () => {
            fs.appendFileSync(config.ledgerPath, '\nDELIVERY_COMPLETE\n');
            return '{"queued":true}';
        });
        const probe = vi.fn(() => healthyProbe());

        await runDeliveryWatchdog(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), {
            now: () => now++,
            sleep: async () => undefined,
            probe,
            postJson,
            verifyServer: async () => undefined,
        });

        expect(probe).toHaveBeenCalledTimes(5);
        expect(postJson).toHaveBeenCalledOnce();
        const state = JSON.parse(fs.readFileSync(
            path.join(config.stateDir, WATCHDOG_STATE_FILENAME),
            'utf-8',
        ));
        expect(state).toMatchObject({
            status: 'complete',
            resumeCount: 1,
            idleStreak: 0,
        });
    });

    it('logs only allow-listed recovery response fields', async () => {
        const { config } = fixture();
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), JSON.stringify({
            instanceId: 'instance-safe-log',
            config,
        }));

        await runDeliveryWatchdog(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), {
            now: (() => {
                let now = 1_500;
                return () => now++;
            })(),
            sleep: async () => undefined,
            probe: () => healthyProbe(),
            verifyServer: async () => undefined,
            postJson: async () => {
                fs.appendFileSync(config.ledgerPath, '\nDELIVERY_COMPLETE\n');
                return JSON.stringify({
                    task: {
                        id: 'task-safe',
                        payload: { prompt: 'PRIVATE RECOVERY PROMPT' },
                    },
                });
            },
        });

        const log = fs.readFileSync(path.join(config.stateDir, WATCHDOG_LOG_FILENAME), 'utf-8');
        expect(log).toContain('task-safe');
        expect(log).not.toContain('PRIVATE RECOVERY PROMPT');
        expect(log).not.toContain('"payload"');
    });

    it('persists recovery intent and cooldown before posting to the server', async () => {
        const { config } = fixture();
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), JSON.stringify({
            instanceId: 'instance-persist-before-post',
            config,
        }));
        let persistedDuringPost: Record<string, unknown> | undefined;

        await runDeliveryWatchdog(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), {
            now: (() => {
                let now = 3_000;
                return () => now++;
            })(),
            sleep: async () => undefined,
            probe: () => healthyProbe(),
            postJson: async () => {
                persistedDuringPost = JSON.parse(fs.readFileSync(
                    path.join(config.stateDir, WATCHDOG_STATE_FILENAME),
                    'utf-8',
                ));
                fs.appendFileSync(config.ledgerPath, '\nDELIVERY_COMPLETE\n');
                return '{"queued":true}';
            },
            verifyServer: async () => undefined,
        });

        expect(persistedDuringPost).toMatchObject({
            resumeCount: 1,
            idleStreak: 0,
            lastAction: 'recovery-intent-1',
        });
        expect(typeof persistedDuringPost?.lastRecoveryAtMs).toBe('number');
    });

    it('enforces TTL before a fallible steady-state database probe', async () => {
        const { config } = fixture();
        config.limits.ttlMs = 100;
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), JSON.stringify({
            instanceId: 'instance-probe-ttl',
            config,
        }));
        let currentTime = 4_000;
        let probeCount = 0;

        await runDeliveryWatchdog(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), {
            now: () => currentTime,
            sleep: async () => {
                currentTime += config.limits.ttlMs;
            },
            probe: () => {
                probeCount++;
                if (probeCount === 1) {
                    return healthyProbe();
                }
                fs.appendFileSync(config.ledgerPath, '\nDELIVERY_COMPLETE\n');
                throw new Error('database unavailable');
            },
            verifyServer: async () => undefined,
        });

        expect(probeCount).toBe(1);
        expect(JSON.parse(fs.readFileSync(
            path.join(config.stateDir, WATCHDOG_STATE_FILENAME),
            'utf-8',
        ))).toMatchObject({ status: 'ttl' });
    });

    it('does not enqueue when a terminal marker appears during the immediate recheck', async () => {
        const { config } = fixture();
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), JSON.stringify({
            instanceId: 'instance-terminal-race',
            config,
        }));
        let probeCount = 0;
        const postJson = vi.fn();

        await runDeliveryWatchdog(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), {
            now: (() => {
                let now = 2_000;
                return () => now++;
            })(),
            sleep: async () => undefined,
            probe: () => {
                probeCount++;
                if (probeCount === 5) {
                    fs.appendFileSync(config.ledgerPath, '\nDELIVERY_COMPLETE\n');
                }
                return healthyProbe();
            },
            postJson,
            verifyServer: async () => undefined,
        });

        expect(postJson).not.toHaveBeenCalled();
        expect(JSON.parse(fs.readFileSync(
            path.join(config.stateDir, WATCHDOG_STATE_FILENAME),
            'utf-8',
        ))).toMatchObject({
            status: 'complete',
            resumeCount: 0,
        });
    });

    it('performs final activity and terminal checks after endpoint verification', async () => {
        const { config } = fixture();
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), JSON.stringify({
            instanceId: 'instance-final-order',
            config,
        }));
        let verificationComplete = false;
        let verifications = 0;
        const postJson = vi.fn();

        await runDeliveryWatchdog(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), {
            now: (() => {
                let now = 5_000;
                return () => now++;
            })(),
            sleep: async () => undefined,
            probe: () => {
                if (verificationComplete) {
                    fs.writeFileSync(path.join(config.stateDir, WATCHDOG_STOP_FILENAME), JSON.stringify({
                        instanceId: 'instance-final-order',
                    }));
                    return healthyProbe({ targetInflight: 1 });
                }
                return healthyProbe();
            },
            verifyServer: async () => {
                verifications++;
                verificationComplete = true;
            },
            postJson,
        });

        expect(verifications).toBeGreaterThan(0);
        expect(postJson).not.toHaveBeenCalled();
    });

    it('preserves ceilings when the same worktree is configured through an alias', async () => {
        const { root, config } = fixture();
        const worktreeAlias = path.join(root, 'worktree-alias');
        createDirectoryAlias(config.worktree, worktreeAlias);
        const instanceId = 'instance-alias';
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), JSON.stringify({
            instanceId,
            config: { ...config, worktree: worktreeAlias },
        }));
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_STATE_FILENAME), JSON.stringify({
            instanceId: 'previous-instance',
            pid: 4242,
            status: 'stopped',
            workspaceId: config.workspaceId,
            processId: config.processId,
            worktree: config.worktree,
            mode: config.mode,
            startedAtMs: 100,
            idleStreak: 0,
            resumeCount: 2,
            lastRecoveryAtMs: 200,
            lastHeartbeatAtMs: 200,
            lastProbe: healthyProbe(),
            lastAction: 'stopped',
        }));
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_STOP_FILENAME), JSON.stringify({
            instanceId,
        }));

        await runDeliveryWatchdog(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), {
            now: () => 1_000,
            probe: () => healthyProbe(),
            verifyServer: async () => undefined,
        });

        expect(JSON.parse(fs.readFileSync(
            path.join(config.stateDir, WATCHDOG_STATE_FILENAME),
            'utf-8',
        ))).toMatchObject({
            startedAtMs: 100,
            resumeCount: 2,
            worktree: process.platform === 'win32'
                ? fs.realpathSync.native(config.worktree).toLowerCase()
                : fs.realpathSync.native(config.worktree),
        });
    });

    it('does not persist or log raw recovery preparation errors', async () => {
        const { config } = fixture();
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), JSON.stringify({
            instanceId: 'instance-safe-preparation-error',
            config,
        }));
        let verificationCalls = 0;

        await runDeliveryWatchdog(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), {
            now: (() => {
                let now = 6_000;
                return () => {
                    now += 1_000;
                    return now;
                };
            })(),
            sleep: async () => undefined,
            probe: () => healthyProbe(),
            verifyServer: async () => {
                verificationCalls++;
                if (verificationCalls === 1) {
                    fs.rmSync(config.promptFile);
                } else {
                    fs.appendFileSync(config.ledgerPath, '\nDELIVERY_COMPLETE\n');
                }
            },
            postJson: async () => '{"task":{"id":"unused"}}',
        });

        const state = fs.readFileSync(
            path.join(config.stateDir, WATCHDOG_STATE_FILENAME),
            'utf-8',
        );
        const log = fs.readFileSync(path.join(config.stateDir, WATCHDOG_LOG_FILENAME), 'utf-8');
        expect(state).not.toContain(config.promptFile);
        expect(log).not.toContain(config.promptFile);
        expect(log).toContain('recovery preparation failed');
    });

    it('does not persist, log, or throw raw runtime failure details', async () => {
        const { config } = fixture();
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), JSON.stringify({
            instanceId: 'instance-safe-fatal-error',
            config,
        }));
        fs.rmSync(config.ledgerPath);

        await expect(runDeliveryWatchdog(
            path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME),
            { probe: () => healthyProbe() },
        )).rejects.toThrow('Delivery watchdog failed');

        const state = fs.readFileSync(
            path.join(config.stateDir, WATCHDOG_STATE_FILENAME),
            'utf-8',
        );
        const log = fs.readFileSync(path.join(config.stateDir, WATCHDOG_LOG_FILENAME), 'utf-8');
        expect(state).not.toContain(config.ledgerPath);
        expect(log).not.toContain(config.ledgerPath);
        expect(state).toContain('"error": "watchdog failed"');
    });

    it(
        'rejects an external-looking state directory that resolves inside the worktree',
        async () => {
            const { root, config } = fixture();
            const inside = path.join(config.worktree, 'hidden-state');
            const linkedState = path.join(root, 'external-state-link');
            fs.mkdirSync(inside);
            createDirectoryAlias(inside, linkedState);

            await expect(startDeliveryWatchdog({
                ...config,
                stateDir: linkedState,
            }, '/dist/watchdog-runner.js', {
                probe: () => healthyProbe(),
                verifyServer: async () => undefined,
                spawnDetached: () => 4242,
                isProcessAlive: () => false,
            })).rejects.toThrow('outside the target worktree');
        },
    );

    it('accepts a canonical external state directory', async () => {
        const { config } = fixture();
        await expect(startDeliveryWatchdog(config, '/dist/watchdog-runner.js', {
            probe: () => healthyProbe(),
            verifyServer: async () => undefined,
            spawnDetached: () => 4242,
            isProcessAlive: () => false,
        })).resolves.toMatchObject({ pid: 4242 });
    });

    it('preserves the committed JSON file when atomic replacement fails', () => {
        const { root } = fixture();
        const file = path.join(root, 'atomic-state.json');
        fs.writeFileSync(file, '{"generation":"old"}\n');
        const error = Object.assign(new Error('replace failed'), { code: 'EPERM' });

        expect(() => writeWatchdogJsonAtomic(file, { generation: 'new' }, () => {
            throw error;
        })).toThrow('replace failed');
        expect(fs.readFileSync(file, 'utf-8')).toBe('{"generation":"old"}\n');
    });

    it('sanitizes non-success recovery responses', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(
            'PRIVATE PROMPT AND REPOSITORY PATH',
            { status: 500 },
        ));

        await expect(postDeliveryWatchdogRecovery(
            'http://127.0.0.1:4000/api/queue',
            {},
            fetchMock,
        )).rejects.toThrow('Recovery endpoint returned HTTP 500');
        await expect(postDeliveryWatchdogRecovery(
            'http://127.0.0.1:4000/api/queue',
            {},
            fetchMock,
        )).rejects.not.toThrow('PRIVATE PROMPT');
    });
});

function createDirectoryAlias(target: string, alias: string): void {
    fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
}
