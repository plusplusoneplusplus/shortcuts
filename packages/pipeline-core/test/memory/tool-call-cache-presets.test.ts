import { describe, it, expect } from 'vitest';
import { TASK_FILTER, ALL_TOOLS_FILTER, createToolNameFilter } from '../../src/memory/tool-call-cache-presets';

describe('TASK_FILTER', () => {
    it('matches task with agent_type=explore', () => {
        expect(TASK_FILTER('task', { agent_type: 'explore' })).toBe(true);
    });

    it('matches task with agent_type=general-purpose', () => {
        expect(TASK_FILTER('task', { agent_type: 'general-purpose' })).toBe(true);
    });

    it('matches task with no agent_type', () => {
        expect(TASK_FILTER('task', {})).toBe(true);
    });

    it('rejects grep', () => {
        expect(TASK_FILTER('grep', { pattern: 'foo' })).toBe(false);
    });

    it('rejects glob', () => {
        expect(TASK_FILTER('glob', { pattern: '**/*.ts' })).toBe(false);
    });

    it('rejects view', () => {
        expect(TASK_FILTER('view', { path: '/src/index.ts' })).toBe(false);
    });

    it('rejects read_file', () => {
        expect(TASK_FILTER('read_file', {})).toBe(false);
    });

    it('rejects list_directory', () => {
        expect(TASK_FILTER('list_directory', {})).toBe(false);
    });

    it('rejects edit', () => {
        expect(TASK_FILTER('edit', {})).toBe(false);
    });

    it('rejects create', () => {
        expect(TASK_FILTER('create', {})).toBe(false);
    });

    it('rejects powershell', () => {
        expect(TASK_FILTER('powershell', {})).toBe(false);
    });
});

describe('ALL_TOOLS_FILTER', () => {
    it('matches everything', () => {
        expect(ALL_TOOLS_FILTER('anything', {})).toBe(true);
    });

    it('matches empty name', () => {
        expect(ALL_TOOLS_FILTER('', {})).toBe(true);
    });
});

describe('createToolNameFilter', () => {
    it('produces correct filter', () => {
        const filter = createToolNameFilter('grep', 'view');
        expect(filter('grep', {})).toBe(true);
        expect(filter('view', {})).toBe(true);
        expect(filter('edit', {})).toBe(false);
    });

    it('with no names matches nothing', () => {
        const filter = createToolNameFilter();
        expect(filter('grep', {})).toBe(false);
        expect(filter('', {})).toBe(false);
    });
});
