param(
    [string]$InputPath = (Join-Path $PSScriptRoot '..\output\excel-native\template.xlsx'),
    [string]$ResultPath = (Join-Path $PSScriptRoot '..\output\excel-native\native-open-result.json'),
    [int]$TimeoutSeconds = 45,
    [switch]$Worker,
    [string]$ProgressPath = '',
    [string]$ExistingExcelIds = ''
)
$ErrorActionPreference = 'Stop'
$inputFile = [IO.Path]::GetFullPath($InputPath)
$resultFile = [IO.Path]::GetFullPath($ResultPath)
if (-not (Test-Path -LiteralPath $inputFile)) { throw 'The unchanged native Excel template fixture is required.' }
function File-Hash([string]$file) { (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
function Write-Evidence($value, [string]$file) { $value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $file -Encoding utf8 }

if ($Worker) {
    $excel = $null; $books = $null; $workbook = $null; $owned = $false
    $priorIds = @($ExistingExcelIds.Split(',') | Where-Object { $_ } | ForEach-Object { [int]$_ })
    $result = [ordered]@{
        pass = $false; application = 'Microsoft Excel'; input = $inputFile
        inputSha256 = (File-Hash $inputFile)
        sourceSha256 = (File-Hash (Join-Path $PSScriptRoot '..\src\ringside-excel.js'))
        artifactSha256 = (File-Hash (Join-Path $PSScriptRoot '..\MotionBench.html'))
        normalOpenCompleted = $false; corruptLoad = 0; preexistingExcelPids = $priorIds
        corruptLoadSource = 'Omitted argument: Microsoft-documented xlNormalLoad default, with no recovery through the object model'
        methodDocumentation = 'https://learn.microsoft.com/en-us/office/vba/api/excel.workbooks.open'
        checkedUtc = [DateTime]::UtcNow.ToString('o')
    }
    try {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ExcelOpenProcess {
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
}
'@
        $excel = New-Object -ComObject Excel.Application
        [uint32]$excelProcessId = 0
        [void][ExcelOpenProcess]::GetWindowThreadProcessId([IntPtr]$excel.Hwnd, [ref]$excelProcessId)
        if ($excelProcessId -eq 0 -or $priorIds -contains [int]$excelProcessId) {
            throw 'The COM instance could not be identified as a new owned Excel process; no application settings were changed.'
        }
        $owned = $true
        $process = Get-Process -Id $excelProcessId
        $result.ownedExcelPid = [int]$excelProcessId
        $progressState = @{ ownedExcelPid = [int]$excelProcessId; startedUtc = $process.StartTime.ToUniversalTime().ToString('o'); stage = 'owned-application-created' }
        function Write-Stage([string]$stage) { $progressState.stage = $stage; $progressState.evidence = $result; Write-Evidence $progressState $ProgressPath }
        Write-Stage 'before-visible-false'
        $excel.Visible = $false
        Write-Stage 'after-visible-false'
        $excel.DisplayAlerts = $true
        Write-Stage 'after-display-alerts-true'
        $excel.EnableEvents = $false
        Write-Stage 'after-enable-events-false'
        $excel.AutomationSecurity = 3
        Write-Stage 'after-automation-security'
        $result.version = [string]$excel.Version
        Write-Stage 'after-version-read'
        $result.displayAlertsOnOpen = [bool]$excel.DisplayAlerts
        Write-Stage 'after-display-alerts-read'
        $result.visibleOnOpen = [bool]$excel.Visible
        Write-Stage 'after-visible-read'
        $books = $excel.Workbooks
        Write-Stage 'before-normal-open'
        $timer = [Diagnostics.Stopwatch]::StartNew()
        # Microsoft's documentation states that omitted CorruptLoad uses xlNormalLoad
        # and does not attempt recovery through the object model. No repair/extract flag is used.
        # Use the working repository's three-argument call, changing only alerts and read-only mode.
        $workbook = $books.Open($inputFile, 0, $true)
        $timer.Stop()
        $result.normalOpenCompleted = $true
        $result.openElapsedMs = $timer.ElapsedMilliseconds
        Write-Stage 'normal-open-returned'
        $result.savedOriginalOnOpen = [bool]$workbook.Saved
        Write-Stage 'after-saved-read'
        $result.readOnlyOnOpen = [bool]$workbook.ReadOnly
        Write-Stage 'after-readonly-read'
        $result.openedName = [string]$workbook.Name
        Write-Stage 'after-name-read'
        $result.openedFullName = [string]$workbook.FullName
        Write-Stage 'after-fullname-read'
        $result.fileFormat = [int]$workbook.FileFormat
        Write-Stage 'after-format-read'
        $result.workbooksCount = [int]$books.Count
        Write-Stage 'after-workbooks-count'
        $sheets = $workbook.Worksheets
        Write-Stage 'after-worksheets-read'
        $result.sheetCount = [int]$sheets.Count
        Write-Stage 'before-sheet-names'
        $result.sheets = @(for ($index = 1; $index -le $sheets.Count; $index++) {
            $sheet = $sheets.Item($index)
            [string]$sheet.Name
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet)
        })
        Write-Stage 'after-sheet-names'
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheets)
        $result.displayAlertsAfterOpen = [bool]$excel.DisplayAlerts
        Write-Stage 'before-close'
        $workbook.Close($false)
        Write-Stage 'after-close'
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook); $workbook = $null
        $result.inputSha256After = File-Hash $inputFile
        $result.returnedPathKind = if ($result.openedFullName -match '^https://') { 'Excel cloud-provider URL' } else { 'Local path' }
        $result.pass = $result.displayAlertsOnOpen -and $result.displayAlertsAfterOpen -and (-not $result.visibleOnOpen) -and $result.readOnlyOnOpen -and $result.savedOriginalOnOpen -and ($result.fileFormat -eq 51) -and ($result.openedName -eq [IO.Path]::GetFileName($inputFile)) -and ($result.inputSha256 -eq $result.inputSha256After)
        Write-Stage 'open-check-complete'
        if (-not $result.pass) { $result.error = 'Normal opening completed, but at least one unchanged-file or workbook-state check failed.' }
    }
    catch { $result.error = $_.Exception.Message }
    finally {
        if ($null -ne $workbook -and $owned) { try { $workbook.Close($false) } catch {}; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) }
        if ($null -ne $books) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($books) }
        if ($null -ne $excel) {
            if ($owned) { try { Write-Stage 'before-quit'; $excel.Quit(); Write-Stage 'after-quit' } catch {} }
            else { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
            $excel = $null
        }
        # FinalReleaseComObject / a forced finalizer wait can block after Excel.Quit has
        # already returned. This isolated worker exits after recording the verified facts;
        # its parent checks and cleans up only the recorded owned process if necessary.
        Write-Evidence $result $resultFile
    }
    if (-not $result.pass) { [Environment]::Exit(1) }
    [Environment]::Exit(0)
}

