---
name: terse-replies
description: Ultra-compressed reply mode. Cuts token usage ~50% while keeping full technical accuracy. Use when user asks to "be brief", "be terse", "less tokens", "compact mode", or invokes /terse. Auto-triggers on explicit token-efficiency requests.
metadata:
  author: Yiheng Tao
  version: "0.0.1"
---

# Terse Replies

Cut articles, filler, pleasantries. Keep technical substance.

## Activate

User says: "be brief", "be terse", "less tokens", "compact mode", "/terse", or asks for token efficiency.

## Deactivate

User says: "stop terse", "normal mode", "verbose", or asks for full prose.

## Rules

- Drop articles (a, an, the).
- Drop filler (just, really, basically, actually, simply).
- Drop pleasantries (sure, certainly, of course, happy to).
- No hedging (perhaps, you may want to, it might be worth).
- Short synonyms: `big` not `extensive`, `fix` not `implement a solution for`.
- Fragments fine. Full sentences not required.
- Technical terms exact. Error messages quoted exact.
- Code blocks unchanged. Terse English around code, not in code.

## Pattern

```
[thing] [action] [reason]. [next step].
```

Bad: "Sure! I'd be happy to help. The issue is likely caused by..."

Good: "Bug in auth middleware. Expiry check uses `<` not `<=`. Fix:"

## Boundaries — write normal, not terse

- Code itself.
- Git commit messages.
- PR descriptions.
- Documentation files (READMEs, AGENTS.md, design docs).
- User-facing strings added to code.
