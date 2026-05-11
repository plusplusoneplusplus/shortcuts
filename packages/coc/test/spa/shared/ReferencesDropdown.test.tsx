import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SHARED_DIR = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'ui'
);
const CHAT_DIR = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'chat'
);

const SOURCE = fs.readFileSync(path.join(SHARED_DIR, 'ReferencesDropdown.tsx'), 'utf-8');
const CHAT_HEADER_SOURCE = fs.readFileSync(path.join(CHAT_DIR, 'ChatHeader.tsx'), 'utf-8');

describe('ReferencesDropdown component', () => {
    it('exports ReferencesDropdown', () => {
        expect(SOURCE).toContain('export function ReferencesDropdown');
    });

    it('exports ReferenceList for reuse', () => {
        expect(SOURCE).toContain('export function ReferenceList');
    });

    it('accepts planPath and files props', () => {
        expect(SOURCE).toContain('planPath?: string');
        expect(SOURCE).toContain('files?: { filePath: string }[]');
    });

    it('returns null when total is 0', () => {
        expect(SOURCE).toContain('if (total === 0) return null');
    });

    it('shows count badge in button label', () => {
        // Redesign splits the label into separate spans: "References", count chip, caret
        expect(SOURCE).toContain('<span>References</span>');
        expect(SOURCE).toContain('{total}');
        expect(SOURCE).toContain('▾');
    });

    it('uses click-outside via useRef and useEffect', () => {
        expect(SOURCE).toContain('useRef');
        expect(SOURCE).toContain('useEffect');
        expect(SOURCE).toContain('mousedown');
    });

    it('renders plan file row with no emoji (uses text icon label instead)', () => {
        expect(SOURCE).not.toContain('📄');
        expect(SOURCE).toContain('aria-hidden="true"');
        expect(SOURCE).toContain('planPath &&');
    });

    it('renders file rows from files prop', () => {
        expect(SOURCE).toContain('uniqueFiles.map');
    });

    it('has data-testid on toggle button', () => {
        expect(SOURCE).toContain('data-testid="references-dropdown-btn"');
    });

    it('renders the redesigned button with count chip + caret separators', () => {
        // Button text is split into label / count / caret spans for the redesign
        expect(SOURCE).toContain('<span>References</span>');
        expect(SOURCE).toContain('▾');
        expect(SOURCE).toContain('aria-haspopup="dialog"');
    });

    it('uses correct dropdown panel classes supporting light and dark mode', () => {
        expect(SOURCE).toContain('bg-white');
        expect(SOURCE).toContain('dark:bg-[#252526]');
        expect(SOURCE).toContain('dark:border-[#3c3c3c]');
        // New design uses a fixed 520px popover at sm+ instead of min-w-[420px]
        expect(SOURCE).toContain('sm:w-[520px]');
        expect(SOURCE).toContain('z-50');
    });

    it('renders header + footer chrome around the list', () => {
        // Header has the "References" title + subtitle + count pill
        expect(SOURCE).toContain('<h2');
        expect(SOURCE).toContain('References');
        // Footer hints at the planPath + .md/.txt/.yaml/.yml/.json source
        expect(SOURCE).toContain('From planPath + .md/.txt/.yaml/.yml/.json writes');
        expect(SOURCE).toContain('Scratchpad .md files are excluded');
    });

    it('classifies items as plan vs pinned for icon and pill styling', () => {
        expect(SOURCE).toContain("kind=\"plan\"");
        expect(SOURCE).toContain("kind=\"pinned\"");
    });
});

describe('ChatHeader uses ReferencesDropdown', () => {
    it('imports ReferencesDropdown', () => {
        expect(CHAT_HEADER_SOURCE).toContain('ReferencesDropdown');
    });

    it('does not import FilePathValue (inline pill removed)', () => {
        expect(CHAT_HEADER_SOURCE).not.toContain("import { FilePathValue }");
    });

    it('no longer imports CreatedFilesDropdown', () => {
        expect(CHAT_HEADER_SOURCE).not.toContain('CreatedFilesDropdown');
    });

    it('does not render inline planPath FilePathValue pill', () => {
        expect(CHAT_HEADER_SOURCE).not.toContain('<FilePathValue label="📄"');
    });

    it('renders a single ReferencesDropdown with planPath and files in wide mode', () => {
        expect(CHAT_HEADER_SOURCE).toContain('<ReferencesDropdown planPath={planPath} files={createdFiles} wsId={wsId} />');
    });

    it('still keeps pinnedFile in props interface', () => {
        expect(CHAT_HEADER_SOURCE).toContain('pinnedFile');
    });

    it('imports ReferenceList from ReferencesDropdown', () => {
        expect(CHAT_HEADER_SOURCE).toContain('ReferenceList');
    });

    it('imports BottomSheet for standalone mobile refs sheet', () => {
        expect(CHAT_HEADER_SOURCE).toContain("import { BottomSheet }");
    });

    it('has refsSheetOpen state for mobile refs BottomSheet', () => {
        expect(CHAT_HEADER_SOURCE).toContain('refsSheetOpen');
        expect(CHAT_HEADER_SOURCE).toContain('setRefsSheetOpen');
    });

    it('closes refs sheet on coc-open-markdown-review event', () => {
        expect(CHAT_HEADER_SOURCE).toContain("window.addEventListener('coc-open-markdown-review'");
    });

    it('renders standalone BottomSheet with ReferenceList on mobile', () => {
        expect(CHAT_HEADER_SOURCE).toContain('<BottomSheet');
        expect(CHAT_HEADER_SOURCE).toContain('<ReferenceList planPath={planPath} files={createdFiles} />');
    });

    it('uses onClick (not render) for references overflow item on mobile', () => {
        expect(CHAT_HEADER_SOURCE).toContain('props.isMobile && props.onOpenRefs');
    });
});
