#!/usr/bin/env python3
"""Сборка установщиков игры «Маршрут добра».

Берёт готовые страницы игры из public/, делает их полностью офлайновыми
(3D-движок и шрифты лежат рядом, интернет не нужен) и собирает:
  installer/dist/MarshrutDobra-Setup.exe       — установщик для Windows: настольное приложение
                                                 со своим окном (Electron), нужен makensis и node
  installer/dist/MarshrutDobra-portable.zip    — установщик + версия для macOS, Linux и без установки

Electron скачивается с GitHub один раз и хранится в installer/.cache (с проверкой SHA-256).

Запуск из корня репозитория:  python3 installer/build.py
"""
import hashlib
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

VERSION = "1.1.0"
ELECTRON = "44.9.3"
ELECTRON_SHA256 = "41a1ffa0541cb0f2c9b9fe920dd2cef1793ad0ea2ada1a9582958880f4d1b23c"
KEEP_LOCALES = {"ru.pak", "en-US.pak"}
ROOT = Path(__file__).resolve().parent.parent
INST = ROOT / "installer"
VENDOR = INST / "vendor"
BUILD = INST / "build"
APP = BUILD / "app"
DIST = INST / "dist"
CACHE = INST / ".cache"
WIN = BUILD / "win" / "MarshrutDobra"

GOOGLE_FONTS = re.compile(r'<link rel="(?:preconnect|stylesheet)" href="https://fonts\.(?:googleapis|gstatic)\.com[^>]*>\n?')
THREE_CDN = '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'
ORBIT_CDN = '<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>'
MENU_CSS = (".menu-link{border:3px solid var(--panel-line);background:var(--panel);padding:8px 16px;border-radius:14px;"
            "font-family:var(--f-display);font-weight:700;font-size:16px;box-shadow:0 3px 0 var(--panel-line);"
            "color:var(--ink);text-decoration:none}\n.menu-link:hover{border-color:var(--plum)}\n")


def offline(html: str, name: str) -> str:
    """Убирает всё, что грузится из интернета, и добавляет кнопку возврата в меню."""
    html, n = GOOGLE_FONTS.subn("", html)
    if n == 0:
        sys.exit(f"{name}: не нашёл ссылку на Google Fonts — проверьте шаблон")
    html = html.replace("<title>", '<link rel="stylesheet" href="fonts/fonts.css">\n<link rel="icon" href="icon.png">\n<title>', 1)
    html = html.replace(THREE_CDN, '<script src="lib/three.min.js"></script>')
    html = html.replace(ORBIT_CDN, '<script src="lib/OrbitControls.js"></script>')
    if "https://cdn" in html or "fonts.googleapis" in html:
        sys.exit(f"{name}: остались ссылки на интернет")
    nav = '<nav class="tabs" role="tablist">'
    if nav not in html:
        sys.exit(f"{name}: не нашёл панель вкладок")
    html = html.replace(nav, nav + '\n      <a href="index.html" class="menu-link">← Меню</a>', 1)
    html = html.replace("</style>", MENU_CSS + "</style>", 1)
    return html


def build_app() -> None:
    shutil.rmtree(BUILD, ignore_errors=True)
    APP.mkdir(parents=True)
    shutil.copytree(VENDOR / "lib", APP / "lib", ignore=shutil.ignore_patterns("LICENSE*"))
    shutil.copytree(VENDOR / "fonts", APP / "fonts", ignore=shutil.ignore_patterns("LICENSE*"))
    shutil.copy(INST / "icon.ico", APP / "icon.ico")
    shutil.copy(INST / "icon.png", APP / "icon.png")

    pages = {}
    for name in ("marshrut-dobra.html", "marshrut-dobra-3d.html"):
        pages[name] = offline((ROOT / "public" / name).read_text(encoding="utf-8"), name)
        (APP / name).write_text(pages[name], encoding="utf-8")

    # картинки персонажей берём прямо из игры, чтобы меню и игра совпадали
    imgs = re.findall(r"\{id:'(\w+)'[^}]*?n:'([^']+)'[^}]*?img:'(data:image/[^']+)'", pages["marshrut-dobra.html"])
    if len(imgs) != 4:
        sys.exit("не нашёл четырёх персонажей в игре")
    figs = "".join(f'<img src="{src}" alt="{n}">' for _, n, src in imgs)
    menu = (INST / "menu.html").read_text(encoding="utf-8").replace("{{FIGS}}", figs)
    (APP / "index.html").write_text(menu, encoding="utf-8")

    lic = ["Маршрут добра — командная игра для волонтёров.\n",
           "В игру входят сторонние компоненты со своими лицензиями:\n",
           "three.js r128 (MIT), шрифты Balsamiq Sans и Nunito (SIL Open Font License 1.1).\n"]
    for f in sorted(VENDOR.glob("*/LICENSE*")):
        lic.append(f"\n===== {f.name} =====\n\n{f.read_text(encoding='utf-8')}")
    (APP / "Лицензии.txt").write_text("".join(lic), encoding="utf-8")


