const { spawnSync } = require('child_process');

const shouldUseXvfb =
    process.platform === 'linux' &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY;

const command = shouldUseXvfb ? 'xvfb-run' : process.execPath;
const args = shouldUseXvfb
    ? ['-a', process.execPath, './out/test/runTest.js']
    : ['./out/test/runTest.js'];

const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: shouldUseXvfb
        ? {
              ...process.env,
              DISPLAY: ':99.0',
          }
        : process.env,
});

if (result.error) {
    console.error(result.error.message);
    process.exit(1);
}

process.exit(result.status ?? 1);
