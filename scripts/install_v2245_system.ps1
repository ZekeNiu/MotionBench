$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
trap {
 $failure = @{pass=$false;processId=$PID;message=$_.Exception.Message;position=$_.InvocationInfo.PositionMessage;stack=$_.ScriptStackTrace;runnerSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();completedAt=[DateTime]::UtcNow.ToString('o')}
 $out = Join-Path $workspace 'output\implementation-2.24.5'
 New-Item -ItemType Directory -Force -Path $out | Out-Null
 $failure | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $out ('system-installation-failure-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')+'.json')) -Encoding utf8
 exit 1
}
$installation = 'D:\Application\Strength&Conditioning\MotionBench'
$checkpoint = 'D:\Application\Strength&Conditioning\MotionBench-backups\20261019-system-before-2.24.5'
$candidate = Join-Path $workspace 'dist-desktop\win-unpacked'
$installer = Join-Path $workspace 'dist-desktop\MotionBench-2.24.5-desktop.1-Setup-x64.exe'
$profile = Join-Path $env:APPDATA 'MotionBench Desktop'
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
$parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.ParentProcessId)"
if ($parent.Name -ne 'explorer.exe' -or $parent.ExecutablePath -ne (Join-Path $env:WINDIR 'explorer.exe')) { throw 'Run this installer helper through the actual Desktop Explorer broker.' }
Add-Type @'
using System;using System.Text;using System.Runtime.InteropServices;
public static class MotionBenchSystemInstallIdentity {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern uint GetFinalPathNameByHandle(IntPtr h,StringBuilder s,uint n,uint flags);
}
'@
function Get-PhysicalFile([string]$file) {
 $stream = [IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 try {
  $buffer=[Text.StringBuilder]::new(32768)
  if (-not [MotionBenchSystemInstallIdentity]::GetFinalPathNameByHandle($stream.SafeFileHandle.DangerousGetHandle(),$buffer,32768,0)) { throw 'The actual file location could not be verified.' }
  return $buffer.ToString()
 } finally { $stream.Dispose() }
}
Push-Location $workspace
try {
 python scripts/verify_v2245.py --require-candidate
 if ($LASTEXITCODE -ne 0) { throw 'The exact candidate and independent system baseline did not pass.' }
 if (@(Get-Process MotionBench -ErrorAction SilentlyContinue).Count) { throw 'Close MotionBench normally before upgrading.' }
 $manifestPath = Join-Path $checkpoint 'manifest.json'
 $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
 if (-not $manifest.complete -or $manifest.kind -ne 'system-profile-checkpoint' -or $manifest.source.virtualized -ne $false -or $manifest.source.parentName -ne 'explorer.exe') { throw 'The actual system checkpoint is incomplete.' }
 $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
 $physical = @()
 foreach ($entry in $manifest.files) {
  $original = [IO.Path]::GetFullPath((Join-Path $profile $entry.path))
  $savedRoot = Join-Path $checkpoint 'system-userdata'
  $saved = [IO.Path]::GetFullPath((Join-Path $savedRoot $entry.path))
  if ($entry.kind -ne 'userdata' -or -not $original.StartsWith($profile+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $saved.StartsWith($savedRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $seen.Add($original)) { throw 'Invalid or duplicate system checkpoint entry.' }
  $finalPath = Get-PhysicalFile $original
  if ($finalPath -ne $entry.physical -or -not $finalPath.StartsWith('\\?\'+$profile+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'The installer is seeing a redirected profile.' }
  foreach ($file in @($original,$saved)) {
   if ((Get-Item -LiteralPath $file).Length -ne $entry.bytes -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'Actual user data changed after the system checkpoint; preserve the newer state first.' }
  }
  $physical += @{logical=$original;physical=$finalPath;sha256=$entry.sha256;bytes=$entry.bytes}
 }
 $currentFiles = @(Get-ChildItem -LiteralPath $profile -File -Recurse -Force)
 if ($currentFiles.Count -ne $seen.Count -or @($currentFiles | Where-Object { -not $seen.Contains($_.FullName) }).Count) { throw 'Actual profile file inventory changed after checkpoint.' }
 foreach ($entry in $manifest.programReference.files) {
  $file = [IO.Path]::GetFullPath((Join-Path $installation $entry.path))
  if (-not $file.StartsWith($installation+'\',[StringComparison]::OrdinalIgnoreCase) -or (Get-Item -LiteralPath $file).Length -ne $entry.bytes -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'The original installed program changed after checkpoint.' }
 }
 $result = [ordered]@{pass=$false;version='2.24.5-desktop.1';installationDirectory=$installation;profilePath=$profile;processId=$PID;parentProcessId=$parent.ProcessId;parentName=$parent.Name;parentExecutable=$parent.ExecutablePath;runnerSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();verifierSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'verify_v2245.py') -Algorithm SHA256).Hash.ToLowerInvariant();systemManifestSha256=(Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant();installerSha256=(Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant();physicalFiles=$physical;checks=@()}
 $installationProcess = Start-Process -FilePath $installer -ArgumentList "/S /D=$installation" -WindowStyle Hidden -PassThru -Wait
 $result.installerExitCode = $installationProcess.ExitCode
 if ($installationProcess.ExitCode -ne 0) { throw "The installer returned $($installationProcess.ExitCode)." }
 foreach ($file in @('MotionBench.exe','resources/app.asar')) {
  $actual = (Get-FileHash -LiteralPath (Join-Path $installation $file) -Algorithm SHA256).Hash.ToLowerInvariant()
  $expected = (Get-FileHash -LiteralPath (Join-Path $candidate $file) -Algorithm SHA256).Hash.ToLowerInvariant()
  $result.checks += @{file=$file;sha256=$actual;matchesTestedPackage=($actual -eq $expected)}
  if ($actual -ne $expected) { throw 'Installed program differs from the verified candidate.' }
 }
 $result.pass = $true
 $result.completedAt = [DateTime]::UtcNow.ToString('o')
 $out = Join-Path $workspace 'output\implementation-2.24.5'
 New-Item -ItemType Directory -Force -Path $out | Out-Null
 $result | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $out 'system-installation.json') -Encoding utf8
 Write-Output 'Installed verified MotionBench 2.24.5-desktop.1 through the actual Desktop context.'
} finally { Pop-Location }
