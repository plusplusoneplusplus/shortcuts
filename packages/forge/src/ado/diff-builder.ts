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
    const isRename = strippedOriginalPath !== strippedFilePath;
    if (!isRename && baseContent === headContent) {
        return '';
    }

    const oldFileName = baseContent === '' ? '/dev/null' : `a/${strippedOriginalPath}`;
    const newFileName = headContent === '' ? '/dev/null' : `b/${strippedFilePath}`;
    const patch = createTwoFilesPatch(
        oldFileName,
        newFileName,
        baseContent,
        headContent,
        undefined,
        undefined,
        { context: 3 },
    ).replace(/^(?:Index: .*\n)?={3,}\n/, '');

    const gitHeader = [`diff --git a/${strippedOriginalPath} b/${strippedFilePath}`];
    if (baseContent === '') {
        gitHeader.push('new file mode 100644');
    } else if (headContent === '') {
        gitHeader.push('deleted file mode 100644');
    } else if (isRename) {
        gitHeader.push(`rename from ${strippedOriginalPath}`, `rename to ${strippedFilePath}`);
    }

    return `${gitHeader.join('\n')}\n${patch}`;
}
