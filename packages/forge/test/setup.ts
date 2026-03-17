import os from 'os';
import fs from 'fs';
import path from 'path';

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-test-'));
process.env.COC_DATA_DIR = tmpBase;

export async function teardown() {
    await fs.promises.rm(tmpBase, { recursive: true, force: true });
    delete process.env.COC_DATA_DIR;
}
