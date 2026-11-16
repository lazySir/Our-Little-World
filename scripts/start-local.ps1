param(
    [switch]$Dev,
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$projectPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location -LiteralPath $projectPath
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Please install Node.js 22.12 or newer, then reopen PowerShell.'
    }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'npm was not found. Install a Node.js distribution that includes npm.'
    }
    $nodeVersion = [version](& node -p 'process.versions.node')
    if ($nodeVersion -lt [version]'22.12.0') { throw 'Node.js 22.12 or newer is required.' }

    if (-not $SkipInstall) {
        if (Test-Path -LiteralPath 'package-lock.json') { & npm.cmd ci }
        else { & npm.cmd install }
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    & npm.cmd run init
    if ($LASTEXITCODE -ne 0) { throw 'Database initialization failed.' }

    if ($Dev) {
        & npm.cmd run dev
    } else {
        & npm.cmd run build:api
        if ($LASTEXITCODE -ne 0) { throw 'API build failed.' }
        & npm.cmd run build:web
        if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
        & npm.cmd start
    }
    if ($LASTEXITCODE -ne 0) { throw 'Application stopped with an error.' }
} finally {
    Pop-Location
}
