import * as path from 'path';

export function run(): Promise<void> {
    // Create the mocha test
    const mochaClass = require('mocha');
    const glob = require('glob');

    const mocha = new mochaClass({
        ui: 'tdd',
        color: true,
        // Raise the global default timeout from 2 s to 10 s so that tests
        // performing file I/O, git operations, or VS Code API calls do not
        // time out spuriously on Windows under parallel load.  Individual tests
        // can still override this with this.timeout() when they need more time.
        timeout: 10000
    });

    const testsRoot = path.resolve(__dirname, '..');

    return new Promise((resolve, reject) => {
        glob('**/**.test.js', { cwd: testsRoot }, (err: any, files: string[]) => {
            if (err) {
                return reject(err);
            }

            // Add files to the test suite
            files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

            try {
                // Run the mocha test
                mocha.run((failures: number) => {
                    if (failures > 0) {
                        reject(new Error(`${failures} tests failed.`));
                    } else {
                        resolve();
                    }
                });
            } catch (err) {
                console.error(err);
                reject(err);
            }
        });
    });
}