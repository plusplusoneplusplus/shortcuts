import os from 'os';
import fs from 'fs';
import path from 'path';

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-memory-test-'));
process.env.COC_DATA_DIR = tmpBase;

export async function teardown() {
    try {
        fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch { /* ignore */ }
    delete process.env.COC_DATA_DIR;
}
