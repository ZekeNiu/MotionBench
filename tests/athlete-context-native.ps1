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
function Find-ContextColumn($taskSheet, $taskKey) {
    for ($taskColumn = 1; $taskColumn -le $taskSheet.UsedRange.Columns.Count; $taskColumn++) {
        if ($taskSheet.Cells.Item(2, $taskColumn).Value2 -eq $taskKey) { return $taskColumn }
    }
    throw "Missing synthetic template field: $taskKey"
}
try {
    $taskExcel = New-Object -ComObject Excel.Application
    $taskExcel.Visible = $false
    $taskExcel.DisplayAlerts = $false
    $taskExcel.AutomationSecurity = 3
    $taskBook = $taskExcel.Workbooks.Open($taskInput, 0, $false)
    $taskSheet = $taskBook.Worksheets.Item(2)
    $taskDateColumn = Find-ContextColumn $taskSheet 'date'
    $taskAgeColumn = Find-ContextColumn $taskSheet 'age'
    if (-not $taskSheet.ProtectContents) { throw 'Age reference sheet protection was lost' }
    if (-not $taskSheet.Cells.Item(3, $taskAgeColumn).Locked) { throw 'Known birthday age is not locked' }
    if ($taskSheet.Cells.Item(3, $taskDateColumn).Locked -or $taskSheet.Cells.Item(4, $taskAgeColumn).Locked) { throw 'Editable date or manual fallback age is locked' }
    $taskAgeBlocked = $false
    try { $taskSheet.Cells.Item(3, $taskAgeColumn).Value2 = [double]99 } catch { $taskAgeBlocked = $true }
    if (-not $taskAgeBlocked) { throw 'Native Excel allowed editing the known birthday age reference' }
    $taskSheet.Cells.Item(3, $taskDateColumn).Value2 = '2026-10-10'
    $taskSheet.Cells.Item(4, $taskDateColumn).Value2 = '2026-10-10'
    $taskSheet.Cells.Item(4, $taskAgeColumn).Value2 = [double]21.5
    $taskMeasurements = $null
    foreach ($taskCandidate in $taskBook.Worksheets) {
        if ($taskCandidate.Name.EndsWith('_CMJ')) { $taskMeasurements = $taskCandidate; break }
    }
    if ($null -eq $taskMeasurements) { throw 'Synthetic CMJ worksheet is missing' }
    $taskHeightColumn = Find-ContextColumn $taskMeasurements 'height'
    $taskMeasurements.Cells.Item(3, $taskHeightColumn).Value2 = [double]33.5
    $taskMeasurements.Cells.Item(4, $taskHeightColumn).Value2 = [double]34.5
    $taskBook.SaveAs($taskOutput, 51)
    [pscustomobject]@{ ExcelVersion = $taskExcel.Version; Saved = $true; AgeReferenceEditBlocked = $taskAgeBlocked; Output = $taskOutput } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $taskBook) { $taskBook.Close($false); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskBook) }
    if ($null -ne $taskExcel) { $taskExcel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskExcel) }
}
