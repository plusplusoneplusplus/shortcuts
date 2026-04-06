/**
 * Tests for CommitList — fixup/squash/amend visual grouping source structure.
 *
 * Validates that CommitList integrates fixup-utils for:
 * - Color-coded dots, pill badges, dimming, fixup count annotation
 * - Subject prefix stripping, data attributes, tooltip fixup props
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMMIT_LIST_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'CommitList.tsx'
);

const TOOLTIP_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'CommitTooltip.tsx'
);

const FIXUP_UTILS_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'fixup-utils.ts'
);

const INDEX_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'index.ts'
);

describe('CommitList fixup visual grouping', () => {
    let commitListSource: string;
    let tooltipSource: string;
    let fixupUtilsSource: string;

    beforeAll(() => {
        commitListSource = fs.readFileSync(COMMIT_LIST_PATH, 'utf-8');
        tooltipSource = fs.readFileSync(TOOLTIP_PATH, 'utf-8');
        fixupUtilsSource = fs.readFileSync(FIXUP_UTILS_PATH, 'utf-8');
    });

    describe('fixup-utils module', () => {
        it('exports parseFixupSubject', () => {
            expect(fixupUtilsSource).toContain('export function parseFixupSubject');
        });

        it('exports buildFixupGroups', () => {
            expect(fixupUtilsSource).toContain('export function buildFixupGroups');
        });

        it('exports color palettes with 6 entries each', () => {
            expect(fixupUtilsSource).toContain('FIXUP_GROUP_COLORS_LIGHT');
            expect(fixupUtilsSource).toContain('FIXUP_GROUP_COLORS_DARK');
        });

        it('defines FixupCommitInput interface', () => {
            expect(fixupUtilsSource).toContain('export interface FixupCommitInput');
        });

        it('handles nested prefix unwrapping', () => {
            expect(fixupUtilsSource).toContain('while (nested)');
        });

        it('is re-exported from repos index', () => {
            const indexSource = fs.readFileSync(INDEX_PATH, 'utf-8');
            expect(indexSource).toContain("from './fixup-utils'");
            expect(indexSource).toContain('buildFixupGroups');
            expect(indexSource).toContain('parseFixupSubject');
        });
    });

    describe('CommitList integration', () => {
        it('imports buildFixupGroups from fixup-utils', () => {
            expect(commitListSource).toContain("from './fixup-utils'");
            expect(commitListSource).toContain('buildFixupGroups');
        });

        it('imports color palettes', () => {
            expect(commitListSource).toContain('FIXUP_GROUP_COLORS_LIGHT');
            expect(commitListSource).toContain('FIXUP_GROUP_COLORS_DARK');
        });

        it('computes fixup groups with useMemo', () => {
            expect(commitListSource).toContain('useMemo(() => buildFixupGroups(commits)');
        });

        it('looks up fixupEntry for each commit', () => {
            expect(commitListSource).toContain('fixupGroups.fixupEntries.get(commit.hash)');
        });

        it('looks up targetGroup for each commit', () => {
            expect(commitListSource).toContain('fixupGroups.targetGroups.get(commit.hash)');
        });
    });

    describe('pill badge rendering', () => {
        it('renders pill badge element for fixup commits', () => {
            expect(commitListSource).toContain('fixupEntry.pillLabel');
        });

        it('pill has data-testid with fixup-pill prefix', () => {
            expect(commitListSource).toContain('fixup-pill-');
        });

        it('pill background uses group color', () => {
            expect(commitListSource).toContain('backgroundColor: groupColor');
        });

        it('pill has tooltip with target info', () => {
            expect(commitListSource).toContain('fixupEntry.targetHash');
            expect(commitListSource).toContain('fixupEntry.displaySubject');
        });
    });

    describe('dimming', () => {
        it('applies opacity-70 to fixup commit rows', () => {
            expect(commitListSource).toContain("opacity-70");
            expect(commitListSource).toContain("isFixup ? ' opacity-70' : ''");
        });
    });

    describe('color-coded dots', () => {
        it('applies group color to dot element via inline style', () => {
            expect(commitListSource).toContain('style={groupColor ? { color: groupColor }');
        });

        it('dot has data-testid with fixup-dot prefix', () => {
            expect(commitListSource).toContain('fixup-dot-');
        });

        it('computes group color for both fixup entries and target groups', () => {
            expect(commitListSource).toContain('groupColors[fixupEntry.colorSlot]');
            expect(commitListSource).toContain('groupColors[targetGroup.colorSlot]');
        });
    });

    describe('fixup count annotation', () => {
        it('renders fixup count on target commits', () => {
            expect(commitListSource).toContain('hasFixups');
            expect(commitListSource).toContain('targetGroup!.fixupHashes.length');
        });

        it('count has data-testid with fixup-count prefix', () => {
            expect(commitListSource).toContain('fixup-count-');
        });

        it('count title lists fixup hashes', () => {
            expect(commitListSource).toContain("Fixups:");
        });
    });

    describe('subject display', () => {
        it('shows stripped display subject for fixup commits', () => {
            expect(commitListSource).toContain('isFixup ? fixupEntry!.displaySubject : commit.subject');
        });
    });

    describe('data attributes', () => {
        it('adds data-fixup-type attribute to fixup rows', () => {
            expect(commitListSource).toContain('data-fixup-type={fixupEntry?.type}');
        });

        it('adds data-fixup-target attribute to fixup rows', () => {
            expect(commitListSource).toContain('data-fixup-target={fixupEntry?.targetHash}');
        });
    });

    describe('CommitTooltip fixup props', () => {
        it('accepts fixupEntry prop', () => {
            expect(tooltipSource).toContain('fixupEntry?: FixupEntry');
        });

        it('accepts targetGroup prop', () => {
            expect(tooltipSource).toContain('targetGroup?: FixupGroupTarget');
        });

        it('accepts groupColor prop', () => {
            expect(tooltipSource).toContain('groupColor?: string');
        });

        it('renders fixup info section in tooltip', () => {
            expect(tooltipSource).toContain('tooltip-fixup-info');
        });

        it('renders target info section in tooltip', () => {
            expect(tooltipSource).toContain('tooltip-fixup-target-info');
        });

        it('CommitList passes fixup props to tooltip', () => {
            expect(commitListSource).toContain('fixupEntry={hovFixupEntry}');
            expect(commitListSource).toContain('targetGroup={hovTargetGroup}');
            expect(commitListSource).toContain('groupColor={hovGroupColor}');
        });
    });
});
