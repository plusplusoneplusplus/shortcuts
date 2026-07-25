/**
 * Real-PDF fixtures for E2E tests.
 *
 * Builds small but genuinely valid PDF byte buffers with an extractable text
 * layer, so tests can drive the pdf.js `PdfJsRenderer` path (canvas + selectable
 * `.textLayer`) rather than the native `<iframe>` fallback. The tiny placeholder
 * PDF used elsewhere in the mock (`MOCK_PDF_BYTES` in notes-fixtures.ts) is not a
 * parseable document, so pdf.js rejects it and the host shows the iframe — the
 * exact thing this fixture avoids by emitting a structurally-correct PDF with
 * `BT … Tj … ET` text objects that pdf.js turns into selectable spans.
 *
 * The xref offsets are computed at build time from the real byte positions, so
 * pdf.js loads the document without falling back to its slow recovery path.
 */

export interface PdfTextLine {
    /** Text-space x origin (PDF points, origin bottom-left). */
    x: number;
    /** Text-space y origin (PDF points, origin bottom-left). */
    y: number;
    /** The literal text drawn (and later selectable in the text layer). */
    text: string;
    /** Font size in points. Defaults to 12. */
    size?: number;
}

export interface PdfPageSpec {
    /** MediaBox width in points. Defaults to 612 (US Letter). */
    width?: number;
    /** MediaBox height in points. Defaults to 792 (US Letter). */
    height?: number;
    /** Text lines drawn on the page, each its own positioned text object. */
    lines: PdfTextLine[];
}

/** Escape the three characters that are special inside a PDF literal string. */
function escapePdfText(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Build a valid multi-page PDF whose pages carry the given positioned text
 * lines. Every line becomes a separate `BT … Tj … ET` text object so pdf.js
 * emits one selectable span per line, which keeps the text-layer assertions in
 * the e2e specs stable.
 */
export function buildTextPdf(pages: PdfPageSpec[]): Buffer {
    const numPages = pages.length;
    // Object layout: 1=Catalog, 2=Pages, then per page a Page obj + a Contents
    // obj, then a single shared Font obj last.
    const fontObjNum = 3 + numPages * 2;
    const totalObjs = fontObjNum;
    const offsets: number[] = new Array(totalObjs + 1).fill(0);
    const chunks: string[] = [];
    let pos = 0;

    const push = (s: string): void => {
        chunks.push(s);
        pos += Buffer.byteLength(s, 'latin1');
    };
    const writeObj = (num: number, body: string): void => {
        offsets[num] = pos;
        push(`${num} 0 obj\n${body}\nendobj\n`);
    };

    push('%PDF-1.4\n');

    writeObj(1, '<< /Type /Catalog /Pages 2 0 R >>');

    const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
    writeObj(2, `<< /Type /Pages /Kids [${kids}] /Count ${numPages} >>`);

    pages.forEach((pg, i) => {
        const pageObjNum = 3 + i * 2;
        const contentObjNum = 4 + i * 2;
        const w = pg.width ?? 612;
        const h = pg.height ?? 792;
        writeObj(
            pageObjNum,
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
                `/Contents ${contentObjNum} 0 R ` +
                `/Resources << /Font << /F1 ${fontObjNum} 0 R >> >> >>`,
        );
        const streamBody =
            pg.lines
                .map(
                    (l) =>
                        `BT /F1 ${l.size ?? 12} Tf ${l.x} ${l.y} Td (${escapePdfText(l.text)}) Tj ET`,
                )
                .join('\n') + '\n';
        const streamLen = Buffer.byteLength(streamBody, 'latin1');
        writeObj(contentObjNum, `<< /Length ${streamLen} >>\nstream\n${streamBody}endstream`);
    });

    writeObj(fontObjNum, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

    // xref: every entry is exactly 20 bytes (10-digit offset, gen, flag, CRLF).
    const xrefPos = pos;
    let xref = `xref\n0 ${totalObjs + 1}\n`;
    xref += '0000000000 65535 f\r\n';
    for (let n = 1; n <= totalObjs; n++) {
        xref += `${String(offsets[n]).padStart(10, '0')} 00000 n\r\n`;
    }
    push(xref);
    push(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

    return Buffer.concat(chunks.map((c) => Buffer.from(c, 'latin1')));
}

// ── Shared arXiv-style fixture used by the pdf.js text-layer e2e specs ────────

/** Distinctive passages the e2e specs select and assert against. */
export const PDF_TITLE_PASSAGE = 'Attention Is All You Need In Notes';
export const PDF_ABSTRACT_PASSAGE = 'The dominant sequence transduction models';
export const PDF_LEFT_COLUMN_PASSAGE = 'Left column introduces the architecture';
export const PDF_RIGHT_COLUMN_PASSAGE = 'Right column reports the benchmark results';

/**
 * A two-page arXiv-style paper: a single-column title/abstract page and a
 * two-column body page, so specs can prove selection works on both simple and
 * multi-column layouts.
 */
export function buildArxivStylePdf(): Buffer {
    return buildTextPdf([
        {
            lines: [
                { x: 72, y: 720, text: PDF_TITLE_PASSAGE, size: 20 },
                { x: 72, y: 690, text: 'Ada Lovelace, Alan Turing, and Grace Hopper', size: 11 },
                { x: 72, y: 640, text: 'Abstract', size: 14 },
                { x: 72, y: 612, text: PDF_ABSTRACT_PASSAGE, size: 11 },
                { x: 72, y: 596, text: 'are based on complex recurrent or convolutional networks.', size: 11 },
            ],
        },
        {
            lines: [
                // Left column (x ~72) and right column (x ~330) on the same rows.
                { x: 72, y: 700, text: PDF_LEFT_COLUMN_PASSAGE, size: 11 },
                { x: 72, y: 684, text: 'in a single self-contained paragraph of text.', size: 11 },
                { x: 330, y: 700, text: PDF_RIGHT_COLUMN_PASSAGE, size: 11 },
                { x: 330, y: 684, text: 'across every evaluated translation task.', size: 11 },
            ],
        },
    ]);
}
