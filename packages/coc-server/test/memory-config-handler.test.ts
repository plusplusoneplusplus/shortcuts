/**
 * Tests for memory-config-handler — read/write/defaults/validate.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    validateMemoryConfig,
    readMemoryConfig,
    writeMemoryConfig,
    DEFAULT_MEMORY_CONFIG,
    MEMORY_CONFIG_FILE_NAME,
} from '../src/memory/memory-config-handler';

describe('validateMemoryConfig', () => {
    it('returns defaults for null input', () => {
        const result = validateMemoryConfig(null);
        expect(result).toEqual(DEFAULT_MEMORY_CONFIG);
    });

    it('returns defaults for non-object input', () => {
        expect(validateMemoryConfig('string')).toEqual(DEFAULT_MEMORY_CONFIG);
        expect(validateMemoryConfig(42)).toEqual(DEFAULT_MEMORY_CONFIG);
    });

    it('validates storageDir as string', () => {
        const result = validateMemoryConfig({ storageDir: '/custom/path' });
        expect(result.storageDir).toBe('/custom/path');
    });

    it('expands ~ in storageDir', () => {
        const result = validateMemoryConfig({ storageDir: '~/custom/path' });
        expect(result.storageDir).toBe(path.join(os.homedir(), '/custom/path'));
    });

    it('uses default storageDir for empty string', () => {
        const result = validateMemoryConfig({ storageDir: '' });
        expect(result.storageDir).toBe(DEFAULT_MEMORY_CONFIG.storageDir);
    });

    it('validates backend type', () => {
        expect(validateMemoryConfig({ backend: 'file' }).backend).toBe('file');
        expect(validateMemoryConfig({ backend: 'sqlite' }).backend).toBe('sqlite');
        expect(validateMemoryConfig({ backend: 'vector' }).backend).toBe('vector');
        expect(validateMemoryConfig({ backend: 'invalid' }).backend).toBe('file');
    });

    it('validates maxEntries as positive integer', () => {
        expect(validateMemoryConfig({ maxEntries: 500 }).maxEntries).toBe(500);
        expect(validateMemoryConfig({ maxEntries: 0 }).maxEntries).toBe(DEFAULT_MEMORY_CONFIG.maxEntries);
        expect(validateMemoryConfig({ maxEntries: -1 }).maxEntries).toBe(DEFAULT_MEMORY_CONFIG.maxEntries);
        expect(validateMemoryConfig({ maxEntries: 10.7 }).maxEntries).toBe(10);
    });

    it('validates ttlDays as non-negative integer', () => {
        expect(validateMemoryConfig({ ttlDays: 30 }).ttlDays).toBe(30);
        expect(validateMemoryConfig({ ttlDays: 0 }).ttlDays).toBe(0);
        expect(validateMemoryConfig({ ttlDays: -1 }).ttlDays).toBe(DEFAULT_MEMORY_CONFIG.ttlDays);
        expect(validateMemoryConfig({ ttlDays: 3.9 }).ttlDays).toBe(3);
    });

    it('validates autoInject as boolean', () => {
        expect(validateMemoryConfig({ autoInject: true }).autoInject).toBe(true);
        expect(validateMemoryConfig({ autoInject: false }).autoInject).toBe(false);
        expect(validateMemoryConfig({ autoInject: 'yes' }).autoInject).toBe(false);
    });

    it('ignores unknown fields', () => {
        const result = validateMemoryConfig({ unknown: 'field', maxEntries: 100 });
        expect((result as any).unknown).toBeUndefined();
        expect(result.maxEntries).toBe(100);
    });
});

describe('readMemoryConfig / writeMemoryConfig', () => {
    let tmpDir: string;

    it('returns defaults when file does not exist', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-config-test-'));
        try {
            const result = readMemoryConfig(tmpDir);
            expect(result).toEqual(DEFAULT_MEMORY_CONFIG);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('round-trips config', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-config-test-'));
        try {
            const config = {
                storageDir: '/tmp/test-memory',
                backend: 'sqlite' as const,
                maxEntries: 5000,
                ttlDays: 30,
                autoInject: true,
            };
            writeMemoryConfig(tmpDir, config);
            const result = readMemoryConfig(tmpDir);
            expect(result.storageDir).toBe(config.storageDir);
            expect(result.backend).toBe(config.backend);
            expect(result.maxEntries).toBe(config.maxEntries);
            expect(result.ttlDays).toBe(config.ttlDays);
            expect(result.autoInject).toBe(config.autoInject);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('uses atomic write-then-rename (file name ends with MEMORY_CONFIG_FILE_NAME)', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-config-test-'));
        try {
            writeMemoryConfig(tmpDir, DEFAULT_MEMORY_CONFIG);
            const configPath = path.join(tmpDir, MEMORY_CONFIG_FILE_NAME);
            expect(fs.existsSync(configPath)).toBe(true);
            // .tmp file must not remain
            expect(fs.existsSync(configPath + '.tmp')).toBe(false);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('returns defaults when file is corrupt JSON', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-config-test-'));
        try {
            fs.writeFileSync(path.join(tmpDir, MEMORY_CONFIG_FILE_NAME), '{ invalid json }', 'utf-8');
            const result = readMemoryConfig(tmpDir);
            expect(result).toEqual(DEFAULT_MEMORY_CONFIG);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
