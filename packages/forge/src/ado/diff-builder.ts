import { createTwoFilesPatch } from 'diff';

/**
 * Builds a unified diff string (git diff format) from two file content strings.
 *
 * @param filePath       ADO path of the file in the head revision (may have a leading `/`).
 * @param originalPath   ADO path of the file in the base revision; pass `undefined` when
 *                       the file was not renamed (defaults to `filePath`).
 * @param baseContent    Full text content of the file at the base (before) revision.
 *                       Pass an empty string `''` for added files.
 * @param headContent    Full text content of the file at the head (after) revision.
 *                       Pass an empty string `''` for deleted files.
 * @returns A standard unified diff string, or an empty string when the contents are identical.
 */
export function buildUnifiedDiff(
    filePath: string,
    originalPath: string | undefined,
    baseContent: string,
    headContent: string,
): string {
    const strippedFilePath = filePath.replace(/^\//, '');
    const strippedOriginalPath = (originalPath ?? filePath).replace(/^\//, '');

    const oldFileName = baseContent === '' ? '/dev/null' : `a/${strippedOriginalPath}`;
    const newFileName = headContent === '' ? '/dev/null' : `b/${strippedFilePath}`;

    return createTwoFilesPatch(
        oldFileName,
        newFileName,
        baseContent,
        headContent,
        undefined,
        undefined,
        { context: 3 },
    );
}
