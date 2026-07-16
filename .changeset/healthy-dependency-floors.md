---
"@plusplusoneplusplus/coc": patch
"@plusplusoneplusplus/coc-workflow": patch
"@plusplusoneplusplus/forge": patch
"@plusplusoneplusplus/deep-wiki": patch
"@plusplusoneplusplus/coccontainer": patch
"@plusplusoneplusplus/coc-client": patch
"@plusplusoneplusplus/coc-connector": patch
---

Raise dependency floors for vulnerable runtime and browser dependencies, including Baileys, ws, and js-yaml. Root overrides remain scoped to Monaco and Excalidraw transitive pins until upstream packages publish patched direct releases, and Azure DevOps consumers explicitly depend on typed-rest-client's runtime NTLM handler imports.
