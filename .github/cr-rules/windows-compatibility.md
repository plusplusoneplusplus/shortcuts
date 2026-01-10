---
model: claude-haiku-4.5
---

# Windows Compatibility Rules

## Path Handling

- **Use `path.join()` or `path.posix.join()`** instead of hardcoded path separators
- **Never hardcode `/` or `\\`** as path separators in file paths
- **Use `path.sep`** when you need the platform-specific separator
- **Use forward slashes `/`** in glob patterns (they work cross-platform)

## File System

- **Avoid reserved Windows file names**: `CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`
- **Be aware of case insensitivity**: Windows treats `File.txt` and `file.txt` as the same file
- **Keep paths under 260 characters** or use `\\?\` prefix for long paths
- **Avoid trailing dots or spaces** in file/folder names

## Line Endings

- **Use `\n` (LF)** for line endings in code
- **Configure `.gitattributes`** to handle line ending normalization
- **Use `os.EOL`** from Node.js when platform-specific line endings are needed

## Shell Commands

- **Avoid Unix-specific commands** like `rm`, `cp`, `mv` in scripts - use Node.js APIs or cross-platform tools
- **Use `cross-env`** for setting environment variables in npm scripts
- **Use `shx`** or similar for cross-platform shell commands
- **Check for `process.platform === 'win32'`** when platform-specific behavior is needed

## Environment Variables

- **Use `process.env.VAR`** instead of shell-specific syntax like `$VAR`
- **Be aware that `HOME` is `USERPROFILE`** on Windows
- **Use `os.homedir()`** instead of relying on environment variables for home directory

## Permissions

- **Windows doesn't have Unix file permissions** (chmod has no effect)
- **Don't rely on executable bits** - use file extensions instead
- **Avoid symlinks** when possible, or handle Windows symlink creation errors gracefully
