import type { CSSProperties } from 'react';
import type { TreeEntry } from './types';

export interface FileIconDescriptor {
    label: string;
    color: string;
    title: string;
}

const icon = (label: string, color: string, title: string): FileIconDescriptor => ({ label, color, title });

const EXTENSION_ICONS: Record<string, FileIconDescriptor> = {};

function register(extensions: string[], descriptor: FileIconDescriptor) {
    for (const extension of extensions) EXTENSION_ICONS[extension] = descriptor;
}

register(['ts', 'tsx', 'mts', 'cts'], icon('TS', '#3178c6', 'TypeScript'));
register(['js', 'jsx', 'mjs', 'cjs'], icon('JS', '#c9a227', 'JavaScript'));
register(['py', 'pyw', 'pyi'], icon('PY', '#3572a5', 'Python'));
register(['rb', 'rake', 'gemspec'], icon('RB', '#cc342d', 'Ruby'));
register(['php', 'phtml'], icon('PHP', '#777bb4', 'PHP'));
register(['java', 'class', 'jar'], icon('J', '#e76f00', 'Java'));
register(['kt', 'kts'], icon('KT', '#7f52ff', 'Kotlin'));
register(['scala', 'sc'], icon('SC', '#dc322f', 'Scala'));
register(['swift'], icon('SW', '#f05138', 'Swift'));
register(['go'], icon('GO', '#00add8', 'Go'));
register(['rs'], icon('RS', '#ce422b', 'Rust'));
register(['c', 'h'], icon('C', '#659ad2', 'C'));
register(['cc', 'cpp', 'cxx', 'hh', 'hpp', 'hxx'], icon('C++', '#00599c', 'C++'));
register(['cs', 'csx'], icon('C#', '#68217a', 'C#'));
register(['fs', 'fsi', 'fsx'], icon('F#', '#378bba', 'F#'));
register(['vb', 'vbs'], icon('VB', '#945db7', 'Visual Basic'));
register(['dart'], icon('DT', '#0175c2', 'Dart'));
register(['lua'], icon('LUA', '#51a0cf', 'Lua'));
register(['r', 'rmd'], icon('R', '#276dc3', 'R'));
register(['ex', 'exs'], icon('EX', '#6e4a7e', 'Elixir'));
register(['erl', 'hrl'], icon('ERL', '#a90533', 'Erlang'));
register(['hs', 'lhs'], icon('HS', '#5d4f85', 'Haskell'));
register(['clj', 'cljs', 'cljc', 'edn'], icon('CLJ', '#63b132', 'Clojure'));
register(['groovy', 'gradle'], icon('GV', '#4298b8', 'Groovy'));
register(['pl', 'pm', 't'], icon('PL', '#39457e', 'Perl'));
register(['sol'], icon('SOL', '#627eea', 'Solidity'));
register(['zig'], icon('ZIG', '#f7a41d', 'Zig'));
register(['nim', 'nims'], icon('NIM', '#d6a800', 'Nim'));
register(['ml', 'mli'], icon('ML', '#ec6813', 'OCaml'));
register(['jl'], icon('JL', '#9558b2', 'Julia'));
register(['m', 'mm'], icon('OC', '#438eff', 'Objective-C'));
register(['cr'], icon('CR', '#7e7e7e', 'Crystal'));
register(['elm'], icon('ELM', '#1293d8', 'Elm'));
register(['coffee', 'litcoffee'], icon('CF', '#6f4e37', 'CoffeeScript'));
register(['pas', 'pp', 'inc'], icon('PAS', '#e3a21a', 'Pascal'));
register(['d'], icon('D', '#b03931', 'D'));
register(['vala', 'vapi'], icon('VA', '#7b4f9d', 'Vala'));
register(['cob', 'cbl'], icon('COB', '#005ca5', 'COBOL'));
register(['f', 'f77', 'f90', 'f95', 'f03'], icon('FOR', '#734f96', 'Fortran'));
register(['asm', 's'], icon('ASM', '#6e4c13', 'Assembly'));
register(['v', 'vh'], icon('V', '#b2b7f8', 'Verilog'));
register(['sv', 'svh'], icon('SV', '#b2b7f8', 'SystemVerilog'));
register(['vhd', 'vhdl'], icon('VHD', '#adb2cb', 'VHDL'));
register(['vue'], icon('VUE', '#42b883', 'Vue'));
register(['svelte'], icon('SV', '#ff3e00', 'Svelte'));
register(['astro'], icon('AS', '#ff5d01', 'Astro'));