$folder = [IO.Path]::GetDirectoryName($resultFile)
[void][IO.Directory]::CreateDirectory($folder)
$progressFile = Join-Path $folder ('native-open-progress-' + [Guid]::NewGuid().ToString('N') + '.json')
$priorIds = @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$hashBefore = File-Hash $inputFile
$protectedBefore = @{}
foreach ($name in @('template.xlsx', 'excel-saved.xlsx', 'seed.json', 'native-seed.json')) {
    $candidate = Join-Path ([IO.Path]::GetDirectoryName($inputFile)) $name
    if (Test-Path -LiteralPath $candidate) { $protectedBefore[$candidate] = File-Hash $candidate }
}
$quote = { param([string]$value) "'" + $value.Replace("'", "''") + "'" }
$workerCommand = '& ' + (& $quote $PSCommandPath) + ' -Worker -InputPath ' + (& $quote $inputFile) + ' -ResultPath ' + (& $quote $resultFile) + ' -ProgressPath ' + (& $quote $progressFile) + ' -ExistingExcelIds ' + (& $quote ($priorIds -join ','))
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($workerCommand))
$hostExecutable = (Get-Process -Id $PID).Path
$logStem = [IO.Path]::GetFileNameWithoutExtension($resultFile)
$child = Start-Process -FilePath $hostExecutable -ArgumentList @('-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $folder ($logStem + '-worker.log')) -RedirectStandardError (Join-Path $folder ($logStem + '-worker-error.log'))
$finished = $child.WaitForExit($TimeoutSeconds * 1000)
if (-not $finished) {
    $stoppedExcelId = $null
    if (Test-Path -LiteralPath $progressFile) {
        $progress = Get-Content -LiteralPath $progressFile -Raw | ConvertFrom-Json
        $ownedProcess = Get-Process -Id $progress.ownedExcelPid -ErrorAction SilentlyContinue
        if ($null -ne $ownedProcess -and $ownedProcess.ProcessName -eq 'EXCEL' -and $priorIds -notcontains $ownedProcess.Id -and $ownedProcess.StartTime.ToUniversalTime().Ticks -eq ([DateTime]$progress.startedUtc).ToUniversalTime().Ticks) {
            $stoppedExcelId = $ownedProcess.Id
            Stop-Process -Id $ownedProcess.Id -Force
        }
    }
    if (-not $child.WaitForExit(2000)) { Stop-Process -Id $child.Id -Force }
    $timeoutResult = [ordered]@{
        pass = $false; normalOpenCompleted = $false; timedOut = $true
        error = 'The independent COM check did not complete before the timeout. See lastStage for the last completed boundary; no prompt was accepted.'
        input = $inputFile; inputSha256 = $hashBefore; inputSha256After = (File-Hash $inputFile)
        sourceSha256 = (File-Hash (Join-Path $PSScriptRoot '..\src\ringside-excel.js'))
        artifactSha256 = (File-Hash (Join-Path $PSScriptRoot '..\MotionBench.html'))
        lastStage = $progress.stage; timeoutSeconds = $TimeoutSeconds
        completedEvidence = $progress.evidence
        displayAlertsRequested = $true; corruptLoad = 0; stoppedOwnedExcelPid = $stoppedExcelId
        preexistingExcelPids = $priorIds; checkedUtc = [DateTime]::UtcNow.ToString('o')
    }
    Write-Evidence $timeoutResult $resultFile
}
if (-not (Test-Path -LiteralPath $resultFile)) { throw 'The native normal-open worker returned without an evidence file.' }
$result = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
if ($finished -and (Test-Path -LiteralPath $progressFile)) {
    $progress = Get-Content -LiteralPath $progressFile -Raw | ConvertFrom-Json
    $ownedProcess = Get-Process -Id $progress.ownedExcelPid -ErrorAction SilentlyContinue
    $forcedCleanup = $false
    if ($null -ne $ownedProcess -and $ownedProcess.ProcessName -eq 'EXCEL' -and $priorIds -notcontains $ownedProcess.Id -and $ownedProcess.StartTime.ToUniversalTime().Ticks -eq ([DateTime]$progress.startedUtc).ToUniversalTime().Ticks) {
        if (-not $ownedProcess.WaitForExit(2000)) { Stop-Process -Id $ownedProcess.Id -Force; $forcedCleanup = $true }
    }
    $result | Add-Member -NotePropertyName ownedExcelCleanupForced -NotePropertyValue $forcedCleanup -Force
}
$result | Add-Member -NotePropertyName preexistingExcelProcessesStillRunning -NotePropertyValue @($priorIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }) -Force
$protectedChecks = @($protectedBefore.Keys | ForEach-Object { [ordered]@{path = $_; beforeSha256 = $protectedBefore[$_]; afterSha256 = (File-Hash $_)} })
$result | Add-Member -NotePropertyName protectedFiles -NotePropertyValue $protectedChecks -Force
$result | Add-Member -NotePropertyName protectedFilesUnchanged -NotePropertyValue (@($protectedChecks | Where-Object { $_.beforeSha256 -ne $_.afterSha256 }).Count -eq 0) -Force
$result.pass = $result.pass -and $result.protectedFilesUnchanged
Write-Evidence $result $resultFile
$result | ConvertTo-Json -Depth 8
if (-not $result.pass) { exit 1 }
