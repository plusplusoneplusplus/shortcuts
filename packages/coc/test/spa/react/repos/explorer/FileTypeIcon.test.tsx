// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
    FileTypeIcon,
    getFileIconDescriptor,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/FileTypeIcon';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

afterEach(cleanup);

describe('getFileIconDescriptor', () => {
    it.each([
        ['component.tsx', 'TS', 'TypeScript'],
        ['worker.mjs', 'JS', 'JavaScript'],
        ['main.py', 'PY', 'Python'],
        ['server.go', 'GO', 'Go'],
        ['lib.rs', 'RS', 'Rust'],
        ['Main.java', 'J', 'Java'],
        ['native.cpp', 'C++', 'C++'],
        ['shader.sv', 'SV', 'SystemVerilog'],
        ['main.f90', 'FOR', 'Fortran'],
        ['styles.scss', 'S', 'Sass'],
        ['schema.graphql', 'GQL', 'GraphQL'],
        ['main.tf', 'TF', 'Terraform'],
        ['query.sql', 'SQL', 'SQL'],
        ['settings.yaml', 'YML', 'YAML'],
        ['guide.mdx', 'M↓', 'Markdown'],
        ['icon.svg', 'SVG', 'SVG'],
        ['archive.tar', 'ZIP', 'Archive'],
        ['module.wasm', 'WA', 'WebAssembly'],
    ])('classifies %s', (fileName, label, title) => {
        expect(getFileIconDescriptor(fileName)).toMatchObject({ label, title });
    });

    it.each([
        ['Dockerfile', 'DKR'],
        ['package.json', 'NPM'],
        ['Cargo.toml', 'RS'],
        ['go.mod', 'GO'],
        ['.gitignore', 'GIT'],
        ['LICENSE', 'LIC'],
        ['README', 'M↓'],
        ['README.md', 'M↓'],
        ['Dockerfile.dev', 'DKR'],
        ['.env.local', 'ENV'],
    ])('honours special file name %s', (fileName, label) => {
        expect(getFileIconDescriptor(fileName).label).toBe(label);
    });

    it('uses a neutral file icon for unknown and extensionless files', () => {
        expect(getFileIconDescriptor('unknown.custom-language').label).toBe('');
        expect(getFileIconDescriptor('AUTHORS').title).toBe('File');
    });
});

describe('FileTypeIcon', () => {
    const file = (name: string): TreeEntry => ({ name, type: 'file', path: name });
    const directory: TreeEntry = { name: 'src', type: 'dir', path: 'src' };

    it('renders the language badge and tooltip for a known file type', () => {
        render(<FileTypeIcon entry={file('component.tsx')} />);
        const rendered = screen.getByTestId('file-type-icon');
        expect(rendered).toHaveAttribute('data-icon-label', 'TS');
        expect(rendered).toHaveAttribute('title', 'TypeScript');
        expect(rendered).toHaveTextContent('TS');
    });

    it('renders a document SVG for an unknown file type', () => {
        render(<FileTypeIcon entry={file('AUTHORS')} />);
        const rendered = screen.getByTestId('file-type-icon');
        expect(rendered).toHaveAttribute('data-icon-label', 'file');
        expect(rendered.querySelector('svg')).not.toBeNull();
    });

    it('uses different folder icons for collapsed and expanded directories', () => {
        const view = render(<FileTypeIcon entry={directory} />);
        expect(screen.getByTestId('file-type-icon').querySelector('svg')).toHaveAttribute('data-icon-kind', 'folder');

        view.rerender(<FileTypeIcon entry={directory} expanded />);
        expect(screen.getByTestId('file-type-icon').querySelector('svg')).toHaveAttribute('data-icon-kind', 'folder-open');
    });
});
