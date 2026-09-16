/**
 * The browser's half of the external-source URI: a capability id and a safe
 * basename, and nothing a host filesystem would recognize.
 */

import { describe, expect, it } from 'vitest';
import {
    externalResourceUri,
    externalSourceLanguageId,
    parseExternalResourceUri,
} from '../../../../src/server/spa/client/react/features/language-servers/externalSource';

const language = (fileName: string): string => {
    if (fileName.endsWith('.hpp') || fileName.endsWith('.cpp')) return 'cpp';
    if (fileName.endsWith('.ts')) return 'typescript';
    return 'plaintext';
};

describe('external source URIs', () => {
    it('round-trips a capability and its display name', () => {
        const uri = externalResourceUri('cap-1', 'string_view');
        expect(uri).toBe('coc-lsp-external://cap-1/string_view');
        expect(parseExternalResourceUri(uri)).toEqual({ resourceId: 'cap-1', displayName: 'string_view' });
    });

    it('escapes a name that would otherwise break the URI', () => {
        const uri = externalResourceUri('cap/1', 'my header.hpp');
        expect(parseExternalResourceUri(uri)).toEqual({ resourceId: 'cap/1', displayName: 'my header.hpp' });
    });

    it.each([
        ['a workspace document', 'coc-file://ws-1/src/a.cpp'],
        ['a host path', 'file:///usr/include/c++/13/string_view'],
        ['an empty capability', 'coc-lsp-external:///string_view'],
        ['nothing at all', ''],
    ])('rejects %s', (_label, uri) => {
        expect(parseExternalResourceUri(uri)).toBeNull();
    });
});

describe('external source language', () => {
    it('uses the basename when it carries an extension', () => {
        expect(externalSourceLanguageId({ displayName: 'widget.hpp', languageHint: 'ts' }, language)).toBe('cpp');
    });

    it('falls back to the host hint for an extensionless standard-library header', () => {
        expect(externalSourceLanguageId({ displayName: 'string_view', languageHint: 'cpp' }, language)).toBe('cpp');
    });

    it('takes the hint as a language id when it is not a known extension', () => {
        expect(externalSourceLanguageId({ displayName: 'string_view', languageHint: 'rust' }, language)).toBe('rust');
    });

    it('stays plain text when nothing identifies the file', () => {
        expect(externalSourceLanguageId({ displayName: 'LICENSE' }, language)).toBe('plaintext');
    });
});