register(['html', 'htm'], icon('5', '#e34f26', 'HTML'));
register(['css'], icon('3', '#1572b6', 'CSS'));
register(['scss', 'sass'], icon('S', '#cc6699', 'Sass'));
register(['less'], icon('LS', '#1d365d', 'Less'));
register(['styl'], icon('ST', '#8dc149', 'Stylus'));
register(['xml', 'xsl', 'xslt', 'xsd'], icon('<>', '#e37933', 'XML'));
register(['graphql', 'gql'], icon('GQL', '#e10098', 'GraphQL'));
register(['sql', 'ddl', 'dml'], icon('SQL', '#336791', 'SQL'));
register(['tf', 'tfvars'], icon('TF', '#7b42bc', 'Terraform'));
register(['hcl'], icon('HCL', '#7b42bc', 'HashiCorp Configuration Language'));
register(['nix'], icon('NIX', '#5277c3', 'Nix'));
register(['tex', 'sty', 'cls', 'bib'], icon('TEX', '#008080', 'TeX'));

register(['json', 'jsonc', 'json5'], icon('{}', '#cbcb41', 'JSON'));
register(['yaml', 'yml'], icon('YML', '#cb171e', 'YAML'));
register(['toml'], icon('TOM', '#9c4121', 'TOML'));
register(['ini', 'cfg', 'conf', 'config', 'properties'], icon('CFG', '#6b7280', 'Configuration'));
register(['env'], icon('ENV', '#ecd53f', 'Environment'));
register(['md', 'markdown', 'mdx'], icon('M↓', '#519aba', 'Markdown'));
register(['txt', 'text', 'log'], icon('TXT', '#6b7280', 'Text'));
register(['csv', 'tsv'], icon('CSV', '#217346', 'Delimited data'));
register(['proto'], icon('PB', '#4285f4', 'Protocol Buffers'));

register(['sh', 'bash', 'zsh', 'fish', 'command'], icon('$_', '#4eaa25', 'Shell'));
register(['ps1', 'psm1', 'psd1'], icon('PS', '#2671be', 'PowerShell'));
register(['bat', 'cmd'], icon('BAT', '#4d4d4d', 'Windows command script'));

