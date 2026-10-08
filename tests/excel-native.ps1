param(
    [string]$InputPath = (Join-Path $PSScriptRoot '..\output\excel-native\template.xlsx'),
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\output\excel-native\excel-saved.xlsx')
)
$ErrorActionPreference = 'Stop'
$inputFile = [System.IO.Path]::GetFullPath($InputPath)
$outputFile = [System.IO.Path]::GetFullPath($OutputPath)
$outputFolder = [System.IO.Path]::GetDirectoryName($outputFile)
if (-not (Test-Path -LiteralPath $inputFile)) { throw 'Run node tests/excel-model-tests.cjs --prepare-native to generate the native Excel fixture first.' }
if ($inputFile -eq $outputFile) { throw 'Native verification must save to a separate output file.' }
$excel = $null
$workbook = $null
function Set-TestCell($worksheet, [string]$key, [int]$row, $value) {
    $limit = $worksheet.UsedRange.Columns.Count
    for ($column = 1; $column -le $limit; $column++) {
        if ([string]$worksheet.Cells.Item(2, $column).Value2 -eq $key) {
            if ($value -is [string]) {
                # PowerShell's COM Value2 binder can reuse the preceding numeric setter.
                # These controlled fixture strings are literal text, never Excel formulas.
                $worksheet.Cells.Item($row, $column).Formula = [string]$value
            }
            else { $worksheet.Cells.Item($row, $column).Value2 = [double]$value }
            return
        }
    }
    throw "Template field missing: $key"
}
try {
    # A new COM application instance is owned by this check; no active Excel session is attached.
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    $excel.AutomationSecurity = 3
    $workbook = $excel.Workbooks.Open($inputFile, 0, $false)
    $metadata = $workbook.Worksheets.Item('本次测试')
    Set-TestCell $metadata 'mass' 3 ([double]72.5)
    $sheetNames = @()
    foreach ($worksheet in $workbook.Worksheets) {
        $sheetNames += $worksheet.Name
        if ($worksheet.Name -match '_CMJ$') { Set-TestCell $worksheet 'height' 3 ([double]37.25) }
        if ($worksheet.Name -match '_IMTP$') { Set-TestCell $worksheet 'peakForce' 3 ([double]2450) }
        if ($worksheet.Name -match '_FMS ') { Set-TestCell $worksheet 'score' 3 ([double]0) }
        if ($worksheet.Name -match '_CPET ') {
            Set-TestCell $worksheet 'vo2' 3 ([double]4.2)
            Set-TestCell $worksheet 'vo2Unit' 3 'l/min'
        }
    }
    $workbook.SaveAs($outputFile, 51)
    $result = [ordered]@{
        application = 'Microsoft Excel'
        version = $excel.Version
        input = $inputFile
        output = $outputFile
        format = $workbook.FileFormat
        sheetCount = $workbook.Worksheets.Count
        sheets = $sheetNames
        saved = $workbook.Saved
        inputSha256 = (Get-FileHash -LiteralPath $inputFile -Algorithm SHA256).Hash.ToLowerInvariant()
        sourceSha256 = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot '..\src\ringside-excel.js') -Algorithm SHA256).Hash.ToLowerInvariant()
        checkedUtc = [DateTime]::UtcNow.ToString('o')
    }
    $workbook.Close($false)
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook)
    $workbook = $null
    $result.outputSha256 = (Get-FileHash -LiteralPath $outputFile -Algorithm SHA256).Hash.ToLowerInvariant()
    $result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $outputFolder 'native-result.json') -Encoding utf8
    Copy-Item -LiteralPath (Join-Path ([System.IO.Path]::GetDirectoryName($inputFile)) 'seed.json') -Destination (Join-Path $outputFolder 'native-seed.json') -Force
    $result | ConvertTo-Json -Depth 4
}
finally {
    if ($null -ne $workbook) { $workbook.Close($false); [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) }
    if ($null -ne $excel) { $excel.Quit(); [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
