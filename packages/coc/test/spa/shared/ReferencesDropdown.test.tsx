import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SHARED_DIR = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'shared'
);
const REPOS_DIR = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos'
);

const SOURCE = fs.readFileSync(path.join(SHARED_DIR, 'ReferencesDropdown.tsx'), 'utf-8');
const CHAT_HEADER_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'ChatHeader.tsx'), 'utf-8');

describe('ReferencesDropdown component', () => {
    it('exports ReferencesDropdown', () => {
        expect(SOURCE).toContain('export function ReferencesDropdown');
    });

    it('accepts planPath and files props', () => {
        expect(SOURCE).toContain('planPath?: string');
        expect(SOURCE).toContain('files?: { filePath: string }[]');
    });

    it('returns null when total is 0', () => {
        expect(SOURCE).toContain('if (total === 0) return null');
    });

    it('shows count badge in button label', () => {
        expect(SOURCE).toContain('References ({total}) ▾');
    });

    it('uses click-outside via useRef and useEffect', () => {
        expect(SOURCE).toContain('useRef');
        expect(SOURCE).toContain('useEffect');
        expect(SOURCE).toContain('mousedown');
    });

    it('renders plan file row with 📄 icon', () => {
        expect(SOURCE).toContain('📄');
        expect(SOURCE).toContain('planPath &&');
    });

    it('renders file rows from files prop', () => {
        expect(SOURCE).toContain('files?.map');
    });

    it('has data-testid on toggle button', () => {
        expect(SOURCE).toContain('data-testid="references-dropdown-btn"');
    });

    it('uses correct dropdown panel classes matching existing style', () => {
        expect(SOURCE).toContain('bg-[#252526]');
        expect(SOURCE).toContain('border border-[#3c3c3c]');
        expect(SOURCE).toContain('min-w-[260px]');
        expect(SOURCE).toContain('z-50');
    });
});

describe('ChatHeader uses ReferencesDropdown', () => {
    it('imports ReferencesDropdown', () => {
        expect(CHAT_HEADER_SOURCE).toContain('ReferencesDropdown');
    });

    it('no longer imports FilePathValue from PendingTaskPayload', () => {
        expect(CHAT_HEADER_SOURCE).not.toContain("import { FilePathValue }");
    });

    it('no longer imports CreatedFilesDropdown', () => {
        expect(CHAT_HEADER_SOURCE).not.toContain('CreatedFilesDropdown');
    });

    it('no longer renders inline planPath FilePathValue', () => {
        expect(CHAT_HEADER_SOURCE).not.toContain('<FilePathValue label="📄"');
    });

    it('renders a single ReferencesDropdown with planPath and files', () => {
        expect(CHAT_HEADER_SOURCE).toContain('<ReferencesDropdown planPath={planPath} files={createdFiles} />');
    });

    it('still keeps pinnedFile in props interface', () => {
        expect(CHAT_HEADER_SOURCE).toContain('pinnedFile');
    });
});
