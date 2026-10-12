param([Parameter(Mandatory)][string]$InstallerPath)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:CI -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'Real installer upgrades run only in the isolated GitHub Actions Windows user.' }
$workspaceRoot=[IO.Path]::GetFullPath($env:GITHUB_WORKSPACE); $temporaryRoot=[IO.Path]::GetFullPath($env:RUNNER_TEMP)
$currentInstaller=[IO.Path]::GetFullPath($InstallerPath)
if (-not $currentInstaller.StartsWith($workspaceRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Current installer is outside the CI workspace.' }
$ownedFolder=Join-Path $temporaryRoot ('MotionBench-upgrade-'+[guid]::NewGuid().ToString('N'))
$installDirectory=Join-Path $ownedFolder '中文 安装路径\MotionBench'
$previousFolder=Join-Path $ownedFolder 'previous-artifact'
$outputFolder=Join-Path $workspaceRoot 'output\tests\v2191-desktop\installed-upgrade'
New-Item -ItemType Directory -Force -Path $previousFolder,$outputFolder | Out-Null
$registryKey='HKCU:\Software\7ab680cb-2a51-5387-9959-bfceb2c524d6'
if (Test-Path $registryKey) { throw 'CI installer identity already exists; refusing to replace an unowned installation.' }
$result=[ordered]@{synthetic=$true;passed=$false;previousArtifactId=11691562131;previousCommit='71e2d905a82712f04ed725868b3ce2932cb5f5f8';checkedAt=[DateTime]::UtcNow.ToString('o');scriptSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();newInstallerSha256=(Get-FileHash -LiteralPath $currentInstaller -Algorithm SHA256).Hash.ToLowerInvariant()}
$installed=$false
try {
    if (-not $env:GITHUB_TOKEN) { throw 'Read-only GitHub Actions access is required for the fixed previous installer artifact.' }
    $headers=@{Authorization="Bearer $env:GITHUB_TOKEN";Accept='application/vnd.github+json'}
    $metadata=Invoke-RestMethod -Uri "https://api.github.com/repos/$env:GITHUB_REPOSITORY/actions/artifacts/11691562131" -Headers $headers
    if ($metadata.expired -or $metadata.name -ne 'MotionBench-Windows-x64-11' -or $metadata.workflow_run.head_sha -ne $result.previousCommit) { throw 'The previous artifact is expired or has a different source identity.' }
    $archive=Join-Path $ownedFolder 'previous.zip'
    Invoke-WebRequest -Uri $metadata.archive_download_url -Headers $headers -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $previousFolder
    $oldInstaller=@(Get-ChildItem -LiteralPath $previousFolder -Recurse -Filter 'MotionBench-2.19.0-desktop.1-Setup-x64.exe')
    $provenance=@(Get-ChildItem -LiteralPath $previousFolder -Recurse -Filter 'build-provenance.json')
    $checksums=@(Get-ChildItem -LiteralPath $previousFolder -Recurse -Filter 'SHA256SUMS.txt')
    if ($oldInstaller.Count -ne 1 -or $provenance.Count -ne 1 -or $checksums.Count -ne 1) { throw 'Previous artifact contents do not match the fixed desktop baseline.' }
    $identity=Get-Content -LiteralPath $provenance[0].FullName -Raw | ConvertFrom-Json
    if ($identity.version -ne '2.19.0-desktop.1' -or $identity.commit -ne $result.previousCommit) { throw 'Previous installer provenance differs from the baseline.' }
    $oldHash=(Get-FileHash -LiteralPath $oldInstaller[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $checksumRow=@(Get-Content -LiteralPath $checksums[0].FullName | Where-Object { $_ -match '^([a-fA-F0-9]{64})\s+MotionBench-2\.19\.0-desktop\.1-Setup-x64\.exe$' })
    if ($checksumRow.Count -ne 1 -or $checksumRow[0].Split(' ',[StringSplitOptions]::RemoveEmptyEntries)[0].ToLowerInvariant() -ne $oldHash) { throw 'Previous installer checksum failed.' }
    $result.oldInstallerSha256=$oldHash
    $process=Start-Process -FilePath $oldInstaller[0].FullName -ArgumentList "/S /D=$installDirectory" -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Previous installer failed: $($process.ExitCode)" }; $installed=$true
    $executable=Join-Path $installDirectory 'MotionBench.exe'
    if (-not (Test-Path -LiteralPath $executable) -or (Get-ItemProperty $registryKey).InstallLocation -ne $installDirectory) { throw 'Old installer did not use the chosen per-user path.' }
    $env:MOTIONBENCH_EXECUTABLE=$executable; $env:MOTIONBENCH_CI_UPGRADE_SEED=Join-Path $outputFolder 'synthetic-seed.json'
    node (Join-Path $PSScriptRoot 'desktop-upgrade-library-ci.cjs') seed
    if ($LASTEXITCODE -ne 0) { throw 'Previous application could not durably save the synthetic upgrade fixture.' }
    $process=Start-Process -FilePath $currentInstaller -ArgumentList '--updated /S' -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "New installer failed: $($process.ExitCode)" }
    if ((Get-ItemProperty $registryKey).InstallLocation -ne $installDirectory -or -not (Test-Path -LiteralPath $executable)) { throw 'Cross-version upgrade changed the original install path.' }
    node (Join-Path $PSScriptRoot 'desktop-upgrade-library-ci.cjs') verify
    if ($LASTEXITCODE -ne 0) { throw 'New application did not preserve the raw library or DPAPI settings.' }
    $result.oldVersion='2.19.0-desktop.1';$result.newVersion='2.19.1-desktop.1';$result.originalInstallLocationPreserved=$true;$result.rawLibraryAndCredentialsPreserved=$true;$result.passed=$true
} catch { $result.error=$_.Exception.Message; throw }
finally {
    if ($installed) {
        $uninstaller=@(Get-ChildItem -LiteralPath $installDirectory -Filter '*Uninstall*.exe')
        if ($uninstaller.Count -eq 1) {
            $removed=Start-Process -FilePath $uninstaller[0].FullName -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
            $deadline=[DateTime]::UtcNow.AddSeconds(60)
            while ((Test-Path -LiteralPath (Join-Path $installDirectory 'MotionBench.exe')) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
            $result.ownedInstallationRemoved=$removed.ExitCode -eq 0 -and -not (Test-Path -LiteralPath (Join-Path $installDirectory 'MotionBench.exe'))
            if (-not $result.ownedInstallationRemoved) { $result.passed=$false }
        } else { $result.passed=$false;$result.cleanupError='Owned uninstaller was not found.' }
    }
    $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outputFolder 'upgrade-results.json') -Encoding utf8
    if (-not $result.passed) { exit 1 }
}