register(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'tif', 'tiff'], icon('IMG', '#a074c4', 'Image'));
register(['svg'], icon('SVG', '#ffb13b', 'SVG'));
register(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'], icon('AUD', '#c65dba', 'Audio'));
register(['mp4', 'mov', 'avi', 'mkv', 'webm'], icon('VID', '#e5534b', 'Video'));
register(['pdf'], icon('PDF', '#e53935', 'PDF'));
register(['doc', 'docx', 'odt'], icon('DOC', '#2b579a', 'Document'));
register(['xls', 'xlsx', 'ods'], icon('XLS', '#217346', 'Spreadsheet'));
register(['ppt', 'pptx', 'odp'], icon('PPT', '#d24726', 'Presentation'));
register(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar'], icon('ZIP', '#a68b5b', 'Archive'));
register(['woff', 'woff2', 'ttf', 'otf', 'eot'], icon('Aa', '#607d8b', 'Font'));
register(['sqlite', 'sqlite3', 'db'], icon('DB', '#336791', 'Database'));
register(['wasm'], icon('WA', '#654ff0', 'WebAssembly'));

const EXACT_NAME_ICONS: Record<string, FileIconDescriptor> = {
    dockerfile: icon('DKR', '#2496ed', 'Docker'),
    'docker-compose.yml': icon('DKR', '#2496ed', 'Docker Compose'),
    'docker-compose.yaml': icon('DKR', '#2496ed', 'Docker Compose'),
    makefile: icon('MK', '#6d8086', 'Makefile'),
    'cmakelists.txt': icon('CM', '#064f8c', 'CMake'),
    gemfile: icon('RB', '#cc342d', 'Ruby Gemfile'),
    rakefile: icon('RB', '#cc342d', 'Ruby Rakefile'),
    procfile: icon('PRC', '#79589f', 'Procfile'),
    'package.json': icon('NPM', '#cb3837', 'npm package'),
    'package-lock.json': icon('NPM', '#cb3837', 'npm lockfile'),
    'yarn.lock': icon('YRN', '#2c8ebb', 'Yarn lockfile'),
    'pnpm-lock.yaml': icon('PN', '#f69220', 'pnpm lockfile'),
    'bun.lock': icon('BUN', '#a56a43', 'Bun lockfile'),
    'bun.lockb': icon('BUN', '#a56a43', 'Bun lockfile'),
    'cargo.toml': icon('RS', '#ce422b', 'Cargo manifest'),
    'cargo.lock': icon('RS', '#ce422b', 'Cargo lockfile'),
    'go.mod': icon('GO', '#00add8', 'Go module'),
    'go.sum': icon('GO', '#00add8', 'Go checksum'),
    '.gitignore': icon('GIT', '#f05032', 'Git ignore'),
    '.gitattributes': icon('GIT', '#f05032', 'Git attributes'),
    '.gitmodules': icon('GIT', '#f05032', 'Git modules'),
    '.editorconfig': icon('EC', '#6b7280', 'EditorConfig'),
    license: icon('LIC', '#d4af37', 'License'),
    'license.md': icon('LIC', '#d4af37', 'License'),
    'license.txt': icon('LIC', '#d4af37', 'License'),
};

const GENERIC_FILE_ICON = icon('', '#8a8a8a', 'File');

export function getFileIconDescriptor(fileName: string): FileIconDescriptor {
    const name = fileName.toLowerCase();
    const exact = EXACT_NAME_ICONS[name];
    if (exact) return exact;
    if (/^(readme|changelog|contributing)(\..+)?$/.test(name)) return EXTENSION_ICONS.md;
    if (name === 'dockerfile' || name.startsWith('dockerfile.')) return EXACT_NAME_ICONS.dockerfile;
    if (name.startsWith('.env')) return EXTENSION_ICONS.env;
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
    return EXTENSION_ICONS[extension] ?? GENERIC_FILE_ICON;
}

function FolderIcon({ expanded }: { expanded: boolean }) {
    return (
        <svg
            aria-hidden="true"
            data-icon-kind={expanded ? 'folder-open' : 'folder'}
            viewBox="0 0 20 20"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {expanded
                ? <path d="M2.5 6.5h5l1.5 2h8.5l-2 7h-13zM2.5 6.5V4.3h5l1.5 2h6.5v2.2" />
                : <path d="M2.5 5h5l1.5 2h8.5v8.5h-15z" />}
        </svg>
    );
}

function GenericFileIcon({ style }: { style: CSSProperties }) {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
            style={style}
        >
            <path d="M5 2.5h6l4 4v11H5z" />
            <path d="M11 2.5v4h4" />
        </svg>
    );
}

export interface FileNameIconProps {
    fileName: string;
    showTitle?: boolean;
    testId?: string;
}

export function FileNameIcon({
    fileName,
    showTitle = true,
    testId = 'file-type-icon',
}: FileNameIconProps) {
    const descriptor = getFileIconDescriptor(fileName);
    const style = { color: descriptor.color };
    return (
        <span
            aria-hidden="true"
            className="inline-flex h-4 w-5 flex-shrink-0 items-center justify-center font-mono text-[9px] font-semibold leading-none"
            style={style}
            title={showTitle ? descriptor.title : undefined}
            data-testid={testId}
            data-icon-label={descriptor.label || 'file'}
        >
            {descriptor.label || <GenericFileIcon style={style} />}
        </span>
    );
}

export function FileTypeIcon({ entry, expanded = false }: { entry: TreeEntry; expanded?: boolean }) {
    if (entry.type === 'dir') {
        return (
            <span className="inline-flex h-4 w-5 items-center justify-center text-[#8a8a8a]" data-testid="file-type-icon">
                <FolderIcon expanded={expanded} />
            </span>
        );
    }

    return <FileNameIcon fileName={entry.name} />;
}
