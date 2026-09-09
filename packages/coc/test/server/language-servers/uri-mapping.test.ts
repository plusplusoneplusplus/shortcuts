/**
 * Document-identity translation: browser `coc-file://` URIs in, host `file://`
 * URIs out, and the containment rules that make the mapping an access check.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { pathToFileURL } from 'url';
import {
    browserDocumentUri,
    isInsideRoot,
    parseBrowserDocumentUri,
    resolveWorkspaceDocument,
    toBrowserUri,
    toServerUri,
    translateUris,
} from '../../../src/server/language-servers/uri-mapping';

const ROOT = path.resolve(path.sep === '\\' ? 'C:\\repos\\demo' : '/repos/demo');

describe('browser document URIs', () => {
    it('encodes each path segment and the workspace id', () => {
        const uri = browserDocumentUri('ws a/b', 'src/my file.ts');
        expect(uri).toBe('coc-file://ws%20a%2Fb/src/my%20file.ts');
    });

    it('round-trips unicode and spaces', () => {
        const uri = browserDocumentUri('ws-1', 'src/héllo wörld.ts');
        expect(parseBrowserDocumentUri(uri)).toEqual({ workspaceId: 'ws-1', relativePath: 'src/héllo wörld.ts' });
    });

    it('normalizes the path before building the URI', () => {
        expect(browserDocumentUri('ws-1', './src\\a.ts')).toBe('coc-file://ws-1/src/a.ts');
    });

    it('rejects any other scheme or a URI with no path', () => {
        expect(parseBrowserDocumentUri('file:///repos/demo/src/a.ts')).toBeUndefined();
        expect(parseBrowserDocumentUri('coc-file://ws-1')).toBeUndefined();
        expect(parseBrowserDocumentUri('coc-file:///a.ts')).toBeUndefined();
    });
});

describe('resolveWorkspaceDocument', () => {
    it('resolves a relative path to a host file URI', () => {
        const resolved = resolveWorkspaceDocument(ROOT, 'src/a.ts');
        expect(resolved.ok).toBe(true);
        if (resolved.ok) {
            expect(resolved.relativePath).toBe('src/a.ts');
            expect(resolved.absolutePath).toBe(path.join(ROOT, 'src', 'a.ts'));
            expect(resolved.uri).toBe(pathToFileURL(path.join(ROOT, 'src', 'a.ts')).href);
        }
    });

    it('normalizes leading ./ and backslash separators', () => {
        const resolved = resolveWorkspaceDocument(ROOT, './src\\nested\\a.ts');
        expect(resolved.ok && resolved.relativePath).toBe('src/nested/a.ts');
    });

    it('refuses an empty path', () => {
        expect(resolveWorkspaceDocument(ROOT, '   '.trim())).toEqual({ ok: false, reason: 'empty-path' });
    });

    it('refuses a path that climbs out of the workspace', () => {
        expect(resolveWorkspaceDocument(ROOT, '../secrets/id_rsa')).toEqual({ ok: false, reason: 'escapes-workspace' });
        expect(resolveWorkspaceDocument(ROOT, 'src/../../secrets')).toEqual({ ok: false, reason: 'escapes-workspace' });
    });

    it('refuses an absolute path, including a Windows drive path', () => {
        expect(resolveWorkspaceDocument(ROOT, '/etc/passwd')).toEqual({ ok: false, reason: 'absolute-path' });
        expect(resolveWorkspaceDocument(ROOT, 'C:\\Windows\\system.ini')).toEqual({ ok: false, reason: 'absolute-path' });
    });

    it('keeps a `..` that stays inside the workspace', () => {
        const resolved = resolveWorkspaceDocument(ROOT, 'src/nested/../a.ts');
        expect(resolved.ok && resolved.absolutePath).toBe(path.join(ROOT, 'src', 'a.ts'));
    });
});

describe('isInsideRoot', () => {
    it('accepts the root itself and its descendants', () => {
        expect(isInsideRoot(ROOT, ROOT)).toBe(true);
        expect(isInsideRoot(ROOT, path.join(ROOT, 'a', 'b.ts'))).toBe(true);
    });

    it('rejects a sibling whose name merely starts with the root', () => {
        expect(isInsideRoot(ROOT, `${ROOT}-other`)).toBe(false);
        expect(isInsideRoot(ROOT, path.join(path.dirname(ROOT), 'elsewhere'))).toBe(false);
    });
});

describe('toServerUri', () => {
    it('maps a browser URI for this workspace onto the host file URI', () => {
        const mapped = toServerUri(browserDocumentUri('ws-1', 'src/a.ts'), 'ws-1', ROOT);
        expect(mapped).toEqual({ ok: true, uri: pathToFileURL(path.join(ROOT, 'src', 'a.ts')).href });
    });

    it('refuses a URI naming a different workspace', () => {
        const mapped = toServerUri(browserDocumentUri('ws-2', 'src/a.ts'), 'ws-1', ROOT);
        expect(mapped).toEqual({ ok: false, reason: 'foreign-workspace' });
    });

    it('refuses a host file URI supplied directly by the client', () => {
        expect(toServerUri('file:///etc/passwd', 'ws-1', ROOT)).toEqual({ ok: false, reason: 'unsupported-scheme' });
    });

    it('refuses a browser URI that climbs out of the workspace', () => {
        expect(toServerUri('coc-file://ws-1/../../etc/passwd', 'ws-1', ROOT)).toEqual({
            ok: false,
            reason: 'escapes-workspace',
        });
    });
});

describe('toBrowserUri', () => {
    it('maps a file inside the workspace to a browser document URI', () => {
        const hostUri = pathToFileURL(path.join(ROOT, 'src', 'a.ts')).href;
        expect(toBrowserUri(hostUri, 'ws-1', ROOT)).toBe(browserDocumentUri('ws-1', 'src/a.ts'));
    });

    it('leaves a dependency outside the workspace untouched', () => {
        const outside = pathToFileURL(path.join(path.dirname(ROOT), 'other', 'lib.d.ts')).href;
        expect(toBrowserUri(outside, 'ws-1', ROOT)).toBe(outside);
    });

    it('leaves a non-file scheme untouched', () => {
        expect(toBrowserUri('untitled:Untitled-1', 'ws-1', ROOT)).toBe('untitled:Untitled-1');
    });

    it('leaves the workspace root itself untouched, since it is not a document', () => {
        const rootUri = pathToFileURL(ROOT).href;
        expect(toBrowserUri(rootUri, 'ws-1', ROOT)).toBe(rootUri);
    });
});

describe('translateUris', () => {
    const upper = (uri: string): string => `${uri}!`;

    it('translates URI fields at any depth without touching other strings', () => {
        const payload = {
            textDocument: { uri: 'a', languageId: 'typescript' },
            items: [{ targetUri: 'b' }, { targetUri: 'c' }],
            message: 'uri',
        };
        const result = translateUris(payload, upper);
        expect(result).toEqual({
            ok: true,
            value: {
                textDocument: { uri: 'a!', languageId: 'typescript' },
                items: [{ targetUri: 'b!' }, { targetUri: 'c!' }],
                message: 'uri',
            },
        });
    });

    it('translates an array of URIs held under one URI key', () => {
        const result = translateUris({ uri: ['a', 'b'] }, upper);
        expect(result).toEqual({ ok: true, value: { uri: ['a!', 'b!'] } });
    });

    it('does not mutate the input', () => {
        const payload = { uri: 'a' };
        translateUris(payload, upper);
        expect(payload.uri).toBe('a');
    });

    it('rejects the whole payload when one URI cannot be translated', () => {
        const result = translateUris({ uri: 'a', other: { targetUri: 'bad' } }, (uri) =>
            uri === 'bad' ? undefined : upper(uri),
        );
        expect(result).toEqual({ ok: false, uri: 'bad' });
    });

    it('passes through primitives and null', () => {
        expect(translateUris(null, upper)).toEqual({ ok: true, value: null });
        expect(translateUris(7, upper)).toEqual({ ok: true, value: 7 });
        expect(translateUris(undefined, upper)).toEqual({ ok: true, value: undefined });
    });
});
