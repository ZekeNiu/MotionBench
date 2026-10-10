function Get-ExcelTemplateManifest($Book) {
    $sheet = $Book.Worksheets.Item('_MotionBench')
    try {
        $encoded = ''
        for ($row = 1; $row -le $sheet.UsedRange.Rows.Count; $row++) { $encoded += [string]$sheet.Cells.Item($row, 2).Value2 }
        return ($encoded | ConvertFrom-Json)
    } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet) }
}
function Get-ExcelTemplateColumns($Sheet, $Manifest) {
    $columns = @{}
    if ($Manifest.schema -eq 1) {
        for ($column = 1; $column -le $Sheet.UsedRange.Columns.Count; $column++) {
            $key = [string]$Sheet.Cells.Item(2, $column).Value2
            if ($key) { $columns[$key] = $column }
        }
    } else {
        $spec = @($Manifest.sheets | Where-Object { $_.name -eq $Sheet.Name })[0]
        if ($null -eq $spec) { throw "Unknown template sheet: $($Sheet.Name)" }
        for ($column = 1; $column -le $Sheet.UsedRange.Columns.Count; $column++) {
            $header = [string]$Sheet.Cells.Item(1, $column).Value2
            $field = @($spec.columns | Where-Object { $_.header -eq $header })
            if ($field.Count -eq 1) { $columns[[string]$field[0].key] = $column }
        }
    }
    return $columns
}
function Get-ExcelTemplateFirstRow($Manifest) { if ($Manifest.schema -eq 1) { return 3 } else { return 2 } }
function New-PrivateExcelApplication {
    $priorIds = @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    if (-not ('MBExcelNativeOwner' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MBExcelNativeOwner {
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
}
'@
    }
    $application = New-Object -ComObject Excel.Application
    [uint32]$ownedId = 0
    [void][MBExcelNativeOwner]::GetWindowThreadProcessId([IntPtr]$application.Hwnd, [ref]$ownedId)
    if ($ownedId -eq 0 -or $priorIds -contains [int]$ownedId) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($application)
        throw 'Excel did not create a private owned process; existing Excel sessions were not modified.'
    }
    if ($application.Workbooks.Count -ne 0) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($application)
        throw 'The new Excel process unexpectedly contains workbooks; it was not modified.'
    }
    return [pscustomobject]@{ Application = $application; ProcessId = [int]$ownedId; PriorProcessIds = $priorIds }
}
