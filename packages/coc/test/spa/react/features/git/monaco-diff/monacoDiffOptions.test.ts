/**
 * Tests for monacoDiffOptions — model URIs, language, editor options and theme
 * for the Monaco diff viewer (AC-03). Pure: no Monaco runtime.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import {
    DIFF_REF_URI_SCHEME,
    buildDiffEditorOptions,
    buildDiffModels,
    diffLanguageFor,
    diffRefUri,
    isDiffRefUri,
    isEditableDiff,
    resolveDiffEditorTheme,
    sameDiffModels,
} from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffOptions';
import { browserDocumentUri } from '../../../../../../src/server/spa/client/react/features/language-servers/documentStore';

const SRC = join(__dirname, '../../../../../../src/server/spa/client/react');

describe('diffLanguageFor', () => {
    it.each([
        ['src/app.ts', 'typescript'],
        ['src/view.tsx', 'typescript'],
        ['lib/x.py', 'python'],
        ['docs/README.md', 'markdown'],
        ['deploy/Dockerfile', 'dockerfile'],
        ['Makefile', 'makefile'],
        ['data/blob.unknownext', 'plaintext'],
        ['no-extension', 'plaintext'],
        ['win\\style.css', 'css'],
    ])('%s → %s', (path, language) => {
        expect(diffLanguageFor(path)).toBe(language);
    });
});

describe('buildDiffModels', () => {
    const base = { workspaceId: 'ws-1', relativePath: 'src/a b.ts', original: 'old\n', modified: 'new\n' };

    it('unstaged: index → real working-copy URI', () => {
        const models = buildDiffModels({ ...base, stage: 'unstaged' });
        expect(models.original).toEqual({
            uri: diffRefUri('ws-1', 'INDEX', 'src/a b.ts'), text: 'old\n', language: 'typescript', isWorkingCopy: false,
        });
        expect(models.modified).toEqual({
            uri: browserDocumentUri('ws-1', 'src/a b.ts'), text: 'new\n', language: 'typescript', isWorkingCopy: true,
        });
        expect(models.modified.uri).toBe('coc-file://ws-1/src/a%20b.ts');
    });

    it('staged: HEAD → index, both synthetic, neither a working copy', () => {
        const models = buildDiffModels({ ...base, stage: 'staged' });
        expect(models.original.uri).toBe(`${DIFF_REF_URI_SCHEME}://ws-1/HEAD/src/a%20b.ts`);
        expect(models.modified.uri).toBe(`${DIFF_REF_URI_SCHEME}://ws-1/INDEX/src/a%20b.ts`);
        expect(models.original.isWorkingCopy).toBe(false);
        expect(models.modified.isWorkingCopy).toBe(false);
        expect(isDiffRefUri(models.original.uri)).toBe(true);
        expect(isDiffRefUri(models.modified.uri)).toBe(true);
    });

    it('all four URIs of one file are distinct; the real one is not a ref URI', () => {
        const unstaged = buildDiffModels({ ...base, stage: 'unstaged' });
        const staged = buildDiffModels({ ...base, stage: 'staged' });
        const uris = new Set([unstaged.original.uri, unstaged.modified.uri, staged.original.uri]);
        expect(uris.size).toBe(3);
        // The index side is the same content in both stages, so it shares a URI.
        expect(staged.modified.uri).toBe(unstaged.original.uri);
        expect(isDiffRefUri(unstaged.modified.uri)).toBe(false);
    });

    it('same path in two workspaces yields distinct URIs (multi-repo)', () => {
        const a = buildDiffModels({ ...base, workspaceId: 'ws-a', stage: 'unstaged' });
        const b = buildDiffModels({ ...base, workspaceId: 'ws-b', stage: 'unstaged' });
        expect(a.original.uri).not.toBe(b.original.uri);
        expect(a.modified.uri).not.toBe(b.modified.uri);
    });

    it('scopes immutable commit, range, and PR models by source identity', () => {
        const commit = buildDiffModels({ ...base, stage: 'staged', modelIdentity: 'commit:abc123' });
        const range = buildDiffModels({ ...base, stage: 'staged', modelIdentity: 'branch-range:upstream' });
        const pr = buildDiffModels({ ...base, stage: 'staged', modelIdentity: 'pr:origin:42:head-sha' });

        for (const models of [commit, range, pr]) {
            expect(isDiffRefUri(models.original.uri)).toBe(true);
            expect(isDiffRefUri(models.modified.uri)).toBe(true);
            expect(models.original.isWorkingCopy).toBe(false);
            expect(models.modified.isWorkingCopy).toBe(false);
            expect(models.original.uri).not.toBe(models.modified.uri);
        }
        expect(new Set([commit.original.uri, range.original.uri, pr.original.uri]).size).toBe(3);
    });

    it('keeps text byte-for-byte (CRLF and missing trailing newline)', () => {
        const models = buildDiffModels({ ...base, stage: 'unstaged', original: 'a\r\nb', modified: 'a\r\nb\r\n' });
        expect(models.original.text).toBe('a\r\nb');
        expect(models.modified.text).toBe('a\r\nb\r\n');
    });

    it('sameDiffModels compares URI, text, language and working-copy flag', () => {
        const a = buildDiffModels({ ...base, stage: 'unstaged' });
        expect(sameDiffModels(a, buildDiffModels({ ...base, stage: 'unstaged' }))).toBe(true);
        expect(sameDiffModels(a, buildDiffModels({ ...base, stage: 'unstaged', modified: 'x' }))).toBe(false);
        expect(sameDiffModels(a, buildDiffModels({ ...base, stage: 'staged' }))).toBe(false);
        expect(sameDiffModels(a, null)).toBe(false);
        expect(sameDiffModels(null, null)).toBe(true);
    });
});

describe('buildDiffEditorOptions', () => {
    it('split → side by side; unified → inline', () => {
        expect(buildDiffEditorOptions('split').renderSideBySide).toBe(true);
        expect(buildDiffEditorOptions('unified').renderSideBySide).toBe(false);
    });

    it.each(['split', 'unified'] as const)('%s: both sides read-only, overview ruler on, whitespace kept', (mode) => {
        const options = buildDiffEditorOptions(mode);
        expect(options.readOnly).toBe(true);
        expect(options.originalEditable).toBe(false);
        expect(options.renderOverviewRuler).toBe(true);
        expect(options.ignoreTrimWhitespace).toBe(false);
        expect(options.automaticLayout).toBe(false);
        // Unified must not silently switch to inline, split must not either.
        expect(options.useInlineViewWhenSpaceIsLimited).toBe(false);
        // Hosts the add-comment widget (AC-05).
        expect(options.glyphMargin).toBe(true);
    });

    it('turns semantic coloring on, which only a provider-backed model uses', () => {
        expect(buildDiffEditorOptions('split')['semanticHighlighting.enabled']).toBe(true);
    });
});

describe('editable modified side', () => {
    const base = { workspaceId: 'ws-1', relativePath: 'src/a.ts', original: 'old\n', modified: 'new\n' };

    it('editable options open only the modified side', () => {
        const options = buildDiffEditorOptions('split', true);
        expect(options.readOnly).toBe(false);
        expect(options.domReadOnly).toBe(false);
        expect(options.originalEditable).toBe(false);
    });

    it('an editable unstaged diff yields an editable modified side', () => {
        const models = buildDiffModels({ ...base, stage: 'unstaged' });
        expect(isEditableDiff(true, 'unstaged', models)).toBe(true);
        expect(buildDiffEditorOptions('unified', isEditableDiff(true, 'unstaged', models)))
            .toMatchObject({ readOnly: false, originalEditable: false });
    });

    it('not requested → read-only', () => {
        expect(isEditableDiff(false, 'unstaged', buildDiffModels({ ...base, stage: 'unstaged' }))).toBe(false);
    });

    it('ref-backed staged sides stay read-only', () => {
        expect(isEditableDiff(true, 'staged', buildDiffModels({ ...base, stage: 'staged' }))).toBe(false);
    });

    it('a staged diff whose disk equals the index edits the real document; the HEAD side stays ref-backed', () => {
        const models = buildDiffModels({ ...base, stage: 'staged', modifiedMatchesWorkingCopy: true });
        expect(models.modified).toMatchObject({ uri: browserDocumentUri(base.workspaceId, base.relativePath), isWorkingCopy: true });
        expect(isDiffRefUri(models.original.uri)).toBe(true);
        expect(isEditableDiff(true, 'staged', models)).toBe(true);
        expect(buildDiffEditorOptions('split', isEditableDiff(true, 'staged', models)))
            .toMatchObject({ readOnly: false, originalEditable: false });
    });

    it('commit / PR snapshots stay read-only', () => {
        for (const stage of ['unstaged', 'staged'] as const) {
            const models = buildDiffModels({ ...base, stage, modelIdentity: 'commit:abc', modifiedMatchesWorkingCopy: true });
            expect(isEditableDiff(true, stage, models)).toBe(false);
        }
    });

    it('a branch-range head stays read-only even when it is the working copy', () => {
        const models = buildDiffModels({ ...base, stage: 'branch-range', modelIdentity: 'range:a..b', modifiedMatchesWorkingCopy: true });
        expect(models.modified.isWorkingCopy).toBe(true);
        expect(isEditableDiff(true, 'branch-range', models)).toBe(false);
        expect(buildDiffEditorOptions('split', isEditableDiff(true, 'branch-range', models)))
            .toMatchObject({ readOnly: true, originalEditable: false, domReadOnly: true });
    });
});

describe('resolveDiffEditorTheme', () => {
    it('follows explicit app themes regardless of OS preference', () => {
        expect(resolveDiffEditorTheme('dark', false)).toBe('vs-dark');
        expect(resolveDiffEditorTheme('light', true)).toBe('vs');
    });
    it('auto defers to the OS preference', () => {
        expect(resolveDiffEditorTheme('auto', true)).toBe('vs-dark');
        expect(resolveDiffEditorTheme('auto', false)).toBe('vs');
    });
});

describe('source assertions', () => {
    it('pure modules have no Monaco value import', () => {
        for (const file of ['monacoDiffOptions.ts', 'monacoDiffHunks.ts', 'monacoDiffController.ts', 'monacoDiffModelRegistry.ts', 'monacoDiffLineShim.ts', 'monacoDiffEditorAdapter.ts']) {
            const text = readFileSync(join(SRC, 'features/git/diff', file), 'utf8');
            expect(text, file).not.toMatch(/import\s+(?!type\b)[^;]*from\s+'monaco-editor/);
        }
        const language = readFileSync(join(SRC, 'shared/file-viewer/monacoLanguage.ts'), 'utf8');
        expect(language).not.toMatch(/^import /m);
    });

    it('the DiffLine[] shim is annotated as temporary', () => {
        const shim = readFileSync(join(SRC, 'features/git/diff/monacoDiffLineShim.ts'), 'utf8');
        expect(shim).toMatch(/TEMPORARY COMPATIBILITY SHIM/);
        const viewer = readFileSync(join(SRC, 'features/git/diff/MonacoFileDiffViewer.tsx'), 'utf8');
        expect(viewer).toMatch(/TEMPORARY compatibility shim/);
    });

    it('adds no TODOs', () => {
        for (const file of ['monacoDiffOptions.ts', 'monacoDiffHunks.ts', 'monacoDiffController.ts', 'monacoDiffModelRegistry.ts', 'monacoDiffLineShim.ts', 'monacoDiffEditorAdapter.ts', 'MonacoFileDiffViewer.tsx']) {
            expect(readFileSync(join(SRC, 'features/git/diff', file), 'utf8'), file).not.toMatch(/TODO|FIXME/);
        }
    });

    it('only the shared file-diff surfaces read the diff-engine preference or render the Monaco diff viewer', () => {
        const readers: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (/\.tsx?$/.test(entry.name)) {
                    const text = readFileSync(full, 'utf8');
                    if (/\buseDiffEngine\(|<MonacoFileDiffViewer\b/.test(text)) readers.push(relative(SRC, full).replace(/\\/g, '/'));
                }
            }
        };
        walk(SRC);
        expect(readers.filter(f => !f.endsWith('hooks/useDiffEngine.ts')).sort()).toEqual([
            'features/git/diff/FileDiffPanel.tsx',
            'features/git/hooks/useFileDiffEngineState.ts',
            'features/git/working-tree/WorkingTreeFileDiff.tsx',
        ]);
    });

    it('diffEngine has one preference field, resolves to monaco by default, and adds no TODOs', () => {
        const hook = readFileSync(join(SRC, 'features/git/hooks/useDiffEngine.ts'), 'utf8');
        const preferencesSchema = readFileSync(join(SRC, '../../../preferences/schema.ts'), 'utf8');
        expect(hook).toMatch(/DEFAULT_DIFF_ENGINE: DiffEngine = 'monaco'/);
        expect(preferencesSchema.match(/^\s*diffEngine:/gm)).toHaveLength(1);
        for (const file of ['features/git/hooks/useDiffEngine.ts', 'features/git/diff/DiffViewToggle.tsx', 'features/git/diff/FileDiffPanel.tsx', 'features/git/working-tree/WorkingTreeFileDiff.tsx']) {
            expect(readFileSync(join(SRC, file), 'utf8'), file).not.toMatch(/TODO|FIXME/);
        }
    });
});
