/**
 * File-name banner rendering in the continuous (whole-commit) diff view.
 *
 * Covers both Unified and Split modes: the git preamble is replaced by one
 * banner row per file, the badge/counts/rename affordances render, the banner
 * is opt-in (whisper/tool-call diff surfaces are unaffected), and in-diff
 * Ctrl+F find still highlights exactly the right lines with the preamble gone.
 */

import { describe, it, expect } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import {
    UnifiedDiffViewer,
    computeDiffLines,
} from '../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import { SideBySideDiffViewer } from '../../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer';
import { parseFileBanners } from '../../../../src/server/spa/client/react/features/git/diff/fileBannerModel';
import { buildWhisperFileDiff } from '../../../../src/server/spa/client/react/features/chat/conversation/tool-calls/buildWhisperFileDiff';
import {
    computeDiffMatches,
    groupMatchesByLine,
} from '../../../../src/server/spa/client/react/features/git/diff/diffFindModel';

const MODIFIED_DIFF = `diff --git a/packages/coc-desktop/src/app-menu.ts b/packages/coc-desktop/src/app-menu.ts
index 2793a9ad6..8cd4f108a 100644
--- a/packages/coc-desktop/src/app-menu.ts
+++ b/packages/coc-desktop/src/app-menu.ts
@@ -1,3 +1,3 @@
 context line
-old menu line
+new menu line`;

const NEW_FILE_DIFF = `diff --git a/src/added.ts b/src/added.ts
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/src/added.ts
@@ -0,0 +1,1 @@
+brand new`;

const DELETED_DIFF = `diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index e69de29..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-was here`;

const RENAMED_DIFF = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 95%
rename from src/old-name.ts
rename to src/new-name.ts
index 2793a9a..8cd4f10 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,2 +1,2 @@
 keep
