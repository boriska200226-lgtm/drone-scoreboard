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

; Ярлык указывает прямо на файл игры: Windows откроет его в браузере по умолчанию,
; так же, как при двойном щелчке по файлу. Без параметров командной строки,
; которые браузер мог бы принять за поисковый запрос.
!macro MakeShortcut LNK
  CreateShortcut "${LNK}" "$INSTDIR\index.html" "" "$INSTDIR\icon.ico" 0
!macroend

Section "Игра" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /r "build/app/*"
  WriteUninstaller "$INSTDIR\Удалить игру.exe"

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
  ExecShell "open" "$INSTDIR\index.html"
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
