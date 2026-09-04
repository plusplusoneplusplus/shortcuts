import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

// Files that were converted to non-blocking request-path handling. Synchronous
// I/O regressions in them are blocked by the rules below.
const NON_BLOCKING_REQUEST_IO_FILES = [
    'packages/forge/src/git/git-log-service.ts',
    'packages/coc/src/server/repos/tree-service.ts',
    'packages/coc/src/server/core/api-handler.ts',
    'packages/coc/src/server/routes/api-fs-routes.ts',
    'packages/coc/src/server/routes/native-cli-session-routes.ts',
    'packages/coc/src/server/routes/native-copilot-session-routes.ts',
    'packages/coc/src/server/work-items/work-item-sync-github-repo.ts',
    'packages/coc/src/server/work-items/work-item-commands.ts',
    'packages/coc/src/server/work-items/work-item-sync-github-provider.ts',
    'packages/coc/src/server/work-items/work-item-github-pull-poller.ts',
    'packages/coc/src/server/workflows/workflow-utils.ts',
];

export default [
    {
        ignores: ['**/out/**', '**/dist/**', '**/*.d.ts'],
    },
    {
        files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
        languageOptions: {
            parser: tsParser,
            ecmaVersion: 2022,
            sourceType: 'module',
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
        },
        rules: {
            '@typescript-eslint/naming-convention': 'warn',
            curly: 'warn',
            eqeqeq: 'warn',
            'no-throw-literal': 'warn',
            semi: 'off',
        },
    },
    {
        files: NON_BLOCKING_REQUEST_IO_FILES,
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'CallExpression[callee.property.name=/Sync$/]',
                    message:
                        'Synchronous I/O is banned in this converted RPC request-path file (non-blocking-request-io guard). Use fs.promises.* or execAsync/execFileAsync from packages/forge/src/utils/exec-utils.ts.',
                },
                {
                    selector: 'CallExpression[callee.name=/^(exec|execFile|spawn|fork)Sync$/]',
                    message:
                        'Synchronous child_process is banned in this converted RPC request-path file (non-blocking-request-io guard). Use execAsync/execFileAsync from packages/forge/src/utils/exec-utils.ts.',
                },
                {
                    selector:
                        'CallExpression[callee.name=/^(readFile|writeFile|appendFile|exists|stat|lstat|readdir|mkdir|rm|rmdir|unlink|readlink|realpath|copyFile|access|open|truncate|chmod|chown|rename|symlink|link)Sync$/]',
                    message:
                        'Synchronous fs is banned in this converted RPC request-path file (non-blocking-request-io guard). Use fs.promises.* instead.',
                },
            ],
        },
    },
];
