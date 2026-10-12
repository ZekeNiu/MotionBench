; Keep the existing per-user install identity when adding the directory wizard.
; Electron-builder reuses the registered InstallLocation for --updated upgrades.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
