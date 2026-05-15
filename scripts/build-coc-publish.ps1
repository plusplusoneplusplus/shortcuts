<#
.SYNOPSIS
  Build forge, coc, and coc-client, then verify the tarballs.
.DESCRIPTION
  Run from the monorepo root:  .\scripts\build-coc-publish.ps1
#>
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Set-Location $RepoRoot

Write-Host "==> Building all packages..."
npm run build:packages
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

Write-Host ""
Write-Host "==> Staging forge into coc/node_modules for bundling..."
$ForgeNM = Join-Path 'packages' 'coc' 'node_modules' '@plusplusoneplusplus' 'forge'
if (Test-Path $ForgeNM) { Remove-Item -Recurse -Force $ForgeNM }
$parentDir = Split-Path -Parent $ForgeNM
if (-not (Test-Path $parentDir)) { New-Item -ItemType Directory -Force -Path $parentDir | Out-Null }
Copy-Item -Recurse -Force (Join-Path 'packages' 'forge') $ForgeNM
foreach ($sub in 'node_modules', '.git', 'src', 'test') {
    $p = Join-Path $ForgeNM $sub
    if (Test-Path $p) { Remove-Item -Recurse -Force $p }
}

Write-Host ""
Write-Host "==> Packing and verifying tarball..."
Set-Location packages\coc
$tarball = (npm pack 2>&1 | Select-Object -Last 1).Trim()
$entries = tar tzf $tarball 2>&1 | Out-String

if ($entries -match 'node_modules[\\/]@plusplusoneplusplus[\\/]forge') {
    $count = ($entries -split "`n" | Where-Object { $_ -match 'node_modules[\\/]@plusplusoneplusplus[\\/]forge' }).Count
    Write-Host "`n✅  forge is embedded in the tarball ($count files)."
} else {
    Remove-Item -Force $tarball -ErrorAction SilentlyContinue
    Write-Host "`n❌  forge was NOT found in the tarball. Check bundledDependencies in package.json."
    exit 1
}
Remove-Item -Force $tarball -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "==> Packing and verifying coc-client tarball..."
Set-Location (Join-Path $RepoRoot 'packages' 'coc-client')
$clientTarball = (npm pack 2>&1 | Select-Object -Last 1).Trim()
$clientEntries = tar tzf $clientTarball 2>&1 | Out-String

if ($clientEntries -match 'dist/') {
    $clientCount = ($clientEntries -split "`n" | Where-Object { $_ -match 'dist/' }).Count
    Write-Host "`n✅  coc-client dist is present in the tarball ($clientCount files)."
} else {
    Remove-Item -Force $clientTarball -ErrorAction SilentlyContinue
    Write-Host "`n❌  dist/ was NOT found in the coc-client tarball. Run 'npm run build' in packages/coc-client."
    exit 1
}
Remove-Item -Force $clientTarball -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== Next steps (manual) ==="
Write-Host ""
Write-Host "  # coc"
Write-Host "  cd packages\coc"
Write-Host "  npm version patch   # or minor / major"
Write-Host "  npm login            # if needed"
Write-Host "  npm publish"
Write-Host ""
Write-Host "  # coc-client"
Write-Host "  cd packages\coc-client"
Write-Host "  npm version patch   # or minor / major"
Write-Host "  npm login            # if needed"
Write-Host "  npm publish"
