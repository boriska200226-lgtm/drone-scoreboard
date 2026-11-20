// Настольное приложение «Маршрут добра»: открывает игру в собственном окне, без браузера.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

// Сохранения игры (localStorage) лежат в %APPDATA%\MarshrutDobra
app.setPath('userData', path.join(app.getPath('appData'), 'MarshrutDobra'));
app.setAppUserModelId('MarshrutDobra');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;

  const createWindow = () => {
    win = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      title: 'Маршрут добра',
      icon: path.join(__dirname, 'web', 'icon.png'),
      backgroundColor: '#E9F1D8',
      autoHideMenuBar: true,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    Menu.setApplicationMenu(null);
    win.once('ready-to-show', () => { win.maximize(); win.show(); });
    win.loadFile(path.join(__dirname, 'web', 'index.html'));

    // Ссылки на сайты открываем в браузере, а не внутри игры
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
    });
    // F11 — полный экран, Esc — выйти из него
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
      if (input.key === 'Escape' && win.isFullScreen()) win.setFullScreen(false);
    });

    // Проверка сборки: MARSHRUT_SELFTEST=путь.png — снимок окна и выход
    if (process.env.MARSHRUT_SELFTEST) {
      win.webContents.once('did-finish-load', () => setTimeout(async () => {
        const img = await win.webContents.capturePage();
        require('fs').writeFileSync(process.env.MARSHRUT_SELFTEST, img.toPNG());
        app.quit();
      }, 2500));
    }
  };

  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
