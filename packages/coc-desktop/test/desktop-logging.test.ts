/**
 * Unit tests for the Fix 2 main-process file logging.
 *
 * Cover the rotating file logger (append + size rotation + backup pruning +
 * error-swallowing), the console tee (mirror-while-preserving + uninstall), and
 * the shared log-dir resolver — all without Electron.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    createRotatingFileLogger,
    installConsoleTee,
    resolveDesktopLogDir,
    DESKTOP_LOG_FILENAME,
    TeeableStream,
    LoggerFs,
} from '../src/desktop-logging';

const tempDirs: string[] = [];
function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-desktop-log-'));
    tempDirs.push(dir);
    return dir;
}

const savedEnv = process.env.COC_DESKTOP_LOG_DIR;
afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    if (savedEnv === undefined) {
        delete process.env.COC_DESKTOP_LOG_DIR;
    } else {
        process.env.COC_DESKTOP_LOG_DIR = savedEnv;
    }
});

describe('resolveDesktopLogDir', () => {
    it('defaults to <dataDir>/logs', () => {
        delete process.env.COC_DESKTOP_LOG_DIR;
        expect(resolveDesktopLogDir('/tmp/data')).toBe(path.join('/tmp/data', 'logs'));
    });

    it('honors COC_DESKTOP_LOG_DIR override', () => {
        process.env.COC_DESKTOP_LOG_DIR = '/custom/logs';
        expect(resolveDesktopLogDir('/tmp/data')).toBe('/custom/logs');
    });
});

describe('createRotatingFileLogger', () => {
    it('creates the dir and appends successive writes to the active file', () => {
        const dir = makeTempDir();
        const filePath = path.join(dir, 'nested', DESKTOP_LOG_FILENAME);
        const logger = createRotatingFileLogger({ filePath });
        logger.write('one\n');
        logger.write('two\n');
        expect(fs.readFileSync(filePath, 'utf8')).toBe('one\ntwo\n');
    });

    it('accepts Buffer chunks', () => {
        const dir = makeTempDir();
        const filePath = path.join(dir, DESKTOP_LOG_FILENAME);
        const logger = createRotatingFileLogger({ filePath });
        logger.write(Buffer.from('buf\n', 'utf8'));
        expect(fs.readFileSync(filePath, 'utf8')).toBe('buf\n');
    });

    it('rotates the active file to .1 once it would exceed maxBytes', () => {
        const dir = makeTempDir();
        const filePath = path.join(dir, DESKTOP_LOG_FILENAME);
        const logger = createRotatingFileLogger({ filePath, maxBytes: 6, maxBackups: 3 });
        logger.write('aaaa\n'); // 5 bytes → fits in a fresh file
        logger.write('bbbb\n'); // would push to 10 > 6 → rotate first
        expect(fs.readFileSync(`${filePath}.1`, 'utf8')).toBe('aaaa\n');
        expect(fs.readFileSync(filePath, 'utf8')).toBe('bbbb\n');
    });

    it('never rotates a fresh file, so an oversized single chunk is still written', () => {
        const dir = makeTempDir();
        const filePath = path.join(dir, DESKTOP_LOG_FILENAME);
        const logger = createRotatingFileLogger({ filePath, maxBytes: 4 });
        logger.write('way-too-long\n');
        expect(fs.readFileSync(filePath, 'utf8')).toBe('way-too-long\n');
        expect(fs.existsSync(`${filePath}.1`)).toBe(false);
    });

    it('keeps at most maxBackups backups, dropping the oldest', () => {
        const dir = makeTempDir();
        const filePath = path.join(dir, DESKTOP_LOG_FILENAME);
        const logger = createRotatingFileLogger({ filePath, maxBytes: 6, maxBackups: 2 });
        // Each 5-byte write after the first forces a rotation.
        logger.write('AAAA\n'); // active=AAAA
        logger.write('BBBB\n'); // .1=AAAA, active=BBBB
        logger.write('CCCC\n'); // .2=AAAA, .1=BBBB, active=CCCC
        logger.write('DDDD\n'); // drop old .2(AAAA); .2=BBBB, .1=CCCC, active=DDDD
        expect(fs.readFileSync(filePath, 'utf8')).toBe('DDDD\n');
        expect(fs.readFileSync(`${filePath}.1`, 'utf8')).toBe('CCCC\n');
        expect(fs.readFileSync(`${filePath}.2`, 'utf8')).toBe('BBBB\n');
        // maxBackups=2 → no .3 is ever kept.
        expect(fs.existsSync(`${filePath}.3`)).toBe(false);
    });

    it('measures a pre-existing file so rotation accounts for prior content', () => {
        const dir = makeTempDir();
        const filePath = path.join(dir, DESKTOP_LOG_FILENAME);
        fs.writeFileSync(filePath, 'seed!\n'); // 6 bytes already on disk
        const logger = createRotatingFileLogger({ filePath, maxBytes: 6 });
        logger.write('next\n'); // 6 + 5 > 6 → rotate the seeded file
        expect(fs.readFileSync(`${filePath}.1`, 'utf8')).toBe('seed!\n');
        expect(fs.readFileSync(filePath, 'utf8')).toBe('next\n');
    });

    it('swallows fs errors so logging never throws', () => {
        const throwingFs: LoggerFs = {
            mkdirSync: () => undefined,
            appendFileSync: () => {
                throw new Error('disk full');
            },
            statSync: () => {
                throw new Error('nope');
            },
            existsSync: () => false,
            renameSync: () => undefined,
            unlinkSync: () => undefined,
        };
        const logger = createRotatingFileLogger({ filePath: '/nope/x.log', fsImpl: throwingFs });
        expect(() => logger.write('boom\n')).not.toThrow();
    });

    it('ignores empty writes', () => {
        const dir = makeTempDir();
        const filePath = path.join(dir, DESKTOP_LOG_FILENAME);
        const logger = createRotatingFileLogger({ filePath });
        logger.write('');
        expect(fs.existsSync(filePath)).toBe(false);
    });
});

describe('installConsoleTee', () => {
    function fakeStream(): TeeableStream & { chunks: unknown[] } {
        const chunks: unknown[] = [];
        return {
            chunks,
            write(chunk: string | Uint8Array) {
                chunks.push(chunk);
                return true;
            },
        };
    }

    it('mirrors writes into the logger while preserving the original write', () => {
        const stdout = fakeStream();
        const stderr = fakeStream();
        const logged: unknown[] = [];
        const uninstall = installConsoleTee({
            logger: { write: (c) => logged.push(c) },
            stdout,
            stderr,
        });

        stdout.write('[coc-desktop] hello\n');
        stderr.write('[coc-desktop] oops\n');

        // Original streams still received the data (terminal output preserved).
        expect(stdout.chunks).toEqual(['[coc-desktop] hello\n']);
        expect(stderr.chunks).toEqual(['[coc-desktop] oops\n']);
        // And the logger captured both.
        expect(logged).toEqual(['[coc-desktop] hello\n', '[coc-desktop] oops\n']);
        uninstall();
    });

    it('uninstall restores the original write and is idempotent', () => {
        const stdout = fakeStream();
        const original = stdout.write;
        const logged: unknown[] = [];
        const uninstall = installConsoleTee({ logger: { write: (c) => logged.push(c) }, stdout });
        expect(stdout.write).not.toBe(original);
        uninstall();
        expect(stdout.write).toBe(original);
        // Second call is a no-op (does not re-wrap or throw).
        expect(() => uninstall()).not.toThrow();
        stdout.write('after\n');
        expect(logged).toEqual([]); // no longer teed
    });

    it('keeps the stream working even if the logger throws', () => {
        const stdout = fakeStream();
        const uninstall = installConsoleTee({
            logger: {
                write: () => {
                    throw new Error('logger down');
                },
            },
            stdout,
        });
        expect(() => stdout.write('still works\n')).not.toThrow();
        expect(stdout.chunks).toEqual(['still works\n']);
        uninstall();
    });

    it('defaults to process.stdout/stderr when no streams are given', () => {
        const logged: unknown[] = [];
        const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        const uninstall = installConsoleTee({ logger: { write: (c) => logged.push(c) } });
        process.stdout.write('via process\n');
        uninstall();
        spy.mockRestore();
        expect(logged).toContain('via process\n');
    });
});
