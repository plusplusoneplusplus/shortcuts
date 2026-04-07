# Proposal Display Format

Render the distillation results using the layout below. Show all three sections in order, even if a section is empty (print "None." under it).

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

**Proposed:**
```
<new text>
```

---

## 🗑️ Removals (N)

### \<item title\>

> Source: "\<chat title\>" (pid: \<processId\>)

**Remove from** `SKILL.md` line ~N:
```
<text to remove>
```

**Reason:** \<why it's obsolete\>

---

## Summary Line

After all sections, print a one-line summary:

```
Proposal: X new, Y updates, Z removals.
```
