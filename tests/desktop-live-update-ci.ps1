param([Parameter(Mandatory)][string]$FixtureInstaller)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:CI -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'Live update installation runs only in a fresh isolated Windows Actions user.' }
$workspace=[IO.Path]::GetFullPath($env:GITHUB_WORKSPACE);$temporary=[IO.Path]::GetFullPath($env:RUNNER_TEMP);$fixture=[IO.Path]::GetFullPath($FixtureInstaller)
if (-not $fixture.StartsWith($workspace+'\output\desktop-live-update\',[StringComparison]::OrdinalIgnoreCase)) { throw 'The unpublished fixture installer is outside its owned output folder.' }
$registryKey='HKCU:\Software\7ab680cb-2a51-5387-9959-bfceb2c524d6';$profile=Join-Path $env:APPDATA 'MotionBench Desktop'
if ((Test-Path $registryKey) -or (Test-Path -LiteralPath $profile)) { throw 'Refusing an existing installation or profile; the live update requires a fresh CI user.' }
$ownedRoot=Join-Path $temporary ('MotionBench-live-update-'+[guid]::NewGuid().ToString('N'));$installDirectory=Join-Path $ownedRoot '中文 应用内更新\MotionBench';$executable=Join-Path $installDirectory 'MotionBench.exe';$out=Join-Path $workspace 'output\desktop-live-update'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$result=[ordered]@{synthetic=$true;passed=$false;commit=$env:GITHUB_SHA;run="https://github.com/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID";fixtureVersion='2.19.1-desktop.0';targetVersion='2.19.1-desktop.1';fixturePublished=$false;scriptSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();windowHelperSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'helpers\desktop-live-update-window.cs') -Algorithm SHA256).Hash.ToLowerInvariant()}
$installed=$false
try {
    $process=Start-Process -FilePath $fixture -ArgumentList "/S /D=$installDirectory" -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Fixture installer failed: $($process.ExitCode)" };$installed=$true
    if (-not (Test-Path -LiteralPath $executable) -or (Get-ItemProperty $registryKey).InstallLocation -ne $installDirectory) { throw 'The unpublished fixture did not install at its owned Chinese/spaced path.' }
    $env:MOTIONBENCH_LIVE_EXECUTABLE=$executable
    node (Join-Path $PSScriptRoot 'desktop-live-update-ci.cjs') update
    if ($LASTEXITCODE -ne 0) { throw 'The normal application did not complete its real public update download and save barrier.' }
    $update=Get-Content -LiteralPath (Join-Path $out 'update-results.json') -Raw | ConvertFrom-Json
    if (-not $update.passed -or -not $update.oldHostExitedNaturally -or -not $update.saveRefusalRetainedOldProgram) { throw 'The old host did not satisfy the guarded live update checks.' }
    Add-Type -Path (Join-Path $PSScriptRoot 'helpers\desktop-live-update-window.cs')
    $since=[DateTime]::Parse($update.installTriggeredAt).ToUniversalTime().Ticks;$deadline=[DateTime]::UtcNow.AddSeconds(90);$newWindow=$null
    while ([DateTime]::UtcNow -lt $deadline) {
        $windows=@([MotionBenchLiveUpdateWindow]::Find($executable,[int]$update.oldMainPid,$since))
        if ($windows.Count -eq 1) {$newWindow=$windows[0];break};if ($windows.Count -gt 1) {throw 'More than one owned restarted application window appeared.'}
        Start-Sleep -Milliseconds 200
    }
    if ($null -eq $newWindow) { throw 'The actual NSIS --force-run update did not automatically start a new owned application window.' }
    if ((Get-ItemProperty $registryKey).InstallLocation -ne $installDirectory) { throw 'The live updater changed the original installation path.' }
    if (Get-Process -Id ([int]$update.oldMainPid) -ErrorAction SilentlyContinue) { throw 'The old main process remains alive after the real restart.' }
    $result.restartedWindow=[ordered]@{processId=$newWindow.ProcessId;startedUtcTicks=$newWindow.StartedUtcTicks;executable=$newWindow.Executable;title=$newWindow.Title;className=$newWindow.ClassName}
    $restartedVersion=node -e "const fs=require('fs'),path=require('path'),asar=require('@electron/asar');const archive=path.join(path.dirname(process.env.MOTIONBENCH_LIVE_EXECUTABLE),'resources/app.asar');console.log(JSON.parse(asar.extractFile(archive,'package.json')).version);"
    if ($LASTEXITCODE -ne 0 -or $restartedVersion -ne '2.19.1-desktop.1') { throw 'The automatically restarted window is not backed by the actual target-version installed package.' };$result.restartedPackageVersion=$restartedVersion
    [MotionBenchLiveUpdateWindow]::Close($newWindow,$executable)
    $deadline=[DateTime]::UtcNow.AddSeconds(30)
    while (Get-Process -Id $newWindow.ProcessId -ErrorAction SilentlyContinue) {if ([DateTime]::UtcNow -ge $deadline) {throw 'The owned automatically restarted application did not close through its real save barrier.'};Start-Sleep -Milliseconds 200}
    node (Join-Path $PSScriptRoot 'desktop-live-update-ci.cjs') verify
    if ($LASTEXITCODE -ne 0) { throw 'The updated application did not preserve its original data, DPAPI credentials or preferences.' }
    $result.automaticNewWindowObserved=$true;$result.originalInstallLocationPreserved=$true;$result.newWindowClosedNormally=$true;$result.passed=$true
} catch {$result.error=$_.Exception.Message;throw}
finally {
    if ($installed) {
        # Only this fresh worker's exact owned executable can be stopped on failure.
        if (-not $result.passed) { Get-CimInstance Win32_Process -Filter "Name='MotionBench.exe'" | Where-Object {$_.ExecutablePath -eq $executable} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue} }
        $uninstaller=@(Get-ChildItem -LiteralPath $installDirectory -Filter '*Uninstall*.exe')
        if ($uninstaller.Count -eq 1) {
            $removed=Start-Process -FilePath $uninstaller[0].FullName -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru;$deadline=[DateTime]::UtcNow.AddSeconds(60)
            while ((Test-Path -LiteralPath $executable) -and [DateTime]::UtcNow -lt $deadline) {Start-Sleep -Milliseconds 200}
            $result.ownedInstallationRemoved=$removed.ExitCode -eq 0 -and -not (Test-Path -LiteralPath $executable);if (-not $result.ownedInstallationRemoved) {$result.passed=$false}
        } else {$result.passed=$false;$result.cleanupError='Owned uninstaller missing.'}
    }
    $producers=@();foreach ($file in @('.github/workflows/desktop-live-update.yml','scripts/check-desktop-live-fixture.cjs','tests/desktop-live-update-ci.ps1','tests/desktop-live-update-ci.cjs','tests/helpers/desktop-live-update-window.cs')) {$producers+=[ordered]@{repoPath=$file;sha256=(Get-FileHash -LiteralPath (Join-Path $workspace $file) -Algorithm SHA256).Hash.ToLowerInvariant()}};$result.producerScripts=$producers
    $artifacts=@();foreach ($file in @('fixture-package.json','update-results.json','verify-results.json','synthetic-seed.json','downloaded-update.png','save-refused-update.png')) {$artifactPath=Join-Path $out $file;if (Test-Path -LiteralPath $artifactPath) {$artifacts+=[ordered]@{path=('output/desktop-live-update/'+$file);sha256=(Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()}}};$result.artifacts=$artifacts
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $out 'live-update-results.json') -Encoding utf8
    if (-not $result.passed) {exit 1}
}
