#!/bin/sh
# Установка игры «Маршрут добра» на macOS и Linux.
# Запуск: откройте Терминал в этой папке и выполните  sh install.sh
# Удаление: sh install.sh --uninstall
set -e

SRC="$(cd "$(dirname "$0")" && pwd)/app"
NAME="Маршрут добра"

if [ ! -f "$SRC/index.html" ]; then
  echo "Не найдена папка app рядом со скриптом. Распакуйте архив целиком и запустите скрипт из него."
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    DEST="$HOME/Applications/MarshrutDobra"
    LAUNCHER="$HOME/Applications/$NAME.app"
    if [ "$1" = "--uninstall" ]; then
      rm -rf "$DEST" "$LAUNCHER"
      echo "Игра удалена."
      exit 0
    fi
    mkdir -p "$DEST"
    cp -R "$SRC/." "$DEST/"
    rm -rf "$LAUNCHER"
    # маленькое приложение-ярлык: открывает игру в браузере
    osacompile -o "$LAUNCHER" -e "do shell script \"open \" & quoted form of \"$DEST/index.html\""
    if command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
      ICONSET="$(mktemp -d)/icon.iconset"; mkdir -p "$ICONSET"
      for s in 16 32 128 256; do sips -z $s $s "$DEST/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null 2>&1 || true; done
      iconutil -c icns "$ICONSET" -o "$LAUNCHER/Contents/Resources/applet.icns" >/dev/null 2>&1 || true
      touch "$LAUNCHER"
    fi
    echo "Готово! Игра установлена: $LAUNCHER"
    echo "Её можно найти в Launchpad или в папке «Программы» вашей домашней папки."
    open "$DEST/index.html"
    ;;
  *)
    DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
    DEST="$DATA/marshrut-dobra"
    ENTRY="$DATA/applications/marshrut-dobra.desktop"
    DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
    if [ "$1" = "--uninstall" ]; then
      rm -rf "$DEST" "$ENTRY" "$DESKTOP_DIR/marshrut-dobra.desktop"
      echo "Игра удалена."
      exit 0
    fi
    mkdir -p "$DEST" "$DATA/applications"
    cp -R "$SRC/." "$DEST/"
    cat > "$ENTRY" <<EOF
[Desktop Entry]
Type=Application
Name=$NAME
Comment=Командная игра для волонтёров
Exec=xdg-open "$DEST/index.html"
Icon=$DEST/icon.png
Terminal=false
Categories=Game;BoardGame;
EOF
    chmod +x "$ENTRY"
    if [ -d "$DESKTOP_DIR" ]; then
      cp "$ENTRY" "$DESKTOP_DIR/marshrut-dobra.desktop"
      chmod +x "$DESKTOP_DIR/marshrut-dobra.desktop"
      command -v gio >/dev/null 2>&1 && gio set "$DESKTOP_DIR/marshrut-dobra.desktop" metadata::trusted true 2>/dev/null || true
    fi
    echo "Готово! Игра «$NAME» установлена в меню приложений и на рабочий стол."
    command -v xdg-open >/dev/null 2>&1 && (xdg-open "$DEST/index.html" >/dev/null 2>&1 &) || true
    ;;
esac
