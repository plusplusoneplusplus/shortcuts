---
name: fresh-written
description: Rewrite documents, plans, and notes as if authored fresh each iteration — produce only the final intended state.
metadata:
  author: Yiheng Tao
  version: "0.0.2"
---

# Fresh Written

When updating any persistent text artifact (documents, plans, design notes, READMEs, AGENTS.md, MEMORY.md, comments), produce the **final intended state** as if writing it for the first time. Never layer patches on top of the previous version.

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

## Document purpose

- Identify the reader and what they need to understand or do.
- Give each document or section a clear purpose: teach through practice,
  guide a task, provide facts for lookup, or explain a bounded topic.
- In procedures, put prerequisites and conditions before the actions they govern.
  Use numbered steps and state the expected result where useful.
- Keep reference factual. Ground explanations of decisions and trade-offs in
  evidence. Do not invent design intent.
- Preserve required templates and formats. Separate and link topics when that
  makes the document easier to use.

## STE-style rules

Use these Simplified Technical English principles.

- Give one instruction per sentence.
- Aim for no more than 20 words in instructions and 25 words in descriptions.
  Split longer sentences when that improves clarity.
- Write instructions as direct commands in active voice.
- Put conditions and warnings before the actions they govern.
- Use one term for each concept and one meaning for each term.
- Keep articles such as "a" and "the". Repeat nouns when pronouns are unclear.
- Break long noun groups into shorter phrases.
- Prefer verbs to abstract nouns, such as "configure" instead of
  "perform configuration".
- Preserve exact technical names and required syntax.

## Clear prose

- Lead with the point. Use familiar words, concrete nouns, and direct verbs.
- Name the actor when it matters. Make each pronoun's reference clear.
- Use the exact names of symbols, paths, commands, settings, and UI elements.
  Use one term consistently for each concept.
- Split sentences that carry competing ideas. Vary sentence length naturally.
- Remove filler, inflated claims, promotional language, stock introductions,
  repeated conclusions, and vague attribution.
- Replace abstract claims with supported behavior, examples, or measurements.
  Do not invent evidence to make a sentence more specific.
- Keep uncertainty and qualifications that affect correctness.
- Use headings and lists to help readers find information. Avoid decorative
  formatting and repeated bold labels that add no meaning.
- Match the artifact's voice. Do not add personality or opinions to factual
  reference material.
- Apply these rules with judgment. Preserve technical meaning over stylistic
  uniformity.

## Process

1. Read the current document fully before editing.
2. Identify the reader, purpose, and facts the document must preserve.
3. Decide what the document should say now, given the change you are making.
4. Rewrite affected sections as one coherent account of the intended state.
5. Read top-to-bottom for stale content, repetition, unclear wording, and filler.
6. Check technical claims, examples, commands, and links against available
   evidence. Preserve explicit uncertainty where verification is incomplete.

## Exceptions

Do NOT apply this skill to files that are by-design append-only or chronological:

- `CHANGELOG.md`, release notes, audit logs
- Conversation transcripts and chat history
- Raw observation logs and event streams
- Task plan files where checkbox progress over time is the explicit point
