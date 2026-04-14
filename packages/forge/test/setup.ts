import os from 'os';
import fs from 'fs';
import path from 'path';
import { safeRm } from './helpers/safe-rm';

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-test-'));
process.env.COC_DATA_DIR = tmpBase;

export async function teardown() {
    await safeRm(tmpBase);
    delete process.env.COC_DATA_DIR;
}
