<#
.SYNOPSIS
  Build forge and coc, then verify the tarball includes forge.
.DESCRIPTION
  Run from the monorepo root:  .\scripts\build-coc-publish.ps1
#>
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Set-Location $RepoRoot

Write-Host "==> Building all packages..."
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

Write-Host ""
Write-Host "==> Verifying tarball contents (dry-run)..."
Set-Location packages\coc
$packOutput = npm pack --dry-run 2>&1 | Out-String
Write-Host $packOutput

if ($packOutput -match 'node_modules[\\/]@plusplusoneplusplus[\\/]forge') {
    Write-Host "`n✅  forge is embedded in the tarball."
} else {
    Write-Host "`n❌  forge was NOT found in the tarball. Check bundledDependencies in package.json."
    exit 1
}

Write-Host ""
Write-Host "=== Next steps (manual) ==="
Write-Host "  cd packages\coc"
Write-Host "  npm version patch   # or minor / major"
Write-Host "  npm login            # if needed"
Write-Host "  npm publish"
