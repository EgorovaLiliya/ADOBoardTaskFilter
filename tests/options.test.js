// Проверка страницы настроек с имитацией chrome.storage и chrome.permissions.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { EXT, CHROME_SHIM } = require('./lib/fixtures');

const PERMISSIONS_SHIM = `
(() => {
  const granted = new Set(JSON.parse(localStorage.getItem('__granted') || '[]'));
  const persist = () => localStorage.setItem('__granted', JSON.stringify([...granted]));
  window.__allow = true;
  window.chrome.permissions = {
    async request({ origins }) { if (!window.__allow) return false; origins.forEach((o) => granted.add(o)); persist(); return true; },
    async contains({ origins }) { return origins.every((o) => granted.has(o)); },
    async remove({ origins }) { origins.forEach((o) => granted.delete(o)); persist(); return true; }
  };
})();`;

async function run(report, shots) {
  const { check } = report;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 900, height: 1500 }, deviceScaleFactor: shots ? 2 : 1 });
  const page = await context.newPage();
  await page.addInitScript(CHROME_SHIM + PERMISSIONS_SHIM);
  await page.route('https://options.test/**', (route) => {
    const rel = new URL(route.request().url()).pathname.slice(1);
    const file = path.join(EXT, rel);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' }[path.extname(file)];
    return route.fulfill({ body: fs.readFileSync(file), contentType: type });
  });
  const open = async () => { await page.goto('https://options.test/src/options/options.html'); await page.waitForTimeout(300); };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('__shim_sync') || '{}'));
  await open();

  await page.fill('#server-input', 'ado.company.ru/tfs/Coll/Proj/_boards/board/t/Team/Stories');
  await page.click('#server-form button');
  await page.waitForTimeout(300);
  const row = (await page.locator('#server-list li').first().textContent()).replace(/\s+/g, ' ').trim();
  let s = await stored();
  check('TC-36', 'Добавление сервера по ссылке на доску', 'в списке https://ado.company.ru, «доступ есть»', `${row}; в настройках ${JSON.stringify(s.servers)}`,
    row.includes('https://ado.company.ru') && row.includes('доступ есть') && JSON.stringify(s.servers) === '["https://ado.company.ru"]');

  await page.fill('#server-input', 'ftp://files.company.ru');
  await page.click('#server-form button');
  await page.waitForTimeout(200);
  const err = await page.locator('#server-error').textContent();
  check('TC-37', 'Неверный адрес сервера', '«Поддерживаются только адреса http и https»', `«${err}»`, err === 'Поддерживаются только адреса http и https');

  await page.evaluate(() => { window.__allow = false; });
  await page.fill('#server-input', 'http://tfs.local:8080');
  await page.click('#server-form button');
  await page.waitForTimeout(300);
  const rows = await page.locator('#server-list li').allTextContents();
  const warn = await page.locator('#server-error').textContent();
  check('TC-38', 'Сервер без выданного доступа', 'сервер в списке с пометкой «нет доступа» и кнопкой «Выдать доступ»', `${rows[1].replace(/\s+/g, ' ').trim()}; «${warn}»`,
    rows[1].includes('http://tfs.local:8080') && rows[1].includes('нет доступа') && rows[1].includes('Выдать доступ'));
  if (shots) await page.locator('section.card').first().screenshot({ path: shots + '/options-servers.png' });
  await page.evaluate(() => { window.__allow = true; });

  const chips = page.locator('.chips[data-key="childTypes"] input');
  await chips.fill('Bug');
  await chips.press('Enter');
  await page.waitForTimeout(200);
  s = await stored();
  check('TC-39', 'Добавление типа дочернего элемента', 'childTypes = Task, Bug', String(s.childTypes), String(s.childTypes) === 'Task,Bug');

  await page.click('label.toggle:has(#useCardFields)');
  await page.click('.segmented[data-key="theme"] button[data-value="dark"]');
  await page.selectOption('#autoRefreshMinutes', '5');
  await page.fill('#apiVersion', 'abc');
  await page.locator('#apiVersion').dispatchEvent('change');
  await page.waitForTimeout(300);
  s = await stored();
  const apiValue = await page.inputValue('#apiVersion');
  check('TC-40', 'Переключатели, тема, автообновление; неверная версия API заменяется значением по умолчанию',
    'useCardFields=false, theme=dark, autoRefreshMinutes=5, apiVersion=6.0',
    `useCardFields=${s.useCardFields}, theme=${s.theme}, autoRefreshMinutes=${s.autoRefreshMinutes}, apiVersion=${s.apiVersion} (в поле ${apiValue})`,
    s.useCardFields === false && s.theme === 'dark' && s.autoRefreshMinutes === 5 && s.apiVersion === '6.0' && apiValue === '6.0');

  await open();
  const persisted = await page.locator('.segmented[data-key="theme"] button[aria-checked="true"]').textContent();
  check('TC-41', 'Настройки сохраняются между открытиями страницы', 'тема «Тёмная» выбрана', `выбрано «${persisted}»`, persisted === 'Тёмная');

  if (shots) {
    await page.click('.segmented[data-key="theme"] button[data-value="auto"]');
    await page.waitForTimeout(200);
    await page.screenshot({ path: shots + '/options.png', fullPage: true });
  }

  await page.click('#reset');
  await page.waitForTimeout(300);
  s = await stored();
  check('TC-42', 'Сброс настроек сохраняет список серверов', 'настройки по умолчанию, 2 сервера на месте',
    `childTypes=${s.childTypes}, useCardFields=${s.useCardFields}, серверов ${s.servers.length}`,
    String(s.childTypes) === 'Task' && s.useCardFields === true && s.servers.length === 2);

  await page.locator('#server-list li').first().locator('button:has-text("Удалить")').click();
  await page.waitForTimeout(300);
  s = await stored();
  const granted = await page.evaluate(() => JSON.parse(localStorage.getItem('__granted')));
  check('TC-43', 'Удаление сервера отзывает доступ', 'остался http://tfs.local:8080, доступ к ado.company.ru отозван',
    `серверы ${JSON.stringify(s.servers)}, доступ ${JSON.stringify(granted)}`,
    JSON.stringify(s.servers) === '["http://tfs.local:8080"]' && !granted.includes('https://ado.company.ru/*'));

  await browser.close();
}

module.exports = { run };
