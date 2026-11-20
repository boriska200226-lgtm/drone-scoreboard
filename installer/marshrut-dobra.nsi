; Установщик игры «Маршрут добра» для Windows (NSIS 3, Unicode).
; Собирается командой: python3 installer/build.py
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define APPNAME "Маршрут добра"
!define APPID "MarshrutDobra"
!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPID}"

Name "${APPNAME}"
Caption "${APPNAME} — установка"
OutFile "dist/MarshrutDobra-Setup.exe"
; Ставим в папку пользователя: права администратора не нужны
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\${APPID}"
InstallDirRegKey HKCU "Software\${APPID}" "InstallDir"
BrandingText "${APPNAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1049 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=1049 "FileDescription" "Установщик игры «${APPNAME}»"
VIAddVersionKey /LANG=1049 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1049 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1049 "LegalCopyright" "Командная игра для волонтёров"

!define MUI_ICON "build/app/icon.ico"
!define MUI_UNICON "build/app/icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Установка игры «${APPNAME}»"
!define MUI_WELCOMEPAGE_TEXT "Командная игра для волонтёров: бросайте кубик, выполняйте добрые задания и собирайте сердечки.$\r$\n$\r$\nВ игре две версии — нарисованная карта и объёмный 3D-город. Интернет для игры не нужен.$\r$\n$\r$\nНажмите «Далее», чтобы продолжить."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Запустить «${APPNAME}»"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchGame

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"

Var Browser

; Ищем Microsoft Edge: тогда игра открывается в отдельном окне, как приложение.
; Если Edge нет, ярлык откроет игру в браузере по умолчанию.
Function FindEdge
  StrCpy $Browser ""
  SetRegView 64
  ReadRegStr $Browser HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" ""
  SetRegView 32
  ${If} $Browser == ""
    ReadRegStr $Browser HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" ""
  ${EndIf}
  ${If} $Browser == ""
    ReadRegStr $Browser HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" ""
  ${EndIf}
  ${If} $Browser == ""
    ${If} ${FileExists} "$PROGRAMFILES32\Microsoft\Edge\Application\msedge.exe"
      StrCpy $Browser "$PROGRAMFILES32\Microsoft\Edge\Application\msedge.exe"
    ${ElseIf} ${FileExists} "$PROGRAMFILES64\Microsoft\Edge\Application\msedge.exe"
      StrCpy $Browser "$PROGRAMFILES64\Microsoft\Edge\Application\msedge.exe"
    ${EndIf}
  ${EndIf}
  ${If} $Browser != ""
  ${AndIfNot} ${FileExists} "$Browser"
    StrCpy $Browser ""
  ${EndIf}
FunctionEnd

!macro MakeShortcut LNK
  ${If} $Browser != ""
    CreateShortcut "${LNK}" "$Browser" '--app="$INSTDIR\index.html" --start-maximized' "$INSTDIR\icon.ico" 0
  ${Else}
    CreateShortcut "${LNK}" "$INSTDIR\index.html" "" "$INSTDIR\icon.ico" 0
  ${EndIf}
!macroend

Section "Игра" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /r "build/app/*"
  WriteUninstaller "$INSTDIR\Удалить игру.exe"

  Call FindEdge
  !insertmacro MakeShortcut "$DESKTOP\${APPNAME}.lnk"
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  !insertmacro MakeShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Удалить игру.lnk" "$INSTDIR\Удалить игру.exe"

  WriteRegStr HKCU "Software\${APPID}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "Маршрут добра"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Удалить игру.exe"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Function LaunchGame
  ExecShell "open" "$DESKTOP\${APPNAME}.lnk"
FunctionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  ; удаляем только файлы игры, чтобы не задеть чужие файлы, если папку выбрали вручную
  Delete "$INSTDIR\*.html"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\icon.png"
  Delete "$INSTDIR\Лицензии.txt"
  RMDir /r "$INSTDIR\lib"
  RMDir /r "$INSTDIR\fonts"
  Delete "$INSTDIR\Удалить игру.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\${APPID}"
SectionEnd
