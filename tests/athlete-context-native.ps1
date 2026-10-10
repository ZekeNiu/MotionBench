$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$taskWorkspace = Split-Path -Parent $PSScriptRoot
$taskInput = Join-Path $taskWorkspace 'output\athlete-context-native-test.xlsx'
$taskOutputName = 'athlete-context-native-filled-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.xlsx'
$taskOutput = Join-Path (Join-Path $taskWorkspace 'output') $taskOutputName
$taskOutputDirectory = [System.IO.Path]::GetFullPath((Join-Path $taskWorkspace 'output'))
$taskOutput = [System.IO.Path]::GetFullPath($taskOutput)
if ([System.IO.Path]::GetDirectoryName($taskOutput) -ne $taskOutputDirectory) { throw 'Synthetic output is outside the workspace output directory' }
if (Test-Path -LiteralPath $taskOutput) { throw 'Unique synthetic output already exists' }
$taskExcel = $null
$taskBook = $null
. (Join-Path $PSScriptRoot 'excel-native-helpers.ps1')
function Find-ContextColumn($taskSheet, $taskKey) {
    $columns = Get-ExcelTemplateColumns $taskSheet $templateManifest
    if ($columns.ContainsKey($taskKey)) { return $columns[$taskKey] }
    throw "Missing synthetic template field: $taskKey"
}
try {
    $taskExcel = (New-PrivateExcelApplication).Application
    $taskExcel.Visible = $false
    $taskExcel.DisplayAlerts = $false
    $taskExcel.AutomationSecurity = 3
    $taskWorking = Join-Path $taskOutputDirectory ('context-working-' + [Guid]::NewGuid().ToString('N') + '.xlsx')
    Copy-Item -LiteralPath $taskInput -Destination $taskWorking
    $taskBook = $taskExcel.Workbooks.Open($taskWorking, 0, $false)
    try { if ($taskBook.AutoSaveOn) { $taskBook.AutoSaveOn = $false } } catch { }
    $templateManifest = Get-ExcelTemplateManifest $taskBook
    $firstDataRow = Get-ExcelTemplateFirstRow $templateManifest
    $taskSheet = $taskBook.Worksheets.Item('本次测试')
    $taskDateColumn = Find-ContextColumn $taskSheet 'date'
    $taskAgeColumn = Find-ContextColumn $taskSheet 'age'
    if (-not $taskSheet.ProtectContents) { throw 'Age reference sheet protection was lost' }
    if (-not $taskSheet.Cells.Item($firstDataRow, $taskAgeColumn).Locked) { throw 'Known birthday age is not locked' }
    if ($taskSheet.Cells.Item($firstDataRow, $taskDateColumn).Locked -or $taskSheet.Cells.Item(($firstDataRow + 1), $taskAgeColumn).Locked) { throw 'Editable date or manual fallback age is locked' }
    $taskAgeBlocked = $false
    try { $taskSheet.Cells.Item($firstDataRow, $taskAgeColumn).Value2 = [double]99 } catch { $taskAgeBlocked = $true }
    if (-not $taskAgeBlocked) { throw 'Native Excel allowed editing the known birthday age reference' }
    $taskSheet.Cells.Item($firstDataRow, $taskDateColumn).Value2 = '2026-10-10'
    $taskSheet.Cells.Item(($firstDataRow + 1), $taskDateColumn).Value2 = '2026-10-10'
    $taskSheet.Cells.Item(($firstDataRow + 1), $taskAgeColumn).Value2 = [double]21.5
    $taskMeasurements = $null
    foreach ($taskCandidate in $taskBook.Worksheets) {
        if ($taskCandidate.Name.EndsWith('_CMJ')) { $taskMeasurements = $taskCandidate; break }
    }
    if ($null -eq $taskMeasurements) { throw 'Synthetic CMJ worksheet is missing' }
    $taskHeightColumn = Find-ContextColumn $taskMeasurements 'height'
    $taskMeasurements.Cells.Item($firstDataRow, $taskHeightColumn).Value2 = [double]33.5
    $taskMeasurements.Cells.Item(($firstDataRow + 1), $taskHeightColumn).Value2 = [double]34.5
    $taskBook.SaveAs($taskOutput, 51)
    [pscustomobject]@{ ExcelVersion = $taskExcel.Version; Saved = $true; AgeReferenceEditBlocked = $taskAgeBlocked; Output = $taskOutput } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $taskBook) { $taskBook.Close($false); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskBook) }
    if ($null -ne $taskExcel) { $taskExcel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskExcel) }
}
