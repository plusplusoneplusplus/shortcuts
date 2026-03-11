#!/usr/bin/env pwsh
# Initialize a divide-conquer run working directory.
# Usage: ./init-run.ps1 -Slug "my-task"

param(
    [Parameter(Mandatory = $true)]
    [string]$Slug,

    [string]$BaseDir = ".divide-conquer"
)

$ErrorActionPreference = "Stop"

# Find repo root (walk up to find .git)
$root = Get-Location
$current = $root
while ($current -and -not (Test-Path (Join-Path $current ".git"))) {
    $parent = Split-Path $current -Parent
    if ($parent -eq $current) { break }
    $current = $parent
}
if (Test-Path (Join-Path $current ".git")) {
    $root = $current
}

$basePath = Join-Path $root $BaseDir

# Create base directory if needed
if (-not (Test-Path $basePath)) {
    New-Item -ItemType Directory -Path $basePath -Force | Out-Null
}

# Create .gitignore if needed
$gitignorePath = Join-Path $basePath ".gitignore"
if (-not (Test-Path $gitignorePath)) {
    Set-Content -Path $gitignorePath -Value "*"
}

# Create timestamped run directory
$timestamp = Get-Date -Format "yyyy-MM-dd-HHmmss"
$safeName = $Slug -replace '[^a-zA-Z0-9-]', '-'
$runName = "$timestamp-$safeName"
$runPath = Join-Path $basePath $runName

New-Item -ItemType Directory -Path $runPath -Force | Out-Null

# Write skeleton plan.json
$plan = @{
    slug      = $Slug
    createdAt = (Get-Date -Format "o")
    stages    = @()
    status    = "initialized"
} | ConvertTo-Json -Depth 4

Set-Content -Path (Join-Path $runPath "plan.json") -Value $plan

# Output the run directory path (consumed by orchestrator)
Write-Output $runPath
