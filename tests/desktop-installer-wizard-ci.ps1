param([Parameter(Mandatory)][string]$InstallerPath,[Parameter(Mandatory)][string]$ProposedDirectory,[Parameter(Mandatory)][string]$ResultDirectory)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:CI -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'Installer probes run only in the isolated GitHub Actions Windows user.' }
$workspaceRoot = [IO.Path]::GetFullPath($env:GITHUB_WORKSPACE)
$temporaryRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP)
$installer = [IO.Path]::GetFullPath($InstallerPath)
$proposed = [IO.Path]::GetFullPath($ProposedDirectory)
$outputFolder = [IO.Path]::GetFullPath($ResultDirectory)
if (-not $installer.StartsWith($workspaceRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or -not $outputFolder.StartsWith($workspaceRoot + '\output\', [StringComparison]::OrdinalIgnoreCase) -or -not $proposed.StartsWith($temporaryRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Installer probe paths are outside their owned CI directories.' }
if (-not (Test-Path -LiteralPath $installer) -or (Test-Path -LiteralPath $proposed)) { throw 'The installer or fresh synthetic directory is invalid.' }
New-Item -ItemType Directory -Force -Path $outputFolder | Out-Null
Add-Type -Path (Join-Path $PSScriptRoot 'helpers\desktop-installer-native.cs')
$registryKey = 'HKCU:\Software\7ab680cb-2a51-5387-9959-bfceb2c524d6'
$before = if (Test-Path $registryKey) { (Get-ItemProperty $registryKey).InstallLocation } else { '' }
$result = [ordered]@{ synthetic=$true; passed=$false; installerSha256=(Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant(); scriptSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant(); helperSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'helpers\desktop-installer-native.cs') -Algorithm SHA256).Hash.ToLowerInvariant(); checkedAt=[DateTime]::UtcNow.ToString('o'); desktopSwitched=$false }
$private = $null
try {
    $private = [MotionBenchInstallerDesktop]::new($installer)
    $result.privateDesktop=$private.Name; $result.ownedProcessId=$private.ProcessId
    $deadline=[DateTime]::UtcNow.AddSeconds(30); $dialog=[IntPtr]::Zero; $edit=[IntPtr]::Zero; $browse=[IntPtr]::Zero
    while ([DateTime]::UtcNow -lt $deadline -and $edit -eq [IntPtr]::Zero) {
        foreach ($window in $private.Windows()) {
            $children=@([MotionBenchInstallerDesktop]::Children($window))
            $candidate=@($children | Where-Object { [MotionBenchInstallerDesktop]::ClassName($_) -eq 'Edit' -and [MotionBenchInstallerDesktop]::Text($_) -match '^[A-Za-z]:[\\/]' })
            if ($candidate.Count) { $dialog=$window; $edit=$candidate[0]; $browse=@($children | Where-Object { [MotionBenchInstallerDesktop]::ClassName($_) -eq 'Button' -and ([MotionBenchInstallerDesktop]::Text($_) -replace '&','') -match 'Browse|浏览' })[0]; break }
            $next=[MotionBenchInstallerDesktop]::GetDlgItem($window,1)
            if ($next -ne [IntPtr]::Zero -and [MotionBenchInstallerDesktop]::Text($next) -match 'Next|下一步') { [MotionBenchInstallerDesktop]::Click($next) }
        }
        if ($edit -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 150 }
    }
    if ($dialog -ne [IntPtr]::Zero) { $result.directoryPageControls=@([MotionBenchInstallerDesktop]::Children($dialog) | ForEach-Object { [ordered]@{class=[MotionBenchInstallerDesktop]::ClassName($_);text=[MotionBenchInstallerDesktop]::Text($_);enabled=[MotionBenchInstallerDesktop]::IsWindowEnabled($_)} }) }
    if ($edit -eq [IntPtr]::Zero -or $null -eq $browse -or $browse -eq [IntPtr]::Zero -or -not [MotionBenchInstallerDesktop]::IsWindowEnabled($browse)) { throw 'The actual installer did not show an editable path and enabled Browse button.' }
    $result.ownedGuiProcessIds=@($private.WindowProcessIds())
    $result.originalDisplayedPath=[MotionBenchInstallerDesktop]::Text($edit)
    [MotionBenchInstallerDesktop]::SetText($edit,$proposed)
    $result.chosenDisplayedPath=[MotionBenchInstallerDesktop]::Text($edit)
    if ($result.chosenDisplayedPath -ne $proposed) { throw 'The directory page did not accept the Chinese/spaced installation path.' }
    $capture=Join-Path $outputFolder 'installation-directory-page.bmp'
    [MotionBenchInstallerDesktop]::Screenshot($dialog,$capture)
    $result.screenshotSha256=(Get-FileHash -LiteralPath $capture -Algorithm SHA256).Hash.ToLowerInvariant()
    $result.pathEditorPresent=$true; $result.browsePresent=$true
    [MotionBenchInstallerDesktop]::Click([MotionBenchInstallerDesktop]::GetDlgItem($dialog,2))
    $cancelDeadline=[DateTime]::UtcNow.AddSeconds(15)
    while ((-not $private.Exited -or $private.Windows().Length -gt 0) -and [DateTime]::UtcNow -lt $cancelDeadline) {
        foreach ($window in $private.Windows()) { [MotionBenchInstallerDesktop]::Click([MotionBenchInstallerDesktop]::GetDlgItem($window,6)) }
        Start-Sleep -Milliseconds 100
    }
    if (-not $private.Exited -or $private.Windows().Length -gt 0) { throw 'The owned installer did not exit after Cancel.' }
    $after = if (Test-Path $registryKey) { (Get-ItemProperty $registryKey).InstallLocation } else { '' }
    if ($after -ne $before -or (Test-Path -LiteralPath (Join-Path $proposed 'MotionBench.exe'))) { throw 'Cancelling the directory page changed the installation.' }
    $result.cancelledBeforeInstall=$true; $result.passed=$true
} catch {
    $result.error=$_.Exception.Message
    if ($null -ne $private) {
        $result.failureWindows=@($private.Windows() | ForEach-Object { $window=$_; [ordered]@{class=[MotionBenchInstallerDesktop]::ClassName($window);text=[MotionBenchInstallerDesktop]::Text($window);controls=@([MotionBenchInstallerDesktop]::Children($window) | ForEach-Object { [ordered]@{class=[MotionBenchInstallerDesktop]::ClassName($_);text=[MotionBenchInstallerDesktop]::Text($_);enabled=[MotionBenchInstallerDesktop]::IsWindowEnabled($_)} })} })
        if ($dialog -ne [IntPtr]::Zero) { try { [MotionBenchInstallerDesktop]::Screenshot($dialog,(Join-Path $outputFolder 'failure-directory-page.bmp')) } catch { $result.failureCaptureError=$_.Exception.Message } }
    }
    throw
}
finally { if ($null -ne $private) { $private.Dispose(); $result.privateDesktopClosed=$private.DesktopClosed }; $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outputFolder 'wizard-results.json') -Encoding utf8 }
