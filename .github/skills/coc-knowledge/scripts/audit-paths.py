"""Resolve every backticked source-path reference in the coc-knowledge KB.

See audit-paths.sh for what this is for. Exit code is 1 when anything is unresolved.
"""

import re
import subprocess
import sys
from pathlib import Path

# Source extensions only. Runtime artifacts (`session.json`, `progress.md`,
# `bundle.js`) are data the KB legitimately names but that never exist in the repo.
EXTS = "ts|tsx|css|mjs|cjs"
REF = re.compile(r"`([A-Za-z0-9_./@*-]+\.(?:%s))`" % EXTS)

# Build outputs the KB names but that are never tracked.
GENERATED = {"bundle.js", "bundle.css", "tailwind.css"}

root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
kb = root / ".github/skills/coc-knowledge"

tracked = subprocess.run(
    ["git", "-C", str(root), "ls-files"],
    capture_output=True, text=True, check=True,
).stdout.split("\n")

# Index every path suffix that starts at a segment boundary, so `features/chat/X.tsx`
# resolves against packages/coc/src/server/spa/client/react/features/chat/X.tsx.
suffixes = set()
for path in tracked:
    if not path:
        continue
    parts = path.split("/")
    for i in range(len(parts)):
        suffixes.add("/".join(parts[i:]))

# Relative markdown links between KB files must resolve on disk.
MD_LINK = re.compile(r"\]\((\.{0,2}/?[A-Za-z0-9_./-]+\.md)(?:#[^)]*)?\)")

missing = []
for md in sorted(kb.rglob("*.md")):
    for lineno, line in enumerate(md.read_text(encoding="utf-8").split("\n"), 1):
        for ref in REF.findall(line):
            frag = ref.lstrip("./")
            if frag in suffixes or "*" in frag or frag in GENERATED:
                continue
            missing.append((md.relative_to(root), lineno, ref))
        for link in MD_LINK.findall(line):
            if (md.parent / link).resolve().exists():
                continue
            missing.append((md.relative_to(root), lineno, link))

for path, lineno, ref in missing:
    print(f"MISSING  {path}:{lineno}  {ref}")
print("---")
print(f"{len(missing)} unresolved path reference(s).")
sys.exit(1 if missing else 0)
