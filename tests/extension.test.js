// Загрузка настоящего расширения в Chromium: манифест, service worker, страница настроек.
const { chromium } = require('playwright');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { EXT } = require('./lib/fixtures');

async function run(report, shots) {
  const { check } = report;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'btf-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: 900, height: 1500 },
    deviceScaleFactor: shots ? 2 : 1
  });
  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(worker.url()).host;
    check('TC-44', 'Расширение загружается, service worker запускается', 'service worker src/background.js', new URL(worker.url()).pathname,
      new URL(worker.url()).pathname === '/src/background.js');

    const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
    check('TC-45', 'Расширение не просит доступ к сайтам при установке', 'host_permissions нет, доступ только по запросу',
      `host_permissions: ${JSON.stringify(manifest.host_permissions || [])}; optional: ${JSON.stringify(manifest.optional_host_permissions)}`,
      !(manifest.host_permissions || []).length && manifest.optional_host_permissions.length === 2);

    // Сервер добавлен в настройки, но доступ не выдан: content script не регистрируется.
    const registered = await worker.evaluate(async () => {
      await chrome.storage.sync.set({ servers: ['https://ado.company.ru'] });
      await new Promise((r) => setTimeout(r, 500));
      return (await chrome.scripting.getRegisteredContentScripts()).length;
    });
    check('TC-46', 'Без выданного доступа скрипт на страницы не встраивается', '0 зарегистрированных скриптов', `${registered}`, registered === 0);

    // Доступ выдан (имитация): одновременные события не должны ломать регистрацию.
    const scripts = await worker.evaluate(async () => {
      chrome.permissions.contains = async () => true;
      await Promise.all([
        chrome.storage.sync.set({ servers: ['https://ado.company.ru', 'http://tfs.local:8080'] }),
        resync(), resync()
      ]);
      await new Promise((r) => setTimeout(r, 300));
      await resync();
      return chrome.scripting.getRegisteredContentScripts();
    }).catch((e) => [{ error: e.message }]);
    const matches = scripts.length === 1 ? scripts[0].matches : [];
    check('TC-46a', 'С выданным доступом скрипт регистрируется один раз на страницы досок всех серверов',
      '1 скрипт, 6 шаблонов адресов (/_boards/ и /_backlogs/ для двух серверов)',
      `${scripts.length} скрипт(а): ${scripts[0] && scripts[0].error ? scripts[0].error : matches.join(', ')}`,
      scripts.length === 1 && matches.length === 6 && matches.includes('https://ado.company.ru/*/_boards/*') && matches.includes('http://tfs.local/*/_backlogs/*'));

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`chrome-extension://${id}/src/options/options.html`);
    await page.waitForTimeout(500);
    const servers = (await page.locator('#server-list').textContent()).replace(/\s+/g, ' ').trim();
    check('TC-47', 'Страница настроек открывается внутри расширения без ошибок', 'сервер в списке, «нет доступа», ошибок нет',
      `${servers}; ошибок ${errors.length}`, servers.includes('https://ado.company.ru') && servers.includes('нет доступа') && errors.length === 0);
    if (shots) {
      await page.evaluate(() => chrome.storage.sync.set({ servers: [] }));
      await page.reload();
      await page.waitForTimeout(400);
      await page.screenshot({ path: shots + '/options-in-extension.png', fullPage: true });
    }
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

module.exports = { run };
