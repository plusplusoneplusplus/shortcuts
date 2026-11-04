import { describe, expect, it } from 'vitest';
import { normalizeLanguageDocumentPath } from '../../../../src/server/spa/client/react/features/language-servers/documentPath';
import { browserDocumentUri } from '../../../../src/server/spa/client/react/features/language-servers/documentStore';
import { resolveDiffDefinitionRoute } from '../../../../src/server/spa/client/react/features/git/diff/diffDefinitionRoute';

describe('language document path identity', () => {
    it.each([
        ['\\src\\Mixed.ts', 'src/Mixed.ts'],
        ['///src/Mixed.ts', 'src/Mixed.ts'],
        ['./src/Mixed.ts', './src/Mixed.ts'],
        ['src//Mixed.ts', 'src//Mixed.ts'],
        [' src/Mixed.ts ', ' src/Mixed.ts '],
        ['src/Mixed.ts/', 'src/Mixed.ts/'],
        ['C:\\Repo\\Mixed.ts', 'C:/Repo/Mixed.ts'],
        ['\\\\wsl.localhost\\Distro\\Repo\\Mixed.ts', 'wsl.localhost/Distro/Repo/Mixed.ts'],
        ['https://example.invalid/src/Mixed.ts', 'https://example.invalid/src/Mixed.ts'],
    ])('preserves document-specific spelling for %s', (input, expected) => {
        expect(normalizeLanguageDocumentPath(input)).toBe(expected);
    });

    it('keeps document URI construction independent of path casing and URL encoding', () => {
        expect(browserDocumentUri('workspace', '\\src\\Mixed Name.ts'))
            .toBe(browserDocumentUri('workspace', '/src/Mixed Name.ts'));
        expect(browserDocumentUri('workspace', 'src/Mixed.ts'))
            .not.toBe(browserDocumentUri('workspace', 'src/mixed.ts'));
        expect(browserDocumentUri('workspace', './src/Mixed.ts'))
            .not.toBe(browserDocumentUri('workspace', 'src/Mixed.ts'));
    });

    it('does not adopt the definition router policy that removes a leading dot segment', () => {
        expect(normalizeLanguageDocumentPath('./src/Mixed.ts')).toBe('./src/Mixed.ts');
        expect(resolveDiffDefinitionRoute({
            workspaceId: 'workspace',
            filePath: 'src/Mixed.ts',
            reviewFiles: [],
            target: { workspaceId: 'workspace', path: './src/Mixed.ts', line: 1, column: 1 },
        })).toEqual({ kind: 'same-file', side: 'modified', line: 1, column: 1 });
    });
});
