/**
 * Tests for preferences-handler — UserPreferences validation, read/write, and reposSidebarCollapsed.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validatePreferences, readPreferences, writePreferences } from '../src/preferences-handler';

describe('validatePreferences', () => {
    it('returns empty object for non-object input', () => {
        expect(validatePreferences(null)).toEqual({});
        expect(validatePreferences(42)).toEqual({});
        expect(validatePreferences('string')).toEqual({});
    });

    it('validates lastModel as string', () => {
        expect(validatePreferences({ lastModel: 'gpt-4' })).toEqual({ lastModel: 'gpt-4' });
        expect(validatePreferences({ lastModel: 123 })).toEqual({});
    });

    it('validates lastDepth', () => {
        expect(validatePreferences({ lastDepth: 'deep' })).toEqual({ lastDepth: 'deep' });
        expect(validatePreferences({ lastDepth: 'normal' })).toEqual({ lastDepth: 'normal' });
        expect(validatePreferences({ lastDepth: 'invalid' })).toEqual({});
    });

    it('validates lastEffort', () => {
        expect(validatePreferences({ lastEffort: 'low' })).toEqual({ lastEffort: 'low' });
        expect(validatePreferences({ lastEffort: 'medium' })).toEqual({ lastEffort: 'medium' });
        expect(validatePreferences({ lastEffort: 'high' })).toEqual({ lastEffort: 'high' });
        expect(validatePreferences({ lastEffort: 'invalid' })).toEqual({});
    });

    it('validates lastSkills as per-mode object', () => {
        expect(validatePreferences({ lastSkills: { task: 'impl', ask: 'go-deep' } })).toEqual({
            lastSkills: { task: 'impl', ask: 'go-deep' },
        });
    });

    it('validates lastSkills with plan mode', () => {
        expect(validatePreferences({ lastSkills: { plan: 'speckit' } })).toEqual({
            lastSkills: { plan: 'speckit' },
        });
    });

    it('drops lastSkills with unknown mode keys', () => {
        expect(validatePreferences({ lastSkills: { unknown: 'x' } })).toEqual({});
    });

    it('drops lastSkills with non-string values', () => {
        expect(validatePreferences({ lastSkills: { task: 42 } })).toEqual({});
    });

    it('drops lastSkills when not an object', () => {
        expect(validatePreferences({ lastSkills: 'impl' })).toEqual({});
        expect(validatePreferences({ lastSkills: null })).toEqual({});
        expect(validatePreferences({ lastSkills: ['impl'] })).toEqual({});
    });

    it('validates theme', () => {
        expect(validatePreferences({ theme: 'light' })).toEqual({ theme: 'light' });
        expect(validatePreferences({ theme: 'dark' })).toEqual({ theme: 'dark' });
        expect(validatePreferences({ theme: 'auto' })).toEqual({ theme: 'auto' });
        expect(validatePreferences({ theme: 'invalid' })).toEqual({});
    });

    it('validates reposSidebarCollapsed as boolean', () => {
        expect(validatePreferences({ reposSidebarCollapsed: true })).toEqual({ reposSidebarCollapsed: true });
        expect(validatePreferences({ reposSidebarCollapsed: false })).toEqual({ reposSidebarCollapsed: false });
    });

    it('rejects non-boolean reposSidebarCollapsed', () => {
        expect(validatePreferences({ reposSidebarCollapsed: 'true' })).toEqual({});
        expect(validatePreferences({ reposSidebarCollapsed: 1 })).toEqual({});
        expect(validatePreferences({ reposSidebarCollapsed: null })).toEqual({});
    });

    it('drops unknown keys', () => {
        expect(validatePreferences({ unknownKey: 'value', lastModel: 'gpt-4' })).toEqual({ lastModel: 'gpt-4' });
    });

    it('validates pinnedChats', () => {
        const input = { pinnedChats: { ws1: ['id1', 'id2'] } };
        expect(validatePreferences(input)).toEqual({ pinnedChats: { ws1: ['id1', 'id2'] } });
    });

    it('drops pinnedChats when empty object', () => {
        expect(validatePreferences({ pinnedChats: {} })).toEqual({});
    });

    it('validates archivedChats', () => {
        const input = { archivedChats: { ws1: ['id1', 'id2'] } };
        expect(validatePreferences(input)).toEqual({ archivedChats: { ws1: ['id1', 'id2'] } });
    });

    it('drops archivedChats when empty object', () => {
        expect(validatePreferences({ archivedChats: {} })).toEqual({});
    });

    it('validates both pinnedChats and archivedChats together', () => {
        const input = { pinnedChats: { ws1: ['p1'] }, archivedChats: { ws1: ['a1'] } };
        expect(validatePreferences(input)).toEqual({
            pinnedChats: { ws1: ['p1'] },
            archivedChats: { ws1: ['a1'] },
        });
    });
});

describe('readPreferences / writePreferences', () => {
    let tmpDir: string;

    it('round-trips preferences with reposSidebarCollapsed', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-test-'));
        try {
            const prefs = { lastModel: 'gpt-4', reposSidebarCollapsed: true };
            writePreferences(tmpDir, prefs);
            const result = readPreferences(tmpDir);
            expect(result.lastModel).toBe('gpt-4');
            expect(result.reposSidebarCollapsed).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('returns empty object when file does not exist', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-test-'));
        try {
            expect(readPreferences(tmpDir)).toEqual({});
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
