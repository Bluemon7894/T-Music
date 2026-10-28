# T-Music installer customizations (included by electron-builder via nsis.include).

# Defining customCheckAppRunning skips these in the template, so pull them in here.
!include "getProcessInfo.nsh"
Var pid

# Runs right before the app files are extracted. Besides the usual "is T-Music
# running?" check, it swaps in an extractor that lists every file in the
# progress details and turns those details on.
!macro customCheckAppRunning
  !ifmacrodef extractUsing7za
    !ifndef TMUSIC_EXTRACT_PATCHED
      !define TMUSIC_EXTRACT_PATCHED
      !include "tmusic-extract.nsh"
    !endif
  !endif
  ${IfNot} ${Silent}
    SetDetailsPrint both
    SetDetailsView show
  ${EndIf}
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!macroend

# Finish page: "run now" plus an opt-in desktop shortcut checkbox.
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function CreateDesktopShortcut
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "T-Music 실행하기"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "바탕화면에 바로가기 만들기"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "CreateDesktopShortcut"
  !insertmacro MUI_PAGE_FINISH
!macroend

# The desktop shortcut is ours, so remove it on uninstall (but keep it on updates).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${endIf}
!macroend
