param(
    [Parameter(Mandatory=$true)][string]$FilePath,
    [string]$Arguments = '',
    [string]$WorkingDirectory = '',
    [ValidateSet('Hidden','Normal')][string]$WindowStyle = 'Hidden',
    [string]$ReceiptPath = ''
)
$ErrorActionPreference = 'Stop'
$target = [IO.Path]::GetFullPath($FilePath)
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw 'The desktop launch target does not exist.' }
if ($WorkingDirectory -and -not (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) { throw 'The working directory does not exist.' }
if ($ReceiptPath -and (Test-Path -LiteralPath $ReceiptPath)) { throw 'Preserve the existing desktop launch receipt.' }
if (-not ('MotionBenchDesktopLauncher' -as [type])) {
 Add-Type @'
using System;using System.Runtime.InteropServices;
public static class MotionBenchDesktopLauncher {
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint processId);
}
'@
}
$shell = New-Object -ComObject Shell.Application
$windows = $shell.Windows()
$location = 0
$rootLocation = 0
$desktopHwnd = 0
$desktop = $windows.FindWindowSW([ref]$location,[ref]$rootLocation,8,[ref]$desktopHwnd,1)
if ($null -eq $desktop -or -not $desktopHwnd) { throw 'The actual Desktop automation object is unavailable.' }
[uint32]$desktopProcessId = 0
[void][MotionBenchDesktopLauncher]::GetWindowThreadProcessId([IntPtr]$desktopHwnd,[ref]$desktopProcessId)
$desktopProcess = Get-Process -Id $desktopProcessId
if ($desktopProcess.ProcessName -ne 'explorer' -or $desktopProcess.Path -ne (Join-Path $env:WINDIR 'explorer.exe')) { throw 'The Desktop automation object does not belong to the system Explorer.' }
$show = if ($WindowStyle -eq 'Hidden') { 0 } else { 1 }
$receipt = [ordered]@{method='ShellWindows.FindWindowSW(8,1).Document.Application.ShellExecute';callerProcessId=$PID;desktopProcessId=$desktopProcessId;desktopWindowHandle=$desktopHwnd;desktopExecutable=$desktopProcess.Path;targetPath=$target;targetSha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant();arguments=$Arguments;workingDirectory=$WorkingDirectory;windowStyle=$WindowStyle;launcherSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();requestedAt=[DateTime]::UtcNow.ToString('o')}
$desktop.Document.Application.ShellExecute($target,$Arguments,$WorkingDirectory,'open',$show)
$receipt.dispatched = $true
$json = $receipt | ConvertTo-Json -Depth 4
if ($ReceiptPath) { [IO.File]::WriteAllText([IO.Path]::GetFullPath($ReceiptPath),$json,[Text.UTF8Encoding]::new($false)) }
Write-Output $json
