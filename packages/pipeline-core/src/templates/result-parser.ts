import { FileChange } from './types';

const FILE_HEADER_RE = /^=== FILE:\s*(.+?)\s*\((\w+)\)\s*===$/;
const END_FILE_RE = /^=== END FILE ===$/;
const SUMMARY_RE = /^=== SUMMARY ===$/;

type State = 'idle' | 'inFile' | 'inSummary';

function normaliseStatus(raw: string): FileChange['status'] {
    const lower = raw.toLowerCase();
    if (lower === 'new' || lower === 'modified' || lower === 'deleted') {
        return lower;
    }
    return 'modified';
}

export function parseReplicateResponse(aiOutput: string): { files: FileChange[]; summary: string } {
    const files: FileChange[] = [];
    const lines = aiOutput.split('\n');

    let state: State = 'idle';
    let currentPath = '';
    let currentStatus: FileChange['status'] = 'modified';
    let contentLines: string[] = [];
    const summaryLines: string[] = [];

    function flushFile() {
        let content = contentLines.join('\n');
        // Trim single trailing newline
        if (content.endsWith('\n')) {
            content = content.slice(0, -1);
        }
        files.push({
            path: currentPath.trim(),
            content,
            status: currentStatus,
        });
        contentLines = [];
    }

    for (const line of lines) {
        const trimmed = line.trimEnd();

        if (state === 'inSummary') {
            summaryLines.push(line);
            continue;
        }

        if (SUMMARY_RE.test(trimmed)) {
            if (state === 'inFile') {
                flushFile();
            }
            state = 'inSummary';
            continue;
        }

        if (state === 'inFile') {
            if (END_FILE_RE.test(trimmed)) {
                flushFile();
                state = 'idle';
                continue;
            }
            contentLines.push(line);
            continue;
        }

        // state === 'idle'
        const match = FILE_HEADER_RE.exec(trimmed);
        if (match) {
            currentPath = match[1];
            currentStatus = normaliseStatus(match[2]);
            contentLines = [];
            state = 'inFile';
        }
    }

    // Flush unclosed file block (lenient)
    if (state === 'inFile') {
        flushFile();
    }

    let summary = summaryLines.join('\n').trim();
    if (!summary) {
        summary = '';
    }

    return { files, summary };
}
