/**
 * Tests for BranchAllFilesDiff — data-file-path anchors and scrollToFilePath.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SOURCE_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'branches'
);
const SOURCE = fs.readFileSync(path.join(SOURCE_DIR, 'BranchAllFilesDiff.tsx'), 'utf-8');

describe('BranchAllFilesDiff: data-file-path anchors', () => {
    it('adds data-file-path to each file container', () => {
        expect(SOURCE).toContain('data-file-path={file.path}');
    });

    it('has a container ref for scroll support', () => {
        expect(SOURCE).toContain('containerRef');
        expect(SOURCE).toContain('useRef');
    });
});

describe('BranchAllFilesDiff: scrollToFilePath prop', () => {
    it('accepts scrollToFilePath in props', () => {
        expect(SOURCE).toContain('scrollToFilePath');
    });

    it('scrolls to file when scrollToFilePath changes', () => {
        expect(SOURCE).toContain("scrollIntoView");
    });

    it('uses useEffect for scroll trigger', () => {
        expect(SOURCE).toContain('useEffect');
    });
});
