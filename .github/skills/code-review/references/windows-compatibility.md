# Windows Compatibility

Use this rule when code changes touch path handling, filesystem access, shell commands, environment variables, line endings, or platform-specific behavior.

## Path Handling

- **Use `path.join()` or `path.posix.join()`** instead of hardcoded path separators.
- **Never hardcode `/` or `\\`** as path separators in file paths.
- **Use `path.sep`** when you need the platform-specific separator.
- **Use forward slashes `/`** in glob patterns because they work cross-platform.

## File System

- **Avoid reserved Windows file names**: `CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`.
- **Be aware of case insensitivity**: Windows treats `File.txt` and `file.txt` as the same file.
- **Keep paths under 260 characters** or use the `\\?\` prefix for long paths.
- **Avoid trailing dots or spaces** in file or folder names.

## Line Endings

- **Use `\n` (LF)** for line endings in code.
- **Configure `.gitattributes`** to handle line ending normalization.
- **Use `os.EOL`** from Node.js when platform-specific line endings are needed.

## Shell Commands

- **Avoid Unix-specific commands** like `rm`, `cp`, and `mv` in scripts. Use Node.js APIs or cross-platform tools instead.
- **Use `cross-env`** for setting environment variables in npm scripts.
- **Use `shx`** or similar tools for cross-platform shell commands.
- **Check for `process.platform === 'win32'`** when platform-specific behavior is needed.

## Environment Variables

- **Use `process.env.VAR`** instead of shell-specific syntax like `$VAR`.
- **Be aware that `HOME` maps to `USERPROFILE`** on Windows.
- **Use `os.homedir()`** instead of relying on environment variables for the home directory.

## Permissions

- **Windows does not have Unix file permissions** in the same way, so `chmod` often has no effect.
- **Do not rely on executable bits**. Use file extensions instead.
- **Avoid symlinks when possible**, or handle Windows symlink creation errors gracefully.
