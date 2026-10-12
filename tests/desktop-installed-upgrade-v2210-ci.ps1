param([Parameter(Mandatory)][string]$InstallerPath)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:CI -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'Real installer upgrades run only in the isolated GitHub Actions Windows user.' }
$workspaceRoot=[IO.Path]::GetFullPath($env:GITHUB_WORKSPACE); $temporaryRoot=[IO.Path]::GetFullPath($env:RUNNER_TEMP)
$currentInstaller=[IO.Path]::GetFullPath($InstallerPath)
if (-not $currentInstaller.StartsWith($workspaceRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Current installer is outside the CI workspace.' }
$ownedFolder=Join-Path $temporaryRoot ('MotionBench-upgrade-'+[guid]::NewGuid().ToString('N'))
$installDirectory=Join-Path $ownedFolder '中文 安装路径\MotionBench'
$previousFolder=Join-Path $ownedFolder 'previous-artifact'
$outputFolder=Join-Path $workspaceRoot 'output\tests\v2210-desktop\installed-upgrade'
New-Item -ItemType Directory -Force -Path $previousFolder,$outputFolder | Out-Null
$registryKey='HKCU:\Software\7ab680cb-2a51-5387-9959-bfceb2c524d6'
if (Test-Path $registryKey) { throw 'CI installer identity already exists; refusing to replace an unowned installation.' }
$baselineFixture=Join-Path $PSScriptRoot 'fixtures\desktop-upgrade-baseline-v220.json'
$baseline=Get-Content -LiteralPath $baselineFixture -Raw | ConvertFrom-Json
if ($baseline.schema -ne 1 -or $baseline.version -ne '2.19.1-desktop.1' -or $baseline.commit -ne '03ecd3b9f524d94199521d6b4dbdf65deb046704' -or $baseline.archiveUrl -notlike 'https://github.com/ZekeNiu/MotionBench/releases/download/rollback-*/*-baseline.zip' -or $baseline.archiveSha256 -notmatch '^[a-f0-9]{64}$' -or $baseline.archiveSize -le 0) { throw 'The fixed previous-version archive fixture is invalid.' }
$result=[ordered]@{synthetic=$true;passed=$false;previousArtifactId=$baseline.artifactId;previousCommit=$baseline.commit;previousArchiveUrl=$baseline.archiveUrl;previousArchiveSha256=$baseline.archiveSha256;baselineFixtureSha256=(Get-FileHash -LiteralPath $baselineFixture -Algorithm SHA256).Hash.ToLowerInvariant();checkedAt=[DateTime]::UtcNow.ToString('o');scriptSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();newInstallerSha256=(Get-FileHash -LiteralPath $currentInstaller -Algorithm SHA256).Hash.ToLowerInvariant()}
$installed=$false
try {
    $archive=Join-Path $ownedFolder 'previous.zip'
    # The public rollback archive is pinned independently of Actions retention.
    # Verify its complete bytes before extracting or launching the old installer.
    Invoke-WebRequest -Uri $baseline.archiveUrl -OutFile $archive -TimeoutSec 180
    if ((Get-Item -LiteralPath $archive).Length -ne $baseline.archiveSize -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $baseline.archiveSha256) { throw 'Previous archive checksum or length failed.' }
    $result.previousArchiveVerified=$true;$result.previousArchiveSize=(Get-Item -LiteralPath $archive).Length
    Expand-Archive -LiteralPath $archive -DestinationPath $previousFolder
    $oldInstaller=@(Get-ChildItem -LiteralPath $previousFolder -Recurse -Filter 'MotionBench-2.19.1-desktop.1-Setup-x64.exe')
    $provenance=@(Get-ChildItem -LiteralPath $previousFolder -Recurse -Filter 'build-provenance.json')
    $checksums=@(Get-ChildItem -LiteralPath $previousFolder -Recurse -Filter 'SHA256SUMS.txt')
    if ($oldInstaller.Count -ne 1 -or $provenance.Count -ne 1 -or $checksums.Count -ne 1) { throw 'Previous artifact contents do not match the fixed desktop baseline.' }
    $identity=Get-Content -LiteralPath $provenance[0].FullName -Raw | ConvertFrom-Json
    if ($identity.version -ne '2.19.1-desktop.1' -or $identity.commit -ne $result.previousCommit) { throw 'Previous installer provenance differs from the baseline.' }
    $oldHash=(Get-FileHash -LiteralPath $oldInstaller[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $checksumRow=@(Get-Content -LiteralPath $checksums[0].FullName | Where-Object { $_ -match '^([a-fA-F0-9]{64})\s+MotionBench-2\.19\.1-desktop\.1-Setup-x64\.exe$' })
    if ($checksumRow.Count -ne 1 -or $checksumRow[0].Split(' ',[StringSplitOptions]::RemoveEmptyEntries)[0].ToLowerInvariant() -ne $oldHash) { throw 'Previous installer checksum failed.' }
    $result.oldInstallerSha256=$oldHash
    $process=Start-Process -FilePath $oldInstaller[0].FullName -ArgumentList "/S /D=$installDirectory" -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Previous installer failed: $($process.ExitCode)" }; $installed=$true
    $executable=Join-Path $installDirectory 'MotionBench.exe'
    if (-not (Test-Path -LiteralPath $executable) -or (Get-ItemProperty $registryKey).InstallLocation -ne $installDirectory) { throw 'Old installer did not use the chosen per-user path.' }
    $env:MOTIONBENCH_EXECUTABLE=$executable; $env:MOTIONBENCH_CI_UPGRADE_SEED=Join-Path $outputFolder 'synthetic-seed.json'
    node (Join-Path $PSScriptRoot 'desktop-upgrade-library-v2210-ci.cjs') seed
    if ($LASTEXITCODE -ne 0) { throw 'Previous application could not durably save the synthetic upgrade fixture.' }
    $process=Start-Process -FilePath $currentInstaller -ArgumentList '--updated /S' -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "New installer failed: $($process.ExitCode)" }
    if ((Get-ItemProperty $registryKey).InstallLocation -ne $installDirectory -or -not (Test-Path -LiteralPath $executable)) { throw 'Cross-version upgrade changed the original install path.' }
    node (Join-Path $PSScriptRoot 'desktop-upgrade-library-v2210-ci.cjs') verify
    if ($LASTEXITCODE -ne 0) { throw 'New application did not preserve the raw library or DPAPI settings.' }
    $result.oldVersion='2.19.1-desktop.1';$result.newVersion='2.21.0-desktop.1';$result.originalInstallLocationPreserved=$true;$result.rawLibraryAndCredentialsPreserved=$true;$result.passed=$true
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
