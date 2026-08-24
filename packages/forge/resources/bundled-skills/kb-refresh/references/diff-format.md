# Proposal Display Format

Render the distillation results using the layout below. Show all four sections in order, even if a section is empty (print "None." under it).

---

## 🆕 New Entries (N)

### \<item title\>

> Source: "\<chat title\>" (pid: \<processId\>)

**Add to** `references/foo.md` §"\<section\>":

```
<exact text to insert>
```

---

## ✏️ Updates (N)

### \<item title\>

> Source: "\<chat title\>" (pid: \<processId\>)

**In** `references/foo.md` §"\<section\>":

**Current:**
```
<old text>
```

**Proposed (full rewrite, not an addendum):**
```
<new text — the complete replacement passage>
```

---

## 🗑️ Removals (N)

### \<item title\>

> Source: "\<chat title\>" (pid: \<processId\>)

**Remove from** `SKILL.md` line ~N:
```
<text to remove>
```

**Reason:** wrong | superseded | duplicated | changelog-grade — \<detail\>

---

## 🔍 Review Findings (N)

### \<item title\>

> Checked against `packages/coc/src/...`

**Claim** in `references/foo.md` line ~N:
```
<existing text>
```

**Finding:** \<what the source actually shows, with file:line\>

**Suggested action:** rewrite | remove

---

## Summary Line

After all sections, print a one-line summary:

```
Proposal: X new, Y updates, Z removals, W review findings (M claims spot-checked).
```
