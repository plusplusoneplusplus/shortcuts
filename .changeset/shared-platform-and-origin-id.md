---
"@plusplusoneplusplus/coc-agent-sdk": minor
"@plusplusoneplusplus/forge": minor
"@plusplusoneplusplus/coc": patch
---

De-duplicate the platform utilities and canonical origin identity that were vendored into more than one package.

`coc-agent-sdk` now owns the four shared platform modules — workspace execution/WSL routing, pure path strings, directory containment, and process execution — and publishes them through two new subpath exports: `./platform` (Node-only) and `./platform/path-utils` (browser-safe, no Node builtins). `@plusplusoneplusplus/forge`'s `utils/workspace-execution`, `utils/path-utils`, `utils/path-security` and `utils/exec-utils` keep their existing public surface as compatibility re-exports over those modules, so forge and the SDK now share one WSL distro cache instead of warming two.

Canonical origin identity moves into a new pure, synchronous `@plusplusoneplusplus/forge/git/origin-id` entry point, used by both the server and the dashboard SPA. It hashes with a portable SHA-256 rather than Node `crypto`, so origin IDs are byte-identical on both platforms. Existing origin IDs, the separate historical `computeRemoteHash`, and forge's `git` exports are unchanged.

Consumers importing the new `coc-agent-sdk/platform*` or `forge/git/origin-id` subpaths need these releases.
