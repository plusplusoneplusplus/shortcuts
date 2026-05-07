import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
    resolve(__dirname, '../../../../src/server/spa/client/react/features/notes/editor/noteEditor.css'),
    'utf-8',
);

function expectRule(pattern: RegExp): string {
    const match = css.match(pattern);
    expect(match).toBeTruthy();
    return match![1];
}

describe('note link visual styles', () => {
    it('styles editor and read-only note links as link-colored chips', () => {
        const body = expectRule(
            /\.note-editor\s+\.ProseMirror\s+\.note-link,\s*\.markdown-body\s+\.note-link\s*\{([^}]+)\}/,
        );

        expect(body).toContain('color: var(--vscode-textLink-foreground, #4ea6ea)');
        expect(body).toContain('text-decoration: none');
        expect(body).toContain('background-color: rgba(78, 166, 234, 0.10)');
        expect(body).toContain('border: 1px solid rgba(78, 166, 234, 0.45)');
        expect(body).toContain('border-radius: 4px');
        expect(body).toContain('padding: 1px 6px 1px 4px');
        expect(body).toContain('font-weight: 500');
        expect(body).not.toContain('text-decoration: underline');
    });

    it('adds the note glyph through the shared pseudo-element', () => {
        const body = expectRule(
            /\.note-editor\s+\.ProseMirror\s+\.note-link::before,\s*\.markdown-body\s+\.note-link::before\s*\{([^}]+)\}/,
        );

        expect(body).toContain('content: "⎋ "');
    });

    it('brightens background and border on hover in both scopes', () => {
        const body = expectRule(
            /\.note-editor\s+\.ProseMirror\s+\.note-link:hover,\s*\.markdown-body\s+\.note-link:hover\s*\{([^}]+)\}/,
        );

        expect(body).toContain('background-color: rgba(78, 166, 234, 0.16)');
        expect(body).toContain('border-color: rgba(78, 166, 234, 0.65)');
    });

    it('uses dark-mode chip colors for editor and read-only note links', () => {
        const body = expectRule(
            /\.dark\s+\.note-editor\s+\.ProseMirror\s+\.note-link,\s*\.dark\s+\.markdown-body\s+\.note-link\s*\{([^}]+)\}/,
        );
        const hoverBody = expectRule(
            /\.dark\s+\.note-editor\s+\.ProseMirror\s+\.note-link:hover,\s*\.dark\s+\.markdown-body\s+\.note-link:hover\s*\{([^}]+)\}/,
        );

        expect(body).toContain('background-color: rgba(78, 166, 234, 0.14)');
        expect(body).toContain('border-color: rgba(78, 166, 234, 0.40)');
        expect(hoverBody).toContain('background-color: rgba(78, 166, 234, 0.20)');
        expect(hoverBody).toContain('border-color: rgba(78, 166, 234, 0.65)');
    });

    it('keeps file references and normal editor links visually separate', () => {
        const fileRefBody = expectRule(
            /\.note-editor\s+\.ProseMirror\s+\.file-ref-link\s*\{([^}]+)\}/,
        );
        const anchorBody = expectRule(
            /\.note-editor\s+\.ProseMirror\s+a\s*\{([^}]+)\}/,
        );

        expect(fileRefBody).toContain('font-family: ui-monospace');
        expect(fileRefBody).toContain('border: 1px solid #c8c8c8');
        expect(anchorBody).toContain('text-decoration: underline');
        expect(anchorBody).not.toContain('background-color: rgba(78, 166, 234');
    });
});