-was
+now`;

const BINARY_DIFF = `diff --git a/assets/logo.png b/assets/logo.png
index 2793a9a..8cd4f10 100644
Binary files a/assets/logo.png and b/assets/logo.png differ`;

const MULTI_FILE_DIFF = `${MODIFIED_DIFF}
${NEW_FILE_DIFF}`;

/** Every mode the banner must work in, so each case runs against both viewers. */
const VIEWERS = [
    { name: 'unified', Viewer: UnifiedDiffViewer },
    { name: 'split', Viewer: SideBySideDiffViewer },
] as const;

describe.each(VIEWERS)('file-name banner — $name mode', ({ Viewer }) => {
    it('replaces the git preamble with a single banner row', () => {
        const { container } = render(<Viewer diff={MODIFIED_DIFF} showFileBanners data-testid="diff" />);

        const banners = container.querySelectorAll('[data-testid="diff-file-banner"]');
        expect(banners).toHaveLength(1);

        // Every preamble line is gone from the rendered text.
        expect(container.textContent).not.toContain('diff --git');
        expect(container.textContent).not.toContain('index 2793a9ad6..8cd4f108a');
        expect(container.textContent).not.toContain('--- a/packages');
        expect(container.textContent).not.toContain('+++ b/packages');

        // Hunk header and change lines survive untouched.
        expect(container.textContent).toContain('@@ -1,3 +1,3 @@');
        expect(container.textContent).toContain('old menu line');
        expect(container.textContent).toContain('new menu line');
    });

    it('keeps the full path so it stays greppable, with the basename bold', () => {
        const { container } = render(<Viewer diff={MODIFIED_DIFF} showFileBanners data-testid="diff" />);
        const banner = container.querySelector<HTMLElement>('[data-testid="diff-file-banner"]')!;
        const path = banner.querySelector<HTMLElement>('[data-testid="diff-file-banner-path"]')!;

        expect(banner.textContent).toContain('packages/coc-desktop/src/');
        expect(banner.textContent).toContain('app-menu.ts');
        expect(path.children[0].className).toContain('block');
        expect(path.children[0].textContent).toBe('packages/coc-desktop/src/');
        expect(path.children[1].className).toContain('font-semibold');
        expect(path.children[1].textContent).toBe('app-menu.ts');
        expect(banner.getAttribute('data-file-path')).toBe('packages/coc-desktop/src/app-menu.ts');
    });

    it('renders the modified status badge', () => {
        const { container } = render(<Viewer diff={MODIFIED_DIFF} showFileBanners data-testid="diff" />);
        const banner = container.querySelector<HTMLElement>('[data-testid="diff-file-banner"]')!;
        const accent = banner.querySelector<HTMLElement>('[data-testid="diff-file-banner-accent"]')!;
        const badge = container.querySelector<HTMLElement>('[data-testid="diff-file-banner-status"]')!;
        expect(badge.textContent).toBe('modified');
        expect(badge.className).toContain('blue');
        expect(badge.className).toContain('rounded-full');
        expect(banner.className).toContain('bg-blue-50/80');
        expect(accent.className).toContain('bg-blue-600');
    });

    it('renders the new-file status badge', () => {
        const { container } = render(<Viewer diff={NEW_FILE_DIFF} showFileBanners data-testid="diff" />);
        const banner = container.querySelector<HTMLElement>('[data-testid="diff-file-banner"]')!;
        const accent = banner.querySelector<HTMLElement>('[data-testid="diff-file-banner-accent"]')!;
        const badge = container.querySelector<HTMLElement>('[data-testid="diff-file-banner-status"]')!;
        expect(badge.textContent).toBe('new file');
        expect(badge.className).toContain('emerald');
        expect(banner.className).toContain('bg-emerald-50/80');
        expect(accent.className).toContain('bg-emerald-600');
    });

    it('renders the deleted status badge', () => {
        const { container } = render(<Viewer diff={DELETED_DIFF} showFileBanners data-testid="diff" />);
        const banner = container.querySelector<HTMLElement>('[data-testid="diff-file-banner"]')!;
        const accent = banner.querySelector<HTMLElement>('[data-testid="diff-file-banner-accent"]')!;
        const badge = container.querySelector<HTMLElement>('[data-testid="diff-file-banner-status"]')!;
        expect(badge.textContent).toBe('deleted');
        expect(badge.className).toContain('rose');
        expect(banner.className).toContain('bg-rose-50/80');
        expect(accent.className).toContain('bg-rose-600');
    });

    it('renders the renamed badge with the old path, hidden on narrow widths', () => {
        const { container } = render(<Viewer diff={RENAMED_DIFF} showFileBanners data-testid="diff" />);
        const banner = container.querySelector<HTMLElement>('[data-testid="diff-file-banner"]')!;
        const accent = banner.querySelector<HTMLElement>('[data-testid="diff-file-banner-accent"]')!;
        const badge = container.querySelector<HTMLElement>('[data-testid="diff-file-banner-status"]')!;
        expect(badge.textContent).toBe('renamed');
        expect(badge.className).toContain('violet');
        expect(banner.className).toContain('bg-violet-50/80');
        expect(accent.className).toContain('bg-violet-600');

        const oldPath = container.querySelector<HTMLElement>('[data-testid="diff-file-banner-oldpath"]')!;
        expect(oldPath.textContent).toContain('src/old-name.ts');
        expect(oldPath.className).toContain('hidden');
        expect(oldPath.className).toContain('sm:inline');
    });

    it('renders a banner with no hunks for a binary file', () => {
        const { container } = render(<Viewer diff={BINARY_DIFF} showFileBanners data-testid="diff" />);
        expect(container.querySelectorAll('[data-testid="diff-file-banner"]')).toHaveLength(1);
        expect(container.querySelector('[data-testid="diff-file-banner-binary"]')).toBeTruthy();
        expect(container.textContent).not.toContain('Binary files a/assets');
        expect(container.textContent).not.toContain('diff --git');
        expect(container.querySelector('[data-hunk-header]')).toBeNull();
    });

    it('shows the per-file +N −M counts', () => {
        const { container } = render(<Viewer diff={MODIFIED_DIFF} showFileBanners data-testid="diff" />);
        const counts = container.querySelector<HTMLElement>('[data-testid="diff-file-banner-counts"]')!;
        expect(counts.textContent).toContain('+1');
        expect(counts.textContent).toContain('−1');
    });

    it('attributes counts per file in a multi-file diff', () => {
        const { container } = render(<Viewer diff={MULTI_FILE_DIFF} showFileBanners data-testid="diff" />);
        const banners = container.querySelectorAll<HTMLElement>('[data-testid="diff-file-banner"]');
        expect(banners).toHaveLength(2);
        expect(banners[0].getAttribute('data-file-path')).toBe('packages/coc-desktop/src/app-menu.ts');
        expect(banners[0].querySelector('[data-testid="diff-file-banner-counts"]')!.textContent).toContain('+1');
        expect(banners[1].getAttribute('data-file-path')).toBe('src/added.ts');
        expect(banners[1].querySelector('[data-testid="diff-file-banner-counts"]')!.textContent).toContain('+1');
        expect(banners[1].querySelector('[data-testid="diff-file-banner-counts"]')!.textContent).toContain('−0');
    });

    it('renders in-flow rows unstyled by sticky — the docked overlay does that job', () => {
        const { container } = render(<Viewer diff={MULTI_FILE_DIFF} showFileBanners data-testid="diff" />);
        for (const banner of container.querySelectorAll<HTMLElement>('[data-testid="diff-file-banner"]')) {
            expect(banner.className).not.toContain('sticky');
        }
    });

    it('keeps the horizontal scroller off the viewer root so the dock can be sticky', () => {
        // A sticky descendant of the horizontal scroller would anchor to a box
        // that never scrolls vertically and never engage, so the rows get their
        // own `overflow-x-auto` wrapper and the root stays a plain block.
        const { container } = render(<Viewer diff={MODIFIED_DIFF} showFileBanners data-testid="diff" />);
        const viewer = container.querySelector<HTMLElement>('[data-testid="diff"]')!;
        expect(viewer.className).not.toContain('overflow-x-auto');
        expect(viewer.className).not.toContain('overflow-y-clip');

        // The rows still scroll sideways for long lines.
        const banner = container.querySelector<HTMLElement>('[data-testid="diff-file-banner"]')!;
        const scroller = banner.closest('.overflow-x-auto');
        expect(scroller).toBeTruthy();
        expect(scroller!.parentElement).toBe(viewer);
    });

    it('leaves overflow untouched on the surfaces that opt out', () => {
        const { container } = render(<Viewer diff={MODIFIED_DIFF} data-testid="diff" />);
        const viewer = container.querySelector<HTMLElement>('[data-testid="diff"]')!;
        expect(viewer.className).toContain('overflow-x-auto');
        expect(viewer.className).not.toContain('overflow-y-clip');
    });

    it('shows the dropped blob hashes and mode in a real tooltip on hover', () => {
        const { container } = render(<Viewer diff={NEW_FILE_DIFF} showFileBanners data-testid="diff" />);
        const details = container.querySelector<HTMLElement>('[data-testid="diff-file-banner-details"]')!;
        expect(details.getAttribute('title')).toBeNull();
        expect(document.querySelector('[role="tooltip"]')).toBeNull();

        fireEvent.mouseEnter(details);

        const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
        expect(tooltip.textContent).toContain('index 0000000..e69de29');
        expect(tooltip.textContent).toContain('mode 100644');
        expect(details.getAttribute('aria-describedby')).toBe(tooltip.id);

        fireEvent.mouseLeave(details);
        expect(document.querySelector('[role="tooltip"]')).toBeNull();
    });

    it('shows the details tooltip for keyboard focus and hides it on blur', () => {
        const { container } = render(<Viewer diff={NEW_FILE_DIFF} showFileBanners data-testid="diff" />);
        const details = container.querySelector<HTMLButtonElement>('[data-testid="diff-file-banner-details"]')!;

        expect(details.tagName).toBe('BUTTON');
        expect(details.getAttribute('aria-label')).toBe('Show Git file details');

        fireEvent.focus(details);
        expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('mode 100644');

        fireEvent.blur(details);
        expect(document.querySelector('[role="tooltip"]')).toBeNull();
    });

    it('renders no banner and keeps existing behavior when the prop is off', () => {
        const { container } = render(<Viewer diff={MODIFIED_DIFF} data-testid="diff" />);
        expect(container.querySelector('[data-testid="diff-file-banner"]')).toBeNull();
        expect(container.textContent).toContain('@@ -1,3 +1,3 @@');
    });
});

// ============================================================================
// Unified-mode specifics: preamble rows are suppressed without renumbering
// ============================================================================

describe('file-name banner — unified line indices', () => {
    it('leaves every remaining row at its original diff-line index', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={MODIFIED_DIFF} showFileBanners enableComments data-testid="diff" />
        );
        // Preamble rows 1-3 are gone; the `@@` stays at 4 and content at 5-7.
        for (const gone of [1, 2, 3]) {
            expect(container.querySelector(`[data-diff-line-index="${gone}"]`)).toBeNull();
        }
        expect(container.querySelector('[data-diff-line-index="4"]')!.textContent).toContain('@@ -1,3 +1,3 @@');
        expect(container.querySelector('[data-diff-line-index="5"]')!.textContent).toContain('context line');
        expect(container.querySelector('[data-diff-line-index="6"]')!.textContent).toContain('old menu line');
        expect(container.querySelector('[data-diff-line-index="7"]')!.textContent).toContain('new menu line');
    });

    it('renders the raw preamble when showFileBanners is off', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={MODIFIED_DIFF} enableComments data-testid="diff" />
        );
        expect(container.querySelector('[data-diff-line-index="0"]')!.textContent).toContain('diff --git');
        expect(container.querySelector('[data-diff-line-index="1"]')!.textContent).toContain('index 2793a9ad6');
    });
});

// ============================================================================
// Ctrl+F find alignment with the preamble suppressed
// ============================================================================

describe('file-name banner — in-diff find still lines up', () => {
    // `useDiffFind` searches the FULL diff model; the banner only changes what
    // is rendered, so the match set must be byte-identical either way.
    const findRanges = (diff: string, query: string) => {
        const diffLines = computeDiffLines(diff.split('\n'));
        const matches = computeDiffMatches(diffLines, query, false);
        return { matches, ranges: groupMatchesByLine(matches, 0) };
    };

    it('finds the same matches whether or not banners are shown', () => {
        const { matches } = findRanges(MULTI_FILE_DIFF, 'menu');
        // Only code content is searchable — never the preamble the banner replaces.
        expect(matches.map(m => m.lineIndex)).toEqual([6, 7]);
    });

    it('never matches inside the suppressed preamble', () => {
        // `app-menu.ts` appears in the preamble 3 times, but find targets code only.
        const { matches } = findRanges(MODIFIED_DIFF, 'app-menu.ts');
        expect(matches).toHaveLength(0);
    });

    it.each(VIEWERS)('highlights the matched lines in $name mode', ({ Viewer }) => {
        const { ranges } = findRanges(MULTI_FILE_DIFF, 'menu');
        const { container } = render(
            <Viewer diff={MULTI_FILE_DIFF} showFileBanners matchRangesByLine={ranges} data-testid="diff" />
        );
        const marks = Array.from(container.querySelectorAll('mark'))
            .filter(m => m.textContent === 'menu');
        // One highlight for the removed line, one for the added line.
        expect(marks).toHaveLength(2);
    });

    it.each(VIEWERS)('highlights the same lines with banners off in $name mode', ({ Viewer }) => {
        const { ranges } = findRanges(MULTI_FILE_DIFF, 'menu');
        const withBanners = render(
            <Viewer diff={MULTI_FILE_DIFF} showFileBanners matchRangesByLine={ranges} data-testid="a" />
        );
        const withoutBanners = render(
            <Viewer diff={MULTI_FILE_DIFF} matchRangesByLine={ranges} data-testid="b" />
        );
        const texts = (c: HTMLElement) =>
            Array.from(c.querySelectorAll('mark')).map(m => m.textContent).filter(t => t === 'menu');
        expect(texts(withBanners.container)).toEqual(texts(withoutBanners.container));
    });

    it('anchors the highlight on the correct row after suppression', () => {
        const { ranges } = findRanges(MULTI_FILE_DIFF, 'brand');
        const { container } = render(
            <UnifiedDiffViewer diff={MULTI_FILE_DIFF} showFileBanners matchRangesByLine={ranges} data-testid="diff" />
        );
        // "brand new" is the last line of the second file section.
        const lastIdx = MULTI_FILE_DIFF.split('\n').length - 1;
        const row = container.querySelector<HTMLElement>(`[data-diff-line-index="${lastIdx}"]`)!;
        expect(row.querySelector('mark')!.textContent).toBe('brand');
    });
});

// ============================================================================
// Banner geometry matches the parse model
// ============================================================================

describe('file-name banner — model/render agreement', () => {
    it('renders exactly one banner per parsed file section', () => {
        const parsed = parseFileBanners(MULTI_FILE_DIFF.split('\n'));
        const { container } = render(
            <UnifiedDiffViewer diff={MULTI_FILE_DIFF} showFileBanners data-testid="diff" />
        );
        expect(container.querySelectorAll('[data-testid="diff-file-banner"]')).toHaveLength(parsed.length);
    });

    it('tags each banner with the status the model derived', () => {
        const parsed = parseFileBanners(MULTI_FILE_DIFF.split('\n'));
        const { container } = render(
            <UnifiedDiffViewer diff={MULTI_FILE_DIFF} showFileBanners data-testid="diff" />
        );
        const rendered = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="diff-file-banner"]'))
            .map(el => el.getAttribute('data-file-banner-status'));
        expect(rendered).toEqual(parsed.map(b => b.status));
    });
});

// ============================================================================
// hideFileHeaders — single-file panel drops the preamble outright
// ============================================================================

describe('hideFileHeaders — single-file diff surfaces', () => {
    it('renders new-file patch content when the captured patch has no hunk header', () => {
        const patch = [
            '*** Begin Patch',
            '*** Add File: src/probe.cjs',
            '+const answer = 42;',
            '+console.log(answer);',
            '*** End Patch',
        ].join('\n');
        const diff = buildWhisperFileDiff([
            { toolName: 'apply_patch', args: { patch } },
        ], 'src/probe.cjs')!;
        const { container } = render(
            <UnifiedDiffViewer diff={diff} fileName="probe.cjs" hideFileHeaders showLineNumbers />
        );
        expect(container.textContent).toContain('const answer = 42;');
        expect(container.textContent).toContain('console.log(answer);');
        expect(container.textContent).toContain('@@ -0,0 +1,2 @@');
        expect(container.textContent).not.toContain('diff --git');
        expect(container.textContent).not.toContain('new file mode');
        expect(computeDiffLines(diff.split('\n')).filter(line => line.type === 'added')
            .map(line => line.newLine)).toEqual([1, 2]);
    });

    it('drops the whole git preamble with nothing in its place', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={MODIFIED_DIFF} hideFileHeaders data-testid="diff" />
        );

        expect(container.textContent).not.toContain('diff --git');
        expect(container.textContent).not.toContain('index 2793a9ad6..8cd4f108a');
        expect(container.textContent).not.toContain('--- a/packages');
        expect(container.textContent).not.toContain('+++ b/packages');
        // No banner row either — the panel header already names the file.
        expect(container.querySelector('[data-testid="diff-file-banner"]')).toBeNull();

        expect(container.textContent).toContain('@@ -1,3 +1,3 @@');
        expect(container.textContent).toContain('old menu line');
        expect(container.textContent).toContain('new menu line');
    });

    it('also drops preamble lines git leaves unprefixed (similarity/rename)', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={RENAMED_DIFF} hideFileHeaders data-testid="diff" />
        );
        expect(container.textContent).not.toContain('similarity index');
        expect(container.textContent).not.toContain('rename from');
        expect(container.textContent).not.toContain('rename to');
        expect(container.textContent).toContain('keep');
    });

    it('keeps diff-line indices intact so comment anchors still line up', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={MODIFIED_DIFF} hideFileHeaders data-testid="diff" />
        );
        // Row 7 is `+new menu line` in the raw diff; hiding rows 0-3 must not renumber it.
        const row = container.querySelector<HTMLElement>('[data-diff-line-index="7"]')!;
        expect(row.textContent).toContain('new menu line');
        expect(container.querySelector('[data-diff-line-index="0"]')).toBeNull();
    });

    it('leaves the preamble visible when the prop is off', () => {
        const { container } = render(<UnifiedDiffViewer diff={MODIFIED_DIFF} data-testid="diff" />);
        expect(container.textContent).toContain('diff --git');
    });
});
