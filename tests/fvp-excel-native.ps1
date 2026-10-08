param([Parameter(Mandatory = $true)][string]$Directory)
$ErrorActionPreference = 'Stop'
$taskDirectory = [IO.Path]::GetFullPath($Directory)
$fixturePath = Join-Path $taskDirectory 'fixture.json'
$fixture = Get-Content -LiteralPath $fixturePath -Raw -Encoding UTF8 | ConvertFrom-Json
$inputArtifact = [IO.Path]::GetFullPath($fixture.input)
$outputArtifact = [IO.Path]::GetFullPath($fixture.output)
if (-not (Test-Path -LiteralPath $inputArtifact -PathType Leaf)) { throw 'Native Excel input fixture is missing.' }

function Release-OwnedCom($Value) {
  if ($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value) }
}
function Read-Cell($Sheet, [int]$Row, [int]$Column) {
  $cell = $Sheet.Cells.Item($Row, $Column)
  try { return $cell.Value2 } finally { Release-OwnedCom $cell }
}
function Write-Cell($Sheet, [int]$Row, [int]$Column, $Value) {
  $cell = $Sheet.Cells.Item($Row, $Column)
  try {
    if ($null -eq $Value -or ($Value -is [string] -and $Value -eq '')) { $cell.ClearContents() | Out-Null }
    elseif ($Value -is [bool]) { $cell.Value2 = $(if ($Value) { [string][char]0x662F } else { [string][char]0x5426 }) }
    elseif ($Value -is [ValueType]) { $cell.Value2 = [double]$Value }
    else { $cell.Value2 = [string]$Value }
  } finally { Release-OwnedCom $cell }
}
function Get-Columns($Sheet) {
  $columns = @{}
  $range = $Sheet.UsedRange
  try { $count = $range.Columns.Count } finally { Release-OwnedCom $range }
  for ($column = 1; $column -le $count; $column++) { $key = Read-Cell $Sheet 2 $column; if ($key) { $columns[[string]$key] = $column } }
  return $columns
}

$application = $null; $books = $null; $book = $null; $owned = $false; $saved = $false; $excelVersion = $null
try {
  $application = New-Object -ComObject Excel.Application
  $books = $application.Workbooks
  if ($books.Count -ne 0) { throw 'An isolated empty Excel instance could not be established.' }
  $owned = $true
  $application.Visible = $false
  $application.DisplayAlerts = $false
  $application.AskToUpdateLinks = $false
  $application.AutomationSecurity = 3
  $excelVersion = [string]$application.Version
  $book = $books.Open($inputArtifact, 0, $false)
  foreach ($testId in @('fvp_sj', 'fvp_cmj', 'cmj')) {
    $sheet = $book.Worksheets.Item([string]$fixture.sheetNames.$testId)
    try {
      $columns = Get-Columns $sheet
      $trials = @($fixture.expected.data.$testId)
      for ($index = 0; $index -lt $trials.Count; $index++) {
        foreach ($property in $trials[$index].PSObject.Properties) {
          if ($columns.ContainsKey($property.Name)) { Write-Cell $sheet ($index + 3) $columns[$property.Name] $property.Value }
        }
      }
    } finally { Release-OwnedCom $sheet }
  }
  $conditions = $book.Worksheets.Item([string]$fixture.conditionsSheetName)
  try {
    $columns = Get-Columns $conditions; $range = $conditions.UsedRange
    try { $count = $range.Rows.Count } finally { Release-OwnedCom $range }
    for ($row = 3; $row -le $count; $row++) {
      $key = [string](Read-Cell $conditions $row $columns['fieldId'])
      $parts = $key.Split('.')
      if ($parts.Count -eq 3 -and $parts[0] -in @('fvpConfig', 'fvpAnalysis', 'fvpView')) {
        $value = $fixture.expected.($parts[0]).($parts[1]).($parts[2])
        Write-Cell $conditions $row $columns['value'] $value
      }
    }
  } finally { Release-OwnedCom $conditions }
  $book.SaveAs($outputArtifact, 51)
  $saved = $true
} finally {
  if ($null -ne $book) { $book.Close($false); Release-OwnedCom $book }
  if ($owned -and $null -ne $application) { $application.Quit() }
  Release-OwnedCom $books; Release-OwnedCom $application
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
if (-not $saved -or -not (Test-Path -LiteralPath $outputArtifact -PathType Leaf)) { throw 'Excel did not save the round-trip artifact.' }
$result = [ordered]@{
  pass = $true; saved = $true; checkedAt = [DateTime]::UtcNow.ToString('o'); excelVersion = $excelVersion
  sourceHash = $fixture.htmlSha256; excelModuleSha256 = $fixture.moduleSha256
  inputArtifact = [ordered]@{path = $inputArtifact; sha256 = (Get-FileHash -LiteralPath $inputArtifact -Algorithm SHA256).Hash.ToLowerInvariant()}
  outputArtifact = [ordered]@{path = $outputArtifact; sha256 = (Get-FileHash -LiteralPath $outputArtifact -Algorithm SHA256).Hash.ToLowerInvariant()}
}
$encodedResult = $result | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $taskDirectory 'fvp-native-result.json'), $encodedResult, (New-Object Text.UTF8Encoding($false)))
Write-Output "PASS native Microsoft Excel $excelVersion open, populate and save: $outputArtifact"
