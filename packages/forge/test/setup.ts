import os from 'os';
import fs from 'fs';
import path from 'path';
import { safeRm } from './helpers/safe-rm';

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-test-'));
process.env.COC_DATA_DIR = tmpBase;

// Windows installs git with `core.autocrlf=true`, so a file committed as `hello\n`
// comes back out of a checkout, a clone or a stash pop as `hello\r\n` and every
// suite that round-trips content through git fails there and only there. These
// three variables are git's own way to layer config onto every invocation, which
// is what reaches the clones the server makes for itself — a repository-local
// setting cannot, because the repository does not exist until git creates it.
// A no-op on Linux and macOS, where this is already the default.
process.env.GIT_CONFIG_COUNT = '1';
process.env.GIT_CONFIG_KEY_0 = 'core.autocrlf';
process.env.GIT_CONFIG_VALUE_0 = 'false';

export async function teardown() {
    await safeRm(tmpBase);
    delete process.env.COC_DATA_DIR;
    delete process.env.GIT_CONFIG_COUNT;
    delete process.env.GIT_CONFIG_KEY_0;
    delete process.env.GIT_CONFIG_VALUE_0;
}
