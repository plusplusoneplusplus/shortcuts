/**
 * Tests for PopOutMarkdownShell — taskRootPath URL param parsing.
 */

import { describe, it, expect } from 'vitest';
import { parsePopOutMarkdownRoute } from '../../../src/server/spa/client/react/layout/PopOutMarkdownShell';

describe('parsePopOutMarkdownRoute — taskRootPath', () => {
    it('parses taskRootPath from search params', () => {
        const hash = '#popout/markdown';
        const search = '?workspace=ws1&filePath=coc/task.md&taskRootPath=C:/Users/user/.coc/repos/ws1/tasks';
        const result = parsePopOutMarkdownRoute(hash, search);
        expect(result).not.toBeNull();
        expect(result!.taskRootPath).toBe('C:/Users/user/.coc/repos/ws1/tasks');
    });

    it('returns undefined taskRootPath when param is absent', () => {
        const hash = '#popout/markdown';
        const search = '?workspace=ws1&filePath=coc/task.md';
        const result = parsePopOutMarkdownRoute(hash, search);
        expect(result).not.toBeNull();
        expect(result!.taskRootPath).toBeUndefined();
    });

    it('preserves other params when taskRootPath is present', () => {
        const hash = '#popout/markdown';
        const search = '?workspace=ws1&filePath=my/task.md&displayPath=/abs/path&fetchMode=tasks&taskRootPath=/root';
        const result = parsePopOutMarkdownRoute(hash, search);
        expect(result).not.toBeNull();
        expect(result!.wsId).toBe('ws1');
        expect(result!.filePath).toBe('my/task.md');
        expect(result!.displayPath).toBe('/abs/path');
        expect(result!.fetchMode).toBe('tasks');
        expect(result!.taskRootPath).toBe('/root');
    });
});
