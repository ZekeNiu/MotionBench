param([string]$FixturePath = (Join-Path $PSScriptRoot '..\output\tests\v219-excel-native\fixture.json'))
$ErrorActionPreference = 'Stop'
$fixture = Get-Content -LiteralPath $FixturePath -Raw -Encoding UTF8 | ConvertFrom-Json
$excel = $null
$book = $null
$started = [DateTime]::UtcNow.ToString("o")
$inputHash = (Get-FileHash -LiteralPath $fixture.input -Algorithm SHA256).Hash.ToLowerInvariant()
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    $book = $excel.Workbooks.Open($fixture.input, 0, $true)
    foreach ($write in $fixture.writes) {
        $sheet = $book.Worksheets.Item($write.sheet)
        $sheet.Cells.Item([int]$write.row, [int]$write.column).Value2 = [double]$write.value
    }
    $sheet = $book.Worksheets.Item($fixture.addColumn.sheet)
    $table = $sheet.ListObjects.Item($fixture.addColumn.table)
    $column = $table.ListColumns.Add()
    $column.Name = $fixture.addColumn.header
    $column.DataBodyRange.Cells.Item(1, 1).Value2 = [double]$fixture.addColumn.value
    $book.SaveAs($fixture.output, 51)
    $evidence = [ordered]@{ version = [string]$excel.Version; build = [string]$excel.Build; operatingSystem = [string]$excel.OperatingSystem; startedAt = $started; savedAt = [DateTime]::UtcNow.ToString("o"); inputSha256 = $inputHash; independentInstance = $true }
} finally {
    if ($null -ne $book) { $book.Close($false); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book) }
    if ($null -ne $excel) { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

$evidence["outputSha256"] = (Get-FileHash -LiteralPath $fixture.output -Algorithm SHA256).Hash.ToLowerInvariant()
$evidence | ConvertTo-Json | Set-Content -LiteralPath (Join-Path (Split-Path -Parent $fixture.output) 'excel-run.json') -Encoding UTF8
Write-Output 'Microsoft Excel opened, filled, extended the IMTP table and saved the schema3 workbook.'
