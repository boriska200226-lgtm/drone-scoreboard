; Установщик игры «Маршрут добра» для Windows (NSIS 3, Unicode).
; Ставит настольное приложение MarshrutDobra.exe (Electron): игра открывается
; в своём окне, как обычная программа, браузер не нужен.
; Собирается командой: python3 installer/build.py
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define APPNAME "Маршрут добра"
!define APPID "MarshrutDobra"
!define EXE "MarshrutDobra.exe"
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
!define MUI_WELCOMEPAGE_TEXT "Командная игра для волонтёров: бросайте кубик, выполняйте добрые задания и собирайте сердечки.$\r$\n$\r$\nИгра установится как обычная программа и будет открываться в своём окне. Интернет не нужен.$\r$\n$\r$\nНажмите «Далее», чтобы продолжить."
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

!macro CloseGame
  ; закрываем игру, если она запущена, иначе файлы не заменятся
  nsExec::Exec 'taskkill /F /IM ${EXE}'
  Pop $0
  Sleep 400
!macroend

Section "Игра" SecMain
  SectionIn RO
  !insertmacro CloseGame
  ; убираем файлы версии 1.0, которая открывалась в браузере
  Delete "$INSTDIR\*.html"
  Delete "$INSTDIR\icon.png"
  RMDir /r "$INSTDIR\lib"
  RMDir /r "$INSTDIR\fonts"

  SetOutPath "$INSTDIR"
  File /r "build/win/MarshrutDobra/*"
  WriteUninstaller "$INSTDIR\Удалить игру.exe"

  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Удалить игру.lnk" "$INSTDIR\Удалить игру.exe"

  WriteRegStr HKCU "Software\${APPID}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "Маршрут добра"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Удалить игру.exe"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Function LaunchGame
  Exec '"$INSTDIR\${EXE}"'
FunctionEnd

Section "Uninstall"
  !insertmacro CloseGame
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  ; папку удаляем целиком, только если это действительно папка игры
  ${If} ${FileExists} "$INSTDIR\${EXE}"
    RMDir /r "$INSTDIR"
  ${Else}
    Delete "$INSTDIR\Удалить игру.exe"
    RMDir "$INSTDIR"
  ${EndIf}
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\${APPID}"
SectionEnd
