param([Parameter(Mandatory = $true)][string]$Directory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'excel-native-helpers.ps1')
$fixtureDirectory = [IO.Path]::GetFullPath($Directory)
$fixture = Get-Content -LiteralPath (Join-Path $fixtureDirectory 'fixture.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$excel = $null; $book = $null
$results = @(); $savedAll = $false
function Put-Cell($Sheet, [int]$Row, [int]$Column, $Value) {
    if ($null -eq $Value -or ($Value -is [string] -and $Value -eq '')) { $Sheet.Cells.Item($Row, $Column).ClearContents() | Out-Null }
    elseif ($Value -is [ValueType]) { $Sheet.Cells.Item($Row, $Column).Value2 = [double]$Value }
    else { $Sheet.Cells.Item($Row, $Column).Value2 = [string]$Value }
}
function Put-Measurement($Sheet, $Columns, [int]$Row, $Value, $Manifest, [bool]$SelectRecord) {
    if ($SelectRecord -and $Columns.ContainsKey('recordRef')) { Put-Cell $Sheet $Row $Columns['recordRef'] $Manifest.recordRefs[[int]$Value.recordIndex].label }
    foreach ($key in @('load','velocity','height')) { if ($Value.PSObject.Properties.Name -contains $key) { Put-Cell $Sheet $Row $Columns[$key] $Value.$key } }
}
try {
    $owned = New-PrivateExcelApplication
    $excel = $owned.Application
    Write-Output ('OWNED EXCEL ' + $owned.ProcessId)
    $excel.Visible = $false; $excel.DisplayAlerts = $false; $excel.EnableEvents = $false; $excel.AutomationSecurity = 3
    foreach ($test in $fixture.cases) {
        $inputPath = [IO.Path]::GetFullPath([string]$test.input); $outputPath = [IO.Path]::GetFullPath([string]$test.output)
        if ([IO.Path]::GetDirectoryName($inputPath) -ne $fixtureDirectory -or [IO.Path]::GetDirectoryName($outputPath) -ne $fixtureDirectory -or $inputPath -eq $outputPath) { throw 'Synthetic workbook paths must stay in the fixture directory and use separate outputs.' }
        $workingPath = Join-Path $fixtureDirectory ($test.name + '-working.xlsx')
        Copy-Item -LiteralPath $inputPath -Destination $workingPath -Force
        $book = $excel.Workbooks.Open($workingPath, 0, $false)
        $autoSaveOnAtOpen = $null
        try { $autoSaveOnAtOpen = [bool]$book.AutoSaveOn; if ($autoSaveOnAtOpen) { $book.AutoSaveOn = $false } } catch { $autoSaveOnAtOpen = $null }
        $manifest = Get-ExcelTemplateManifest $book
        $sheet = $book.Worksheets.Item([string]$test.sheetName)
        $columns = Get-ExcelTemplateColumns $sheet $manifest
        $firstRow = Get-ExcelTemplateFirstRow $manifest
        $table = $null; if ($test.tableName) { $table = $sheet.ListObjects.Item([string]$test.tableName) }
        $beforeRows = if ($null -ne $table) { [int]$table.ListRows.Count } else { [int]$sheet.UsedRange.Rows.Count - $firstRow + 1 }
        if ($sheet.ProtectContents) { throw 'A measurement sheet is protected and cannot expand.' }
        switch ([string]$test.operation) {
            'fms' {
                for ($index = 0; $index -lt 7; $index++) {
                    $action = $test.records[0].data.fms[$index]; $row = $firstRow + $index
                    if ($action.bilateral) { Put-Cell $sheet $row $columns['left'] 2; Put-Cell $sheet $row $columns['right'] 3 }
                    else { $score = if ($index -eq 0) { 0 } else { 2 }; Put-Cell $sheet $row $columns['score'] $score }
                }
            }
            'duplicate' {
                Put-Measurement $sheet $columns $firstRow $test.values[0] $manifest $true
                $copyRow = $firstRow + $beforeRows
                $source = $sheet.Range($sheet.Cells.Item($firstRow,1),$sheet.Cells.Item($firstRow,$columns.Count))
                $destination = $sheet.Range($sheet.Cells.Item($copyRow,1),$sheet.Cells.Item($copyRow,$columns.Count))
                $source.Copy($destination) | Out-Null
            }
            'insertSort' {
                foreach ($value in $test.values) { $newRow = $table.ListRows.Add(1); $row = [int]$newRow.Range.Row; Put-Measurement $sheet $columns $row $value $manifest $true; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($newRow) }
            }
            'addSort' {
                foreach ($value in $test.values) { $newRow = $table.ListRows.Add(); $row = [int]$newRow.Range.Row; Put-Measurement $sheet $columns $row $value $manifest $true; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($newRow) }
            }
            'paste' {
                $row = $firstRow + $beforeRows; $matrix = New-Object 'object[,]' $test.values.Count,$columns.Count
                for ($index = 0; $index -lt $test.values.Count; $index++) {
                    $value = $test.values[$index]; $matrix[$index,($columns['recordRef']-1)] = [string]$manifest.recordRefs[[int]$value.recordIndex].label
                    foreach ($key in @('load','velocity')) { $matrix[$index,($columns[$key]-1)] = [double]$value.$key }
                }
                $range = $sheet.Range($sheet.Cells.Item($row,1),$sheet.Cells.Item(($row+$test.values.Count-1),$columns.Count)); $range.Value2 = $matrix
            }
            default {
                $row = $firstRow + $beforeRows
                Put-Measurement $sheet $columns $row $test.values[0] $manifest $false
            }
        }
        if ($test.operation -in @('insertSort','addSort')) {
            $sort = $table.Sort; $sort.SortFields.Clear()
            $sort.SortFields.Add($table.ListColumns.Item([int]$columns['load']).Range,0,2) | Out-Null
            $sort.Header = 1; $sort.Apply()
        }
        $afterRows = if ($null -ne $table) { [int]$table.ListRows.Count } else { $null }
        if ($test.operation -in @('insertSort','addSort') -and $afterRows -ne ($beforeRows + $test.values.Count)) { throw 'Native Table insertion did not preserve its row count.' }
        $book.SaveAs($outputPath,51)
        $caseResult = [pscustomobject]@{name=$test.name;operation=$test.operation;schema=$manifest.schema;beforeTableRows=$beforeRows;afterTableRows=$afterRows;nextRowComWriteExpanded=($test.operation -eq 'nextRow' -and $null -ne $table -and $afterRows -gt $beforeRows);autoSaveOnAtOpen=$autoSaveOnAtOpen;method='Private Microsoft Excel COM working copy. Next-row cell writes, native ListRows.Add, native Table.Sort and multi-cell Range.Value2 as stated.';saved=$book.Saved;output=$outputPath;sha256=$null}
        $book.Close($false); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book); $book = $null
        $caseResult.sha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $results += $caseResult
        Write-Output ('SAVED ' + $test.name)
    }
    $savedAll = $true
} finally {
    $evidence = [ordered]@{savedAll=$savedAll;actualMicrosoftExcel=$true;excelVersion=if($null -ne $excel){[string]$excel.Version}else{$null};ownedProcessId=$owned.ProcessId;preexistingProcessIds=$owned.PriorProcessIds;sourceHash=$fixture.sourceHash;moduleSha256=$fixture.moduleSha256;checkedUtc=[DateTime]::UtcNow.ToString('o');cases=$results;keyboardEntryAutoExpansionTested=$false}
    [IO.File]::WriteAllText((Join-Path $fixtureDirectory 'native-result.json'),($evidence | ConvertTo-Json -Depth 12),(New-Object Text.UTF8Encoding($false)))
    if ($null -ne $book) { $book.Close($false); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book) }
    if ($null -ne $excel) { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
