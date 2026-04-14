; Custom NSIS macros for the B2DM installer.
; Registers b2dm:// protocol so Windows passes deep links to B2DM.exe, and
; neutralises broken legacy uninstall entries when upgrading over a prior install.

!macro preparePriorInstallForOverwrite
  StrCpy $R9 ""
  ReadRegStr $R9 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $R9 == ""
    ReadRegStr $R9 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${endif}
  ${if} $R9 != ""
    nsExec::ExecToLog 'cmd.exe /c if exist "$R9" attrib -R -H -S "$R9\*" /S /D'
    nsExec::ExecToLog 'cmd.exe /c set "B2DM_INST=$R9" && powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "if ($$env:B2DM_INST) { Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and ($$_.ExecutablePath).StartsWith($$env:B2DM_INST, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue } }"'
  ${endif}
  nsExec::ExecToLog 'taskkill /IM "${PRODUCT_FILENAME}.exe" /F /T 2>nul'
  nsExec::ExecToLog 'cmd.exe /c ping -n 2 127.0.0.1 >nul'
!macroend

!macro bypassBrokenOldUninstallerAndRemoveTree
  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY_2}"
  !endif
  DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
  DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY_2}"
  !endif
  DeleteRegKey HKLM "${INSTALL_REGISTRY_KEY}"
  ClearErrors
  ${if} ${FileExists} "$R9\${APP_EXECUTABLE_FILENAME}"
    RMDir /r $R9
  ${endif}
  ClearErrors
  nsExec::ExecToLog 'cmd.exe /c ping -n 2 127.0.0.1 >nul'
!macroend

!macro customInit
  !insertmacro preparePriorInstallForOverwrite
  nsExec::ExecToLog 'cmd.exe /c if exist "$INSTDIR\resources" attrib -H -S "$INSTDIR\resources" /S /D'
!macroend

!macro customCheckAppRunning
  !insertmacro preparePriorInstallForOverwrite
  !insertmacro bypassBrokenOldUninstallerAndRemoveTree
  nsExec::ExecToLog 'cmd.exe /c if exist "$INSTDIR\resources" attrib -H -S "$INSTDIR\resources" /S /D'
  nsExec::ExecToLog 'cmd.exe /c if exist "$INSTDIR" attrib -R -H -S "$INSTDIR\*" /S /D'
!macroend

!macro customRemoveFiles
  nsExec::ExecToLog 'cmd.exe /c if exist "$INSTDIR" attrib -R -H -S "$INSTDIR\*" /S /D'
  nsExec::ExecToLog 'cmd.exe /c ping -n 2 127.0.0.1 >nul'
  RMDir /r $INSTDIR
!macroend

!macro customInstall
  WriteRegStr HKCR "b2dm" "" "URL:b2dm Protocol"
  WriteRegStr HKCR "b2dm" "URL Protocol" ""
  WriteRegStr HKCR "b2dm\shell\open\command" "" '"$INSTDIR\${PRODUCT_FILENAME}.exe" "$INSTDIR\${PRODUCT_FILENAME}.exe" "%1"'
  SetFileAttributes "$INSTDIR\resources" HIDDEN|SYSTEM
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /c attrib +H +S $\"$INSTDIR\resources$\" /S /D'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'cmd.exe /c if exist "$INSTDIR\resources" attrib -H -S "$INSTDIR\resources" /S /D'
  DeleteRegKey HKCR "b2dm"
!macroend
