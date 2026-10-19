$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$installation = 'D:\Application\Strength&Conditioning\MotionBench'
$reference = Get-Content -LiteralPath 'D:\Application\Strength&Conditioning\MotionBench-backups\20261019-system-before-2.24.5\verification\reopened\snapshot.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$owner = $reference.library.athletes | Where-Object { $_.id -eq $reference.active.athleteId } | Select-Object -First 1
$expectedName = $owner.name
$expectedDates = @($reference.active.dates)
if (-not $expectedName -or $expectedDates.Count -lt 2) { throw 'The saved comparison reference is incomplete.' }
$artifactDirectory = Join-Path $workspace 'output\implementation-2.24.5'
New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
if (Get-Process MotionBench -ErrorAction SilentlyContinue) { throw 'Close existing MotionBench windows normally before checking the system shortcut.' }
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'MotionBench.lnk'
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcut = $shortcutShell.CreateShortcut($shortcutPath)
$targetPath = [IO.Path]::GetFullPath($shortcut.TargetPath)
if ($targetPath -ne (Join-Path $installation 'MotionBench.exe') -or $shortcut.Arguments) { throw 'The actual system shortcut does not point directly to this installation.' }

# Launch the user's interactive application through the unchanged system link.
$desktopLaunchReceipt = Join-Path $artifactDirectory 'shortcut-desktop-launch.json'
& (Join-Path $PSScriptRoot 'invoke-from-desktop.ps1') -FilePath $shortcutPath -WindowStyle Normal -ReceiptPath $desktopLaunchReceipt | Out-Null
$deadline = [DateTime]::UtcNow.AddSeconds(45)
$nativeWindow = $null
do {
 $nativeWindow = Get-Process MotionBench -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path -eq $targetPath } | Select-Object -First 1
 if (-not $nativeWindow) { Start-Sleep -Milliseconds 500 }
} while (-not $nativeWindow -and [DateTime]::UtcNow -lt $deadline)
if (-not $nativeWindow) { throw 'No visible application window appeared after the normal shortcut launch.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;using System.Runtime.InteropServices;
public class MotionBenchShortcutWindow {
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
}
'@
$windowElement = [System.Windows.Automation.AutomationElement]::FromHandle($nativeWindow.MainWindowHandle)
$found = $false
do {
 $controls = $windowElement.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 $textValues = [Collections.Generic.List[string]]::new()
 foreach ($control in $controls) {
  if ($control.Current.Name) { $textValues.Add($control.Current.Name) }
  $pattern = $null
  if ($control.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) {
   if ($pattern.Current.Value) { $textValues.Add($pattern.Current.Value) }
  }
 }
 $allText = $textValues -join "`n"
 $dates = @($expectedDates | Where-Object { $allText.Contains($_) })
 $found = $allText.Contains($expectedName) -and $dates.Count -eq $expectedDates.Count -and $allText.Contains('下降') -and $allText.Contains('改善')
 if (-not $found) { Start-Sleep -Milliseconds 500 }
} while (-not $found -and [DateTime]::UtcNow -lt $deadline)
if (-not $found) { throw 'The native accessibility tree did not expose the saved example and all saved dates.' }
$processInformation = Get-CimInstance Win32_Process -Filter "ProcessId = $($nativeWindow.Id)"
if ($processInformation.CommandLine -match '--motionbench-|--remote-debugging|--inspect') { throw 'The shortcut did not use an ordinary startup.' }
$desktopLaunch = Get-Content -LiteralPath $desktopLaunchReceipt -Raw | ConvertFrom-Json
if ($processInformation.ParentProcessId -ne $desktopLaunch.desktopProcessId) { throw 'The visible application was not launched by the system Desktop Explorer.' }
$renderer = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($nativeWindow.Id)" | Where-Object { $_.CommandLine -match '--type=renderer' } | Select-Object -First 1
$profile = Join-Path $env:APPDATA 'MotionBench Desktop'
if ($renderer.CommandLine -notmatch '--user-data-dir="([^"]+)"' -or [IO.Path]::GetFullPath($Matches[1]) -ne [IO.Path]::GetFullPath($profile)) { throw 'The ordinary process used a different data directory.' }
$result = [ordered]@{
 pass=$true;sourceHash=(Get-FileHash -LiteralPath (Join-Path $workspace 'MotionBench.html') -Algorithm SHA256).Hash.ToLowerInvariant()
 runnerSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
 shortcutPath=$shortcutPath;shortcutSha256=(Get-FileHash -LiteralPath $shortcutPath -Algorithm SHA256).Hash.ToLowerInvariant();targetPath=$targetPath
 executableSha256=(Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()
 archiveSha256=(Get-FileHash -LiteralPath (Join-Path $installation 'resources\app.asar') -Algorithm SHA256).Hash.ToLowerInvariant()
 normalStartup=$true;launchArgs=@();profilePath=$profile
 desktopLaunch=@{file='output/implementation-2.24.5/shortcut-desktop-launch.json';sha256=(Get-FileHash -LiteralPath $desktopLaunchReceipt -Algorithm SHA256).Hash.ToLowerInvariant();parentProcessId=$processInformation.ParentProcessId}
 window=@{visible=[MotionBenchShortcutWindow]::IsWindowVisible($nativeWindow.MainWindowHandle);processId=$nativeWindow.Id;title=$nativeWindow.MainWindowTitle}
 uia=@{athleteName=$expectedName;selectedDates=$dates;found=$found;controlCount=$controls.Count}
 errors=@();artifacts=@();completedAt=[DateTime]::UtcNow.ToString('o')
}
if (-not $result.window.visible) { throw 'The application window was not visible.' }
# Capture only this application's window; never copy the user's entire screen.
Add-Type -AssemblyName System.Drawing
$bounds = New-Object MotionBenchShortcutWindow+RECT
[MotionBenchShortcutWindow]::GetWindowRect($nativeWindow.MainWindowHandle,[ref]$bounds) | Out-Null
$bitmap = [Drawing.Bitmap]::new(($bounds.Right-$bounds.Left),($bounds.Bottom-$bounds.Top))
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$deviceContext = $graphics.GetHdc()
try { $captured = [MotionBenchShortcutWindow]::PrintWindow($nativeWindow.MainWindowHandle,$deviceContext,2) }
finally { $graphics.ReleaseHdc($deviceContext) }
try {
 if ($captured) {
  $colors = [Collections.Generic.HashSet[int]]::new()
  for ($sampleY=0;$sampleY -lt $bitmap.Height;$sampleY+=32) { for ($sampleX=0;$sampleX -lt $bitmap.Width;$sampleX+=32) { $colors.Add($bitmap.GetPixel($sampleX,$sampleY).ToArgb()) | Out-Null } }
  if ($colors.Count -gt 16) {
   $imagePath = Join-Path $artifactDirectory 'shortcut-window.png'
   $bitmap.Save($imagePath,[Drawing.Imaging.ImageFormat]::Png)
   $result.artifacts += @{file='output/implementation-2.24.5/shortcut-window.png';sha256=(Get-FileHash -LiteralPath $imagePath -Algorithm SHA256).Hash.ToLowerInvariant()}
  }
 }
} finally { $graphics.Dispose();$bitmap.Dispose() }
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $artifactDirectory 'shortcut-check.json') -Encoding utf8
Write-Output 'The unchanged desktop shortcut visibly opened the existing saved comparison.'
