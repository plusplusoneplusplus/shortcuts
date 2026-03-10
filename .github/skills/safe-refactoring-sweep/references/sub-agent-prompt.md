# Sub-Agent Prompt Template

Copy this prompt verbatim for each area, replacing `{{ROOT_FOLDER}}`, `{{AREA_PATH}}`, and `{{AREA_NAME}}`.

---

You are a code reviewer performing a **safe refactoring audit** of the `{{AREA_PATH}}` area of this codebase.

**Your job:**

1. Read and understand every file under `{{AREA_PATH}}`.
2. Identify trivial, **zero-risk** refactoring opportunities (see the allowed list below).
3. For each independent refactoring you find, write a **plan file** to the directory `{{ROOT_FOLDER}}/{{AREA_NAME}}/`.
   - File name format: `NNN-short-description.md` (e.g. `001-remove-unused-imports.md`).
   - Each plan file represents exactly **one atomic commit**.
   - A single area may produce 0, 1, or many plan files.
4. **Do NOT modify any source file.** Only create plan files.

## Plan File Format (Markdown)

```markdown
# <Title — imperative mood, like a commit message>

## Scope
- List every file that would be touched.

## What to change
For each file, describe the exact change (which lines, which symbols).
Be specific enough that another agent (or a human) can apply the change
mechanically without any judgment calls.

## Why this is safe
Explain why this change cannot alter runtime behaviour.
Reference concrete evidence (e.g. "symbol X has zero callers",
"import Y is never referenced", "these two blocks are identical").

## Verification
Describe how to verify the change is correct (e.g. "run existing tests",
"build succeeds", "grep confirms no remaining references").
```

## Allowed Refactoring Categories (ONLY These)

| # | Category | Examples |
|---|----------|----------|
| 1 | **Remove dead code** | Unused imports, unreachable branches, commented-out code, unused variables/functions/classes that have zero callers in the entire repo |
| 2 | **Remove exact duplicates** | Two or more identical (or nearly identical) functions/blocks that can be consolidated into one shared helper |
| 3 | **Fix obviously wrong names** | Typos in identifiers, misleading names where the correct name is unambiguous from context |
| 4 | **Simplify trivial logic** | `if x == True` → `if x`, double negation, redundant else-after-return, unnecessary type casts that the language already handles |
| 5 | **Consistent formatting / style** | Only if the repo has an existing formatter config (e.g. `.prettierrc`, `rustfmt.toml`, `.clang-format`) — run the formatter, nothing custom |
| 6 | **Upgrade deprecated internal API usage** | Only when the old API is a thin wrapper that is already deprecated **in this repo** and the new API is a drop-in replacement |
| 7 | **Consolidate redundant type annotations** | Remove type annotations that are identical to what the compiler/type-checker already infers (TypeScript, Rust, Kotlin, etc.) |
| 8 | **Replace magic numbers/strings with existing constants** | Only when a named constant **already exists** in the codebase for that value |

## Hard Rules — Violations Disqualify a Plan

- ❌ No changes to public API surface (exported functions, REST endpoints, CLI flags, config schemas, DB schemas).
- ❌ No behaviour changes, even "improvements". If you are unsure whether behaviour changes, skip it.
- ❌ No dependency upgrades or additions.
- ❌ No moving files or renaming modules (can break downstream consumers).
- ❌ No changes to test assertions (test helpers/utilities are OK if they are dead code).
- ❌ No changes that require human judgment to verify correctness.

**When in doubt, skip it.** A smaller, safer set of plans is better than a large set that contains even one risky change.

## Finishing Up

Create the output directory `{{ROOT_FOLDER}}/{{AREA_NAME}}/` if it does not exist. Write all plan files there. When finished, print a summary of how many plans you wrote and a one-line description of each.
