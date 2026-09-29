/**
 * AC-06 eligibility: only the real modified side of an unstaged diff may be
 * offered to a language server. Every synthetic URI, the original side and
 * both sides of a staged diff are refused — as data, never as an error.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    DIFF_LANGUAGE_MAX_CHARS,
    resolveDiffLanguageTarget,
} from '../../../../../../src/server/spa/client/react/features/git/diff/diffLanguageEligibility';
import {
    buildDiffModels,
    isDiffRefUri,
    type DiffModelsInput,
} from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffOptions';
import { browserDocumentUri } from '../../../../../../src/server/spa/client/react/features/language-servers/documentStore';
import { MAX_FILE_VIEW_SIZE } from '../../../../../../src/server/spa/client/react/shared/file-viewer/useFileContent';

const SRC = join(__dirname, '../../../../../../src/server/spa/client/react');
const DIFF = join(SRC, 'features/git/diff');
const read = (file: string) => readFileSync(join(DIFF, file), 'utf8');
const AC06_FILES = ['diffLanguageEligibility.ts', 'diffLanguageMount.ts', 'useDiffLanguageFeatures.ts'];

const input = (stage: 'staged' | 'unstaged', overrides: { workspaceId?: string; relativePath?: string; modified?: string } = {}) => {
    const workspaceId = overrides.workspaceId ?? 'ws-1';
    const relativePath = overrides.relativePath ?? 'src/a.ts';
    return {
        workspaceId,
        relativePath,
        stage,
        models: buildDiffModels({ workspaceId, relativePath, stage, original: 'a\n', modified: overrides.modified ?? 'b\n' }),
    };
};

describe('resolveDiffLanguageTarget', () => {
    it('accepts the working copy of an unstaged diff under its real document URI', () => {
        const target = resolveDiffLanguageTarget(input('unstaged'));
        expect(target).toEqual({ eligible: true, path: 'src/a.ts', uri: browserDocumentUri('ws-1', 'src/a.ts') });
    });

    it('refuses both sides of a staged diff', () => {
        const staged = input('staged');
        expect(resolveDiffLanguageTarget(staged)).toEqual({ eligible: false, reason: 'staged' });
        // Neither staged side is a working copy or a real document URI.
        for (const side of [staged.models.original, staged.models.modified]) {
            expect(side.isWorkingCopy).toBe(false);
            expect(isDiffRefUri(side.uri)).toBe(true);
        }
    });

    it('never offers the original (index) side, even when mislabelled as the working copy', () => {
        const unstaged = input('unstaged');
        const swapped: DiffModelsInput = { original: unstaged.models.modified, modified: { ...unstaged.models.original, isWorkingCopy: true } };
        expect(resolveDiffLanguageTarget({ ...unstaged, models: swapped })).toEqual({ eligible: false, reason: 'synthetic-uri' });
        expect(resolveDiffLanguageTarget({ ...unstaged, models: { ...unstaged.models, modified: unstaged.models.original } }))
            .toEqual({ eligible: false, reason: 'not-working-copy' });
    });

    it('refuses every synthetic ref URI', () => {
        const unstaged = input('unstaged');
        for (const ref of ['HEAD', 'INDEX']) {
            const uri = `coc-diff-ref://ws-1/${ref}/src/a.ts`;
            const models = { ...unstaged.models, modified: { ...unstaged.models.modified, uri } };
            expect(resolveDiffLanguageTarget({ ...unstaged, models })).toEqual({ eligible: false, reason: 'synthetic-uri' });
        }
    });

    it('refuses a URI that is not exactly this workspace + path (conflict variant, other repo)', () => {
        const unstaged = input('unstaged');
        const variant = { ...unstaged.models, modified: { ...unstaged.models.modified, uri: `${unstaged.models.modified.uri}#coc-diff-1` } };
        expect(resolveDiffLanguageTarget({ ...unstaged, models: variant })).toEqual({ eligible: false, reason: 'foreign-uri' });
        // Multi-repo: ws-2's models are not ws-1's document.
        const other = input('unstaged', { workspaceId: 'ws-2' });
        expect(resolveDiffLanguageTarget({ ...other, workspaceId: 'ws-1' })).toEqual({ eligible: false, reason: 'foreign-uri' });
        expect(resolveDiffLanguageTarget(other)).toMatchObject({ eligible: true, uri: browserDocumentUri('ws-2', 'src/a.ts') });
    });

    it('turns off above the explorer size threshold', () => {
        expect(DIFF_LANGUAGE_MAX_CHARS).toBe(MAX_FILE_VIEW_SIZE);
        expect(resolveDiffLanguageTarget(input('unstaged', { modified: 'x'.repeat(DIFF_LANGUAGE_MAX_CHARS) })).eligible).toBe(true);
        expect(resolveDiffLanguageTarget(input('unstaged', { modified: 'x'.repeat(DIFF_LANGUAGE_MAX_CHARS + 1) })))
            .toEqual({ eligible: false, reason: 'oversized' });
    });

    it('refuses a missing workspace or path', () => {
        expect(resolveDiffLanguageTarget({ ...input('unstaged'), workspaceId: '' })).toEqual({ eligible: false, reason: 'no-workspace' });
        expect(resolveDiffLanguageTarget({ ...input('unstaged'), relativePath: '' })).toEqual({ eligible: false, reason: 'no-workspace' });
    });

    it('normalizes the path the same way the document store does', () => {
        const target = resolveDiffLanguageTarget({ ...input('unstaged'), relativePath: '/src\\a.ts' });
        expect(target).toMatchObject({ eligible: true, path: 'src/a.ts' });
    });
});

describe('AC-06 source assertions', () => {
    it('only the diff language mount registers providers, and only via the URI-checked adapter seam', () => {
        expect(read('diffLanguageMount.ts')).toMatch(/registerLanguageProviders\(/);
        for (const file of ['MonacoFileDiffViewer.tsx', 'monacoDiffEditorAdapter.ts', 'useDiffLanguageFeatures.ts', 'monacoDiffController.ts']) {
            expect(read(file), file).not.toMatch(/registerLanguageProviders\(|register\w*Provider\(/);
        }
        // The viewer mounts through `attachModifiedLanguage`, which re-checks the model URI.
        expect(read('MonacoFileDiffViewer.tsx')).toMatch(/attachModifiedLanguage\(languageUri, languageMount\)/);
        const adapter = read('monacoDiffEditorAdapter.ts');
        expect(adapter).toMatch(/model\.uri\.toString\(\) === monaco\.Uri\.parse\(documentUri\)\.toString\(\)/);
        expect(adapter).toMatch(/setModels\(models\) \{[\s\S]*?unmountLanguage\(\);[\s\S]*?releaseLeases\(\);/);
    });

    it('the eligibility rule is keyed on the synthetic scheme and the unstaged stage', () => {
        const rule = read('diffLanguageEligibility.ts');
        expect(rule).toMatch(/isDiffRefUri\(modified\.uri\)/);
        expect(rule).toMatch(/stage !== 'unstaged'/);
    });

    it('both diff editors stay read-only and the engine default is monaco', () => {
        expect(read('monacoDiffOptions.ts')).toMatch(/readOnly: true,\s*originalEditable: false,/);
        expect(readFileSync(join(SRC, 'features/git/hooks/useDiffEngine.ts'), 'utf8')).toMatch(/DEFAULT_DIFF_ENGINE: DiffEngine = 'monaco'/);
    });

    it('adds no TODOs and no Monaco value import', () => {
        for (const file of AC06_FILES) {
            const text = read(file);
            expect(text, file).not.toMatch(/TODO|FIXME/);
            expect(text, file).not.toMatch(/import\s+(?!type\b)[^;]*from\s+'monaco-editor/);
        }
    });
});
