param([switch]$VerifyExistingCopies)
$ErrorActionPreference = 'Stop'
$workspace = 'D:\OneDrive\工作\言鼎\测试工作台'
$destination = 'D:\Application\Strength&Conditioning\MotionBench-backups\20261019-system-before-2.24.5'
$installation = 'D:\Application\Strength&Conditioning\MotionBench'
$profile = Join-Path $env:APPDATA 'MotionBench Desktop'
$receiptDirectory = Join-Path $workspace 'output\implementation-2.24.5'
[void][IO.Directory]::CreateDirectory($receiptDirectory)
trap {
 $failure = @{pass=$false;message=$_.Exception.Message;position=$_.InvocationInfo.PositionMessage;completedAt=[DateTime]::UtcNow.ToString('o')}
 [IO.File]::WriteAllText((Join-Path $receiptDirectory ('checkpoint-failure-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')+'.json')),($failure|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
 exit 1
}
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
$parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.ParentProcessId)"
if ($parent.Name -ne 'explorer.exe' -or $parent.ExecutablePath -ne (Join-Path $env:WINDIR 'explorer.exe')) { throw 'Use the real Desktop Explorer broker.' }
if ((Test-Path -LiteralPath $destination) -and -not $VerifyExistingCopies) { throw 'Preserve the existing checkpoint; verify its copies explicitly.' }
if (Test-Path -LiteralPath (Join-Path $destination 'manifest.json')) { throw 'Preserve the completed checkpoint.' }
Add-Type @'
using System;using System.Text;using System.Runtime.InteropServices;
public static class MotionBenchCheckpoint2245 {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern uint GetFinalPathNameByHandle(IntPtr h,StringBuilder s,uint n,uint flags);
}
'@
function Read-Identity([string]$file) {
 $stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 try {
  $buffer=[Text.StringBuilder]::new(32768)
  if (-not [MotionBenchCheckpoint2245]::GetFinalPathNameByHandle($stream.SafeFileHandle.DangerousGetHandle(),$buffer,32768,0)) { throw 'Physical file path unavailable.' }
  $sha=[Security.Cryptography.SHA256]::Create()
  try { $checksum=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
  return @{physical=$buffer.ToString();bytes=$stream.Length;sha256=$checksum}
 } finally { $stream.Dispose() }
}
$closed=@()
foreach ($appProcess in @(Get-Process MotionBench -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })) {
 if ($appProcess.Path -ne (Join-Path $installation 'MotionBench.exe')) { throw 'An independent MotionBench instance is running.' }
 $appProcessId=$appProcess.Id
 $requested=$appProcess.CloseMainWindow()
 if (-not $requested -or -not $appProcess.WaitForExit(60000)) { throw 'The normal application close did not complete; no backup was taken.' }
 $closed+=@{processId=$appProcessId;method='CloseMainWindow';requested=$requested;exited=$true}
}
if (@(Get-Process MotionBench -ErrorAction SilentlyContinue).Count) { throw 'A MotionBench process remains; preserve its data and retry after normal exit.' }
[void][IO.Directory]::CreateDirectory($destination)
function Copy-Tree([string]$sourceRoot,[string[]]$folders,[string]$kind) {
 $prefix=[IO.Path]::GetFullPath($sourceRoot).TrimEnd('\')+'\'
 $physicalPrefix='\\?\'+$prefix
 $sourceFiles=@(Get-ChildItem -LiteralPath $sourceRoot -File -Recurse -Force | Sort-Object FullName)
 if (-not $sourceFiles.Count) { throw 'Checkpoint source is empty.' }
 $entries=@()
 foreach ($sourceFile in $sourceFiles) {
  $identity=Read-Identity $sourceFile.FullName
  if (-not $identity.physical.StartsWith($physicalPrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'A source file is redirected outside the actual source root.' }
  $relative=$sourceFile.FullName.Substring($prefix.Length)
  foreach ($folder in $folders) {
   $targetRoot=[IO.Path]::GetFullPath((Join-Path $destination $folder))
   $target=[IO.Path]::GetFullPath((Join-Path $targetRoot $relative))
   if (-not $target.StartsWith($targetRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Checkpoint target escaped its assigned directory.' }
   [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
   if (-not $VerifyExistingCopies) { [IO.File]::Copy($sourceFile.FullName,$target,$false) }
   $copy=Read-Identity $target
   if ($copy.sha256 -ne $identity.sha256 -or $copy.bytes -ne $identity.bytes) { throw 'Copied bytes differ.' }
  }
  $entries+=@{kind=$kind;path=$relative.Replace('\','/');logical=$sourceFile.FullName;physical=$identity.physical;bytes=$identity.bytes;sha256=$identity.sha256}
 }
 $after=@(Get-ChildItem -LiteralPath $sourceRoot -File -Recurse -Force | Sort-Object FullName)
 if (($after.FullName -join "`n") -cne ($sourceFiles.FullName -join "`n")) { throw 'Source inventory changed during backup.' }
 foreach ($entry in $entries) {
  $current=Read-Identity $entry.logical
  if ($current.sha256 -ne $entry.sha256 -or $current.bytes -ne $entry.bytes -or $current.physical -ne $entry.physical) { throw 'Source changed during backup.' }
 }
 return $entries
}
$program=@(Copy-Tree $installation @('program') 'program')
$files=@(Copy-Tree $profile @('system-userdata','system-baseline-profile','system-candidate-profile') 'userdata')
[long]$totalBytes=0
foreach ($entry in $files) { $totalBytes+=$entry.bytes }
$result=[ordered]@{schema=1;kind='system-profile-checkpoint';complete=$true;sourceCommit='fe6049ba3d88e0cb535a0dd262aaccdf8d4d8ca2';runnerSha256=(Read-Identity $PSCommandPath).sha256;source=@{profile=$profile;processId=$PID;parentProcessId=$parent.ProcessId;parentName=$parent.Name;parentExecutable=$parent.ExecutablePath;physicalRoot=([IO.Path]::GetFullPath($profile).TrimEnd('\')+'\');virtualized=$false};programReference=@{installationDirectory=$installation;checkpoint=$destination;files=$program};files=$files;fileCount=$files.Count;bytes=$totalBytes;copies=@('system-userdata','system-baseline-profile','system-candidate-profile');closeEvidence=$closed;sourceUnchanged=$true;completedAt=[DateTime]::UtcNow.ToString('o')}
$json=$result|ConvertTo-Json -Depth 9
$temporary=Join-Path $destination 'manifest.pending.json'
[IO.File]::WriteAllText($temporary,$json,[Text.UTF8Encoding]::new($false))
[IO.File]::Move($temporary,(Join-Path $destination 'manifest.json'))
[IO.File]::WriteAllText((Join-Path $receiptDirectory 'checkpoint-complete.json'),(@{pass=$true;manifest=(Join-Path $destination 'manifest.json');manifestSha256=(Read-Identity (Join-Path $destination 'manifest.json')).sha256;userdataFiles=$files.Count;programFiles=$program.Count;closed=$closed}|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