def electron_zip() -> Path:
    """Скачивает Electron для Windows (один раз) и проверяет контрольную сумму."""
    name = f"electron-v{ELECTRON}-win32-x64.zip"
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(exist_ok=True)
        url = f"https://github.com/electron/electron/releases/download/v{ELECTRON}/{name}"
        print("Скачиваю", url)
        urllib.request.urlretrieve(url, path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != ELECTRON_SHA256:
        path.unlink()
        sys.exit(f"{name}: контрольная сумма не совпала, файл удалён — запустите сборку ещё раз")
    return path


def build_desktop() -> bool:
    """Собирает папку с настольным приложением для Windows: MarshrutDobra.exe + игра."""
    if not shutil.which("node") or not shutil.which("npm"):
        print("node/npm не найдены — настольное приложение для Windows пропущено")
        return False
    shutil.rmtree(WIN.parent, ignore_errors=True)
    WIN.mkdir(parents=True)
    with zipfile.ZipFile(electron_zip()) as z:
        for info in z.infolist():
            n = info.filename
            if n.startswith("locales/") and Path(n).name not in KEEP_LOCALES and not info.is_dir():
                continue  # оставляем только русский и английский языки
            if n == "resources/default_app.asar":
                continue
            z.extract(info, WIN)
    (WIN / "electron.exe").rename(WIN / "MarshrutDobra.exe")
    app_dir = WIN / "resources" / "app"
    app_dir.mkdir(parents=True)
    for f in ("main.js", "package.json"):
        shutil.copy(INST / "desktop" / f, app_dir / f)
    shutil.copytree(APP, app_dir / "web")
    tools = INST / "tools"
    if not (tools / "node_modules" / "resedit").exists():
        subprocess.run(["npm", "ci", "--silent"], cwd=tools, check=True)
    subprocess.run(["node", "patch-exe.js", str(WIN / "MarshrutDobra.exe"), str(INST / "icon.ico"), VERSION],
                   cwd=tools, check=True)
    return True


def build_windows() -> None:
    if not shutil.which("makensis"):
        print("makensis не найден — установщик для Windows пропущен (sudo apt install nsis)")
        return
    if not build_desktop():
        return
    subprocess.run(["makensis", "-V2", f"-DVERSION={VERSION}", "marshrut-dobra.nsi"], cwd=INST, check=True)
    print("Готово:", DIST / "MarshrutDobra-Setup.exe")


def build_zip() -> None:
    out = DIST / "MarshrutDobra-portable.zip"
    out.unlink(missing_ok=True)
    top = "MarshrutDobra"
    readme = (
        "МАРШРУТ ДОБРА — как установить\n\n"
        "Windows: запустите MarshrutDobra-Setup.exe из этой папки и нажимайте «Далее».\n"
        "  Игра установится как обычная программа и будет открываться в своём окне.\n"
        "  Без установки: откройте файл «Играть.html» из этой папки (откроется в браузере).\n\n"
        "macOS и Linux: откройте Терминал в этой папке и выполните\n"
        "  sh install.sh\n"
        "Игра появится в Launchpad (macOS) или в меню приложений и на рабочем столе (Linux).\n"
        "Удалить: sh install.sh --uninstall\n\n"
        "Без установки на любом компьютере: откройте «Играть.html» в браузере.\n"
        "Интернет для игры не нужен.\n"
    )
    start = ('<!doctype html><meta charset="utf-8"><title>Маршрут добра</title>'
             '<meta http-equiv="refresh" content="0;url=app/index.html">'
             '<a href="app/index.html">Открыть игру «Маршрут добра»</a>')
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in sorted(APP.rglob("*")):
            if f.is_file():
                z.write(f, f"{top}/app/{f.relative_to(APP)}")
        info = zipfile.ZipInfo(f"{top}/install.sh")
        info.external_attr = 0o100755 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, (INST / "install.sh").read_text(encoding="utf-8"))
        setup = DIST / "MarshrutDobra-Setup.exe"
        if setup.exists():
            z.write(setup, f"{top}/MarshrutDobra-Setup.exe")
        else:
            print("внимание: MarshrutDobra-Setup.exe не собран, в архив он не попал")
        for name, text in ((f"{top}/Играть.html", start), (f"{top}/Как установить.txt", readme)):
            info = zipfile.ZipInfo(name)
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, text)
    print("Готово:", out)


if __name__ == "__main__":
    DIST.mkdir(exist_ok=True)
    build_app()
    build_windows()
    build_zip()
