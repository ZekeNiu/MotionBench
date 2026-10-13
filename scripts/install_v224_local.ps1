$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$installation = 'D:\Application\Strength&Conditioning\MotionBench'
$checkpoint = 'D:\Application\Strength&Conditioning\MotionBench-backups\20261014-before-2.24.0'
$userdata = Join-Path $env:APPDATA 'MotionBench Desktop'
$candidate = Join-Path $workspace 'dist-desktop\win-unpacked'
$installer = Join-Path $workspace 'dist-desktop\MotionBench-2.24.0-desktop.1-Setup-x64.exe'
Push-Location $workspace
try {
    python scripts/verify_v224.py
    if ($LASTEXITCODE -ne 0) { throw 'Final candidate evidence did not pass.' }
    python scripts/verify_v224_supplement.py
    if ($LASTEXITCODE -ne 0) { throw 'Final regression and visual evidence did not pass.' }
    $receipt = Get-Content -LiteralPath (Join-Path $checkpoint 'verification\candidate\receipt.json') -Raw | ConvertFrom-Json
    if (-not $receipt.pass -or $receipt.runtimeHtmlSha256 -ne (Get-FileHash -LiteralPath (Join-Path $workspace 'MotionBench.html') -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'The copied real-data candidate was not verified against this build.' }
    $active = @(Get-Process MotionBench -ErrorAction SilentlyContinue | Where-Object Path -eq (Join-Path $installation 'MotionBench.exe'))
    if ($active.Count) { throw 'The installed application is running; close it normally before upgrading.' }
    $manifest = Get-Content -LiteralPath (Join-Path $checkpoint 'manifest.json') -Raw | ConvertFrom-Json
    if (-not $manifest.complete -or $manifest.files.Count -ne 148) { throw 'The verified original checkpoint is incomplete.' }
    foreach ($entry in $manifest.files) {
        $originalRoot = if ($entry.kind -eq 'program') { $installation } elseif ($entry.kind -eq 'userdata') { $userdata } else { throw 'Unexpected checkpoint entry.' }
        $original = [IO.Path]::GetFullPath((Join-Path $originalRoot $entry.path))
        $saved = [IO.Path]::GetFullPath((Join-Path (Join-Path $checkpoint $entry.kind) $entry.path))
        if (-not $original.StartsWith($originalRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $saved.StartsWith($checkpoint+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Checkpoint path leaves its directory.' }
        if ((Get-FileHash -LiteralPath $saved -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256 -or (Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'Original program or data changed after checkpoint; preserve the newer state before proceeding.' }
    }
    $result = [ordered]@{pass=$false;version='2.24.0-desktop.1';installationDirectory=$installation;installerSha256=(Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant();checkpointFilesVerified=$manifest.files.Count;checks=@()}
    $process = Start-Process -FilePath $installer -ArgumentList "/S /D=$installation" -WindowStyle Hidden -PassThru -Wait
    $result.installerExitCode = $process.ExitCode
    if ($process.ExitCode -ne 0) { throw "The installer returned $($process.ExitCode)." }
    foreach ($file in @('MotionBench.exe','resources/app.asar')) {
        $actual = (Get-FileHash -LiteralPath (Join-Path $installation $file) -Algorithm SHA256).Hash.ToLowerInvariant()
        $expected = (Get-FileHash -LiteralPath (Join-Path $candidate $file) -Algorithm SHA256).Hash.ToLowerInvariant()
        $result.checks += @{file=$file;sha256=$actual;matchesTestedPackage=($actual -eq $expected)}
        if ($actual -ne $expected) { throw 'Installed program differs from the verified candidate.' }
    }
    $result.pass = $true
    $result.completedAt = [DateTime]::UtcNow.ToString('o')
    $out = Join-Path $workspace 'output\implementation-2.24.0'
    New-Item -ItemType Directory -Force -Path $out | Out-Null
    $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $out 'local-installation.json') -Encoding utf8
    Write-Output 'Installed verified MotionBench 2.24.0-desktop.1 to the original directory.'
} finally { Pop-Location }
