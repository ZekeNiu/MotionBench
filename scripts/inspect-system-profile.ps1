param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;using System.Text;using System.Runtime.InteropServices;
public class MotionBenchFileProbe {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern uint GetFinalPathNameByHandle(IntPtr h,StringBuilder s,uint n,uint flags);
}
'@
$profile = Join-Path $env:APPDATA 'MotionBench Desktop'
$files = @(Get-ChildItem -LiteralPath $profile -File -Recurse -Force -ErrorAction SilentlyContinue)
$resolved = @()
foreach ($file in $files) {
 $stream = [IO.File]::Open($file.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 try {
  $buffer=[Text.StringBuilder]::new(2048)
  $length=[MotionBenchFileProbe]::GetFinalPathNameByHandle($stream.SafeFileHandle.DangerousGetHandle(),$buffer,2048,0)
  if (-not $length) { throw 'File handle path could not be determined.' }
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $checksum = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
  $resolved += @{logical=$file.FullName;physical=$buffer.ToString();length=$file.Length;sha256=$checksum}
 } finally { $stream.Dispose() }
}
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
$parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.ParentProcessId)"
$result = @{processId=$PID;parentProcessId=$process.ParentProcessId;parentName=$parent.Name;parentExecutable=$parent.ExecutablePath;commandLine=$process.CommandLine;profile=$profile;exists=(Test-Path -LiteralPath $profile);files=$files.Count;bytes=($files | Measure-Object Length -Sum).Sum;resolvedFiles=$resolved;runnerSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();completedAt=[DateTime]::UtcNow.ToString('o')}
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $destination -Encoding utf8
