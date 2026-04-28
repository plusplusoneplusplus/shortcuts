---
name: fresh-written
description: Rewrite documents, plans, and notes as if authored fresh each iteration — produce only the final intended state, never patch deltas on top of the previous version. Use whenever you update an existing document, plan, design note, AGENTS.md, README, MEMORY.md, or any persistent text artifact.
metadata:
  version: "0.0.1"
---

# Fresh Written

When updating any persistent text artifact (documents, plans, design notes, READMEs, AGENTS.md, MEMORY.md, comments), produce the **final intended state** as if writing it for the first time. Never layer patches on top of the previous version.

## When to Invoke

Any time you edit an existing document, plan, or note rather than creating one from scratch.

## Rules

1. **Final state only.** The output must read as a freshly authored document. Remove anything that only made sense as a diff against an earlier version.
2. **No change-log narration in body text.** Never write phrases like:
   - "After this change..."
   - "Previously, ... now ..."
   - "Updated to reflect..."
   - "Note: this section was added because..."
   - "Recent refactoring (YYYY-MM)..."
3. **No layered patches.** Do not append a new section that contradicts or duplicates an existing one. Reconcile both into a single coherent description.
4. **No stale residue.** Delete sentences, headings, examples, and code blocks that the new version makes irrelevant. If a paragraph is half-true after your edit, rewrite the whole paragraph.
5. **Consistent voice and tense.** The whole document must read in one consistent tone — do not mix "we will add X" with "X has been added".
6. **No dated stamps in prose.** Do not embed dates, version numbers, or "as of <date>" markers in body text. Frontmatter or dedicated changelog sections are fine.
7. **Condense over accumulate.** Prefer merging overlapping descriptions into one shorter, clearer description over keeping both.

## Process

1. Read the current document fully before editing.
2. Decide what the document should say *now*, given the change you are making.
3. Rewrite affected sections from scratch — no deltas, footnotes, or "addendum" subsections.
4. Re-read top-to-bottom and remove any phrasing that only makes sense to a reader who saw the previous version.

## Exceptions

Do NOT apply this skill to files that are by-design append-only or chronological:

- `CHANGELOG.md`, release notes, audit logs
- Conversation transcripts and chat history
- Raw observation logs and event streams
- Task plan files where checkbox progress over time is the explicit point
