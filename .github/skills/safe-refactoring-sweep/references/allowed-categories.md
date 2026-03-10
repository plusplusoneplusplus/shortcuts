# Allowed Refactoring Categories

This is the strict allowlist of refactoring types permitted during a safe-refactoring sweep. **No other category of change is permitted.**

## Categories

### 1. Remove Dead Code
- Unused imports
- Unreachable branches
- Commented-out code blocks
- Unused variables, functions, or classes that have zero callers in the entire repo

### 2. Remove Exact Duplicates
- Two or more identical (or nearly identical) functions or code blocks
- Consolidate into one shared helper

### 3. Fix Obviously Wrong Names
- Typos in identifiers
- Misleading names where the correct name is unambiguous from context

### 4. Simplify Trivial Logic
- `if x == True` → `if x`
- Double negation removal
- Redundant else-after-return
- Unnecessary type casts that the language already handles

### 5. Consistent Formatting / Style
- **Only** if the repo has an existing formatter config (e.g. `.prettierrc`, `rustfmt.toml`, `.clang-format`)
- Run the formatter — do not introduce custom formatting rules

### 6. Upgrade Deprecated Internal API Usage
- Only when the old API is a thin wrapper already deprecated **in this repo**
- The new API must be a drop-in replacement

### 7. Consolidate Redundant Type Annotations
- Remove type annotations identical to what the compiler/type-checker already infers
- Applies to TypeScript, Rust, Kotlin, and similar languages

### 8. Replace Magic Numbers/Strings with Existing Constants
- Only when a named constant **already exists** in the codebase for that value
- Do not create new constants

## Disqualifying Rules

Any plan that violates these rules must be discarded:

| Rule | Description |
|------|-------------|
| No public API changes | Exported functions, REST endpoints, CLI flags, config schemas, DB schemas |
| No behaviour changes | Even "improvements" — if uncertain, skip |
| No dependency changes | No upgrades or additions |
| No file moves/renames | Can break downstream consumers |
| No test assertion changes | Test helpers/utilities are OK only if they are dead code |
| No judgment-dependent changes | Must be mechanically verifiable |

**Guiding principle:** When in doubt, skip it. A smaller, safer set of plans is always preferable.
