// Проверка логики на доске: content script на имитации доски и REST API Azure DevOps.
const { chromium } = require('playwright');
const { CONTENT_FILES, ITEMS, LINKS, boardHtml, CHROME_SHIM, card } = require('./lib/fixtures');

const BOARD = 'https://ado.example.com/tfs/Coll/Proj/_boards/board/t/Team/Stories';
const key = (name) => name.replace(' ', '.').toLowerCase() + '@corp';

async function openBoard(browser, url, opts = {}) {
  const context = opts.context || await browser.newContext({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: opts.scale || 1 });
  const page = await context.newPage();
  const api = [];
  const ids = opts.ids || [101, 102, 103, 104];
  await page.addInitScript(CHROME_SHIM);
  if (opts.colorScheme) await page.emulateMedia({ colorScheme: opts.colorScheme });
  await page.route('https://ado.example.com/**', async (route) => {
    const u = route.request().url();
    if (!u.includes('/_apis/')) {
      const boardIds = u.includes('/Team2/') ? [301, 302] : ids;
      return route.fulfill({ contentType: 'text/html', body: boardHtml(boardIds) });
    }
    if (opts.mode === 'forbidden') return route.fulfill({ status: 403, body: '{"message":"access denied"}' });
    if (opts.mode === 'offline') return route.abort('failed');
    const body = JSON.parse(route.request().postData());
    if (u.includes('/_apis/wit/workitemsbatch')) {
      api.push({ api: 'workitemsbatch', url: u, n: body.ids.length, fields: body.fields });
      const value = body.ids.map((id) => {
        const f = { 'System.Id': id, 'System.Title': 'Item ' + id, ...(ITEMS[id] || { 'System.WorkItemType': 'Product Backlog Item' }) };
        if (body.fields) for (const k of Object.keys(f)) if (!body.fields.includes(k)) delete f[k];
        return { id, fields: f };
      });
      return route.fulfill({ json: { count: value.length, value } });
    }
    if (u.includes('/_apis/wit/wiql')) {
      api.push({ api: 'wiql', url: u, query: body.query });
      const sources = body.query.match(/\[Source\]\.\[System\.Id\] IN \(([^)]*)\)/)[1].split(',').map((s) => Number(s.trim()));
      const types = [...body.query.matchAll(/'([^']+)'/g)].map((m) => m[1]);
      const rel = [];
      for (const s of sources) {
        rel.push({ rel: null, source: null, target: { id: s } });
        for (const [p, c] of LINKS) {
          if (p === s && types.includes(ITEMS[c]['System.WorkItemType'])) {
            rel.push({ rel: 'System.LinkTypes.Hierarchy-Forward', source: { id: p }, target: { id: c } });
          }
        }
      }
      return route.fulfill({ json: { queryType: 'oneHop', workItemRelations: rel } });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(url);
  if (opts.settings) await page.evaluate((s) => localStorage.setItem('__shim_sync', JSON.stringify(s)), opts.settings);
  await inject(page);
  return { context, page, api };
}

async function inject(page) {
  for (const code of CONTENT_FILES) await page.addScriptTag({ content: code });
}

const status = (page) => page.locator('btf-panel .status').textContent();
async function waitStatus(page, test, timeout = 20000) {
  const end = Date.now() + timeout;
  let last = '';
  while (Date.now() < end) {
    last = await status(page).catch(() => '');
    if (test(last)) return last;
    await page.waitForTimeout(100);
  }
  return last;
}
const visible = (page) => page.$$eval('.board-tile', (els) => els.filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.dataset.n).join(','));
const people = (page) => page.$$eval('btf-panel', (hosts) => [...hosts[0].shadowRoot.querySelectorAll('.row')].map((r) => `${r.querySelector('.name').textContent} ${r.querySelector('.count').textContent}`));
const pick = async (page, name) => { await page.locator(`btf-panel .row[data-key="${key(name)}"]`).click(); await page.waitForTimeout(150); };
const ready = (s) => s.startsWith('Карточек на доске') || s.startsWith('Показано');

async function run(report, shots) {
  const { check } = report;
  const browser = await chromium.launch();

  // ---------- Основной сценарий ----------
  {
    const { context, page, api } = await openBoard(browser, BOARD, { scale: 2 });
    const st = await waitStatus(page, ready);
    const list = await people(page);
    check('TC-01', 'Загрузка доски и список людей с числом карточек', 'Карточек на доске: 4; Analyst D 1, Dev B 2, Dev C 1, Owner A 2, QA E 1',
      `${st}; ${list.join(', ')}`, st.startsWith('Карточек на доске: 4') && list.join(',') === 'Analyst D 1,Dev B 2,Dev C 1,Owner A 2,QA E 1');
    const base = api[0].url.split('/_apis')[0];
    check('TC-02', 'Базовый адрес API для адреса с /tfs/', 'https://ado.example.com/tfs/Coll/Proj', base, base === 'https://ado.example.com/tfs/Coll/Proj');
    const seq = api.map((a) => a.api === 'wiql' ? 'wiql' : `workitemsbatch(${a.fields ? a.fields.length + ' поля' : 'все поля'})`).join(', ');
    check('TC-03', 'Запросы при загрузке', 'workitemsbatch(все поля), wiql, workitemsbatch(3 поля)', seq, seq === 'workitemsbatch(все поля), wiql, workitemsbatch(3 поля)');
    if (shots) await page.locator('btf-panel .card').screenshot({ path: shots + '/panel-light.png' });

    await pick(page, 'Dev C');
    let v = await visible(page);
    check('TC-04', 'Отбор по активной Task (Dev C)', 'видна 103; «Показано 1 из 4»', `видны ${v}; «${await status(page)}»`, v === '103' && (await status(page)) === 'Показано 1 из 4');

    await page.locator('btf-panel .switch').click(); await page.waitForTimeout(150);
    v = await visible(page);
    check('TC-05', 'Закрытые Task учитываются при выключенном переключателе (Dev C)', 'видны 101, 103', `видны ${v}`, v === '101,103');
    await page.locator('btf-panel .switch').click(); await page.waitForTimeout(150);

    await pick(page, 'Dev C');
    await pick(page, 'Dev B');
    v = await visible(page);
    check('TC-06', 'Assigned To карточки и Task; Created By не учитывается (Dev B)', 'видны 101, 102', `видны ${v}`, v === '101,102');
    await pick(page, 'Dev B');

    await pick(page, 'Analyst D');
    v = await visible(page);
    check('TC-07', 'Пользовательское поле типа Identity (Analyst D)', 'видна 102', `видны ${v}`, v === '102');
    await pick(page, 'Dev C');
    v = await visible(page);
    check('TC-08', 'Несколько людей: карточки любого из них (Analyst D + Dev C)', 'видны 102, 103', `видны ${v}`, v === '102,103');
    await pick(page, 'Analyst D');

    await pick(page, 'Dev C');
    await pick(page, 'QA E');
    v = await visible(page);
    check('TC-09', 'Многозначное поле Identity (QA E в Custom.Reviewers)', 'видна 102', `видны ${v}`, v === '102');
    await pick(page, 'QA E');
    await pick(page, 'Dev C');

    await page.locator('btf-panel .search input').fill('dev');
    const filtered = await people(page);
    check('TC-10', 'Поиск по людям', 'Dev B 2, Dev C 1', filtered.join(', '), filtered.join(',') === 'Dev B 2,Dev C 1');
    await page.locator('btf-panel .search input').fill('');

    const before = api.length;
    await pick(page, 'Owner A'); await pick(page, 'Owner A');
    check('TC-11', 'Смена выбора без запросов к серверу', '0 запросов', `${api.length - before} запросов`, api.length === before);

    // Простой при включённом отборе: никаких повторных пересчётов
    await page.evaluate(() => {
      window.__resize = 0; window.__marks = 0;
      window.addEventListener('resize', () => window.__resize++);
      new MutationObserver((r) => { window.__marks += r.length; }).observe(document.getElementById('board'), { attributes: true, subtree: true });
    });
    await page.waitForTimeout(3000);
    const idle = await page.evaluate(() => ({ r: window.__resize, m: window.__marks }));
    check('TC-12', 'Нет лишней работы в простое (3 с, выбран Dev C)', '0 событий resize, 0 изменений карточек', `${idle.r} resize, ${idle.m} изменений`, idle.r === 0 && idle.m === 0);

    // Перерисовка скрытой карточки: та же карточка, новый элемент
    await page.evaluate(() => { const el = document.querySelector('[data-n="101"]'); el.replaceWith(document.createRange().createContextualFragment(el.outerHTML.replace(/ ?filterHide/, '').replace(/ data-btf-hidden=""/, ''))); });
    await page.waitForTimeout(700);
    v = await visible(page);
    const rr = await page.evaluate(() => window.__resize);
    check('TC-13', 'Перерисовка карточки: отбор применяется снова без пересчёта раскладки', '101 скрыта, 0 resize', `видны ${v}; ${rr} resize`, v === '103' && rr === 0);

    await page.locator('btf-panel .reset').click(); await page.waitForTimeout(150);
    v = await visible(page);
    const st15 = await status(page);
    check('TC-14', 'Сброс возвращает карточки', 'видны 101–104; «Карточек на доске: 4. Выберите людей»', `видны ${v}; «${st15}»`, v === '101,102,103,104' && st15 === 'Карточек на доске: 4. Выберите людей');

    // Встроенный фильтр скрыл 103 (подходит под Dev C)
    await page.evaluate(() => document.querySelector('[data-n="103"]').classList.add('filterHide'));
    await pick(page, 'Dev C');
    const st17 = await status(page);
    check('TC-15', 'Счётчик не учитывает карточки, скрытые встроенным фильтром', '«Показано 0 из 3»', `«${st17}»`, st17 === 'Показано 0 из 3');
    await page.locator('btf-panel .reset').click(); await page.waitForTimeout(150);
    v = await visible(page);
    check('TC-16', 'Сброс не показывает карточку, скрытую только встроенным фильтром', '103 скрыта', `видны ${v}`, !v.split(',').includes('103'));
    await page.evaluate(() => document.querySelector('[data-n="103"]').classList.remove('filterHide'));

    // Встроенный фильтр скрыл 102, расширение тоже решило её скрыть
    await page.evaluate(() => document.querySelector('[data-n="102"]').classList.add('filterHide'));
    await pick(page, 'Dev C');
    await page.locator('btf-panel .reset').click(); await page.waitForTimeout(150);
    v = await visible(page);
    check('TC-17', 'Сброс не отменяет встроенный фильтр, если карточку скрыли оба', '102 скрыта', `видны ${v}`, !v.split(',').includes('102'));
    await page.evaluate(() => document.querySelector('[data-n="102"]').classList.remove('filterHide'));

    // Новая карточка при включённом отборе
    await pick(page, 'Dev C');
    const before19 = api.length;
    await page.evaluate((html) => document.getElementById('board').insertAdjacentHTML('beforeend', html), card(105));
    const st19 = await waitStatus(page, (s) => s === 'Показано 2 из 5', 5000);
    v = await visible(page);
    check('TC-18', 'Новая карточка дозагружается и проходит отбор', 'запросы только по 105; видны 103, 105; «Показано 2 из 5»',
      `${api.slice(before19).map((a) => a.api + (a.n ? '(' + a.n + ')' : '')).join(', ')}; видны ${v}; «${st19}»`,
      v === '103,105' && st19 === 'Показано 2 из 5' && api.slice(before19).every((a) => a.api === 'wiql' || a.n === 1));

    const before20 = api.length;
    await page.locator('btf-panel .refresh').click();
    const st20 = await waitStatus(page, (s) => s.startsWith('Показано'), 5000);
    check('TC-19', '«Обновить» перечитывает данные и сохраняет выбор', 'новые запросы, выбран Dev C, отбор применён',
      `${api.length - before20} запроса; «${st20}»`, api.length > before20 && st20 === 'Показано 2 из 5');

    await page.locator('btf-panel .hide').click(); await page.waitForTimeout(150);
    const pill = await page.locator('btf-panel .pill').textContent();
    v = await visible(page);
    check('TC-20', 'Свёрнутая панель: отбор действует, на кнопке видно выбор', 'кнопка «Dev C 2/5», видны 103, 105', `«${pill.trim()}»; видны ${v}`, pill.includes('Dev C') && pill.includes('2/5') && v === '103,105');
    if (shots) await page.locator('btf-panel .pill').screenshot({ path: shots + '/panel-collapsed.png' });
    await page.locator('btf-panel .pill').click(); await page.waitForTimeout(100);

    // Клавиатура
    await page.locator('btf-panel .reset').click();
    await page.locator(`btf-panel .row[data-key="${key('Owner A')}"]`).focus();
    await page.keyboard.press('Space'); await page.waitForTimeout(150);
    v = await visible(page);
    check('TC-21', 'Выбор с клавиатуры (пробел на строке)', 'видны 101, 103', `видны ${v}`, v === '101,103');

    // Запоминание выбора после перезагрузки страницы
    await page.reload(); await inject(page);
    const st22 = await waitStatus(page, (s) => s.startsWith('Показано'));
    v = await visible(page);
    check('TC-22', 'Выбор запоминается для доски', 'после перезагрузки выбран Owner A, видны 101, 103', `«${st22}»; видны ${v}`, v === '101,103');

    // Переход на другую доску без перезагрузки страницы
    const before23 = api.length;
    await page.evaluate((html) => {
      history.pushState({}, '', '/tfs/Coll/Proj/_boards/board/t/Team2/Stories');
      document.getElementById('board').innerHTML = html;
    }, card(301) + card(302));
    const st23 = await waitStatus(page, (s) => s.startsWith('Карточек на доске: 2'), 5000);
    v = await visible(page);
    check('TC-23', 'Переход на другую доску: данные загружаются заново, выбор прежней доски не переносится', '«Карточек на доске: 2…», видны 301, 302',
      `«${st23}»; видны ${v}; запросов ${api.length - before23}`, st23.startsWith('Карточек на доске: 2') && v === '301,302' && api.length > before23);

    await page.evaluate(() => history.pushState({}, '', '/tfs/Coll/Proj/_workitems/recentlyupdated'));
    await page.waitForTimeout(1300);
    const hidden = await page.$eval('btf-panel', (h) => h.hidden);
    check('TC-24', 'Вне доски панель скрыта', 'панель скрыта', hidden ? 'скрыта' : 'видна', hidden === true);
    await context.close();
  }

  // ---------- Адрес без /tfs/ ----------
  {
    const { context, page, api } = await openBoard(browser, 'https://ado.example.com/Coll/Proj/_boards/board/t/Team/Stories');
    await waitStatus(page, ready);
    const base = api[0].url.split('/_apis')[0];
    check('TC-25', 'Базовый адрес API для адреса без /tfs/', 'https://ado.example.com/Coll/Proj', base, base === 'https://ado.example.com/Coll/Proj');
    await context.close();
  }

  // ---------- Ошибки ----------
  {
    const { context, page } = await openBoard(browser, BOARD, { mode: 'forbidden' });
    const st = await waitStatus(page, (s) => s.includes('прав'));
    check('TC-26', 'Сервер отвечает 403', '«Нет прав на чтение рабочих элементов проекта.»', `«${st}»`, st === 'Нет прав на чтение рабочих элементов проекта.');
    await context.close();
  }
  {
    const { context, page } = await openBoard(browser, BOARD, { mode: 'offline' });
    const st = await waitStatus(page, (s) => s.includes('недоступен'));
    check('TC-27', 'Нет связи с сервером', '«Сервер недоступен. Проверьте сеть или VPN.»', `«${st}»`, st === 'Сервер недоступен. Проверьте сеть или VPN.');
    await context.close();
  }
  {
    const { context, page } = await openBoard(browser, BOARD, { ids: [] });
    const st = await waitStatus(page, (s) => s.startsWith('Карточки не найдены'), 20000);
    check('TC-28', 'На доске нет карточек', 'через 15 с «Карточки не найдены…»', `«${st}»`, st.startsWith('Карточки не найдены'));
    await context.close();
  }

  // ---------- Настройки ----------
  {
    const { context, page } = await openBoard(browser, BOARD, { settings: { childTypes: ['Task', 'Bug'] } });
    await waitStatus(page, ready);
    const list = await people(page);
    await pick(page, 'QA E');
    const v = await visible(page);
    check('TC-29', 'Настройка: дочерние Task и Bug', 'QA E 2; видны 102, 103', `${list.find((p) => p.startsWith('QA E'))}; видны ${v}`, list.includes('QA E 2') && v === '102,103');
    await context.close();
  }
  {
    const { context, page } = await openBoard(browser, BOARD, { settings: { useCardFields: false } });
    await waitStatus(page, ready);
    const list = await people(page);
    check('TC-30', 'Настройка: не учитывать поля карточки', 'в списке только исполнители Task: Dev B 1, Dev C 1', list.join(', '), list.join(',') === 'Dev B 1,Dev C 1');
    await context.close();
  }
  {
    const { context, page } = await openBoard(browser, BOARD, { settings: { doneStates: ['Done', 'Removed'] } });
    await waitStatus(page, ready);
    await pick(page, 'Dev C');
    const v = await visible(page);
    check('TC-31', 'Настройка: свой список завершённых состояний (Closed не завершённое)', 'видны 101, 103', `видны ${v}`, v === '101,103');
    await context.close();
  }
  {
    const { context, page } = await openBoard(browser, BOARD, { settings: { cardSelector: '.tile-x', cardIdSelector: '.num' } });
    await page.evaluate(() => { document.getElementById('board').innerHTML = '<div class="tile-x"><a href="/tfs/Coll/Proj/_workitems/edit/101">PBI</a></div><div class="tile-x"><span class="num">#103</span></div>'; });
    const st = await waitStatus(page, ready);
    check('TC-32', 'Настройка: свои селекторы; номер из ссылки на рабочий элемент', '«Карточек на доске: 2…»', `«${st}»`, st.startsWith('Карточек на доске: 2'));
    await context.close();
  }
  {
    const { context, page } = await openBoard(browser, BOARD, { settings: { panelSide: 'left', theme: 'dark' }, scale: 2 });
    await waitStatus(page, ready);
    await pick(page, 'Dev C');
    const box = await page.locator('btf-panel .card').boundingBox();
    check('TC-33', 'Настройка: панель слева, тёмная тема', 'панель у левого края', `x = ${Math.round(box.x)}`, box.x < 40);
    if (shots) await page.locator('btf-panel .card').screenshot({ path: shots + '/panel-dark.png' });
    // Смена настроек на лету
    await page.evaluate(() => chrome.storage.sync.set({ panelSide: 'right', theme: 'light' }));
    await page.waitForTimeout(600);
    const box2 = await page.locator('btf-panel .card').boundingBox();
    check('TC-34', 'Изменение настроек применяется без перезагрузки страницы', 'панель справа', `x = ${Math.round(box2.x)}`, box2.x > 700);
    await context.close();
  }

  // ---------- Большая доска ----------
  {
    const ids = Array.from({ length: 250 }, (_, i) => 1000 + i);
    const { context, page, api } = await openBoard(browser, BOARD, { ids });
    await waitStatus(page, ready);
    const batches = api.filter((a) => a.api === 'workitemsbatch').map((a) => a.n).join('+');
    const wiql = api.filter((a) => a.api === 'wiql').length;
    check('TC-35', 'Большая доска: пакеты по 200 и WIQL по 100 карточек', 'workitemsbatch 200+50, 3 WIQL-запроса', `workitemsbatch ${batches}, ${wiql} WIQL`, batches === '200+50' && wiql === 3);
    await context.close();
  }

  // ---------- Скриншот для документации ----------
  if (shots) {
    const { context, page } = await openBoard(browser, BOARD, { scale: 2 });
    await waitStatus(page, ready);
    await pick(page, 'Dev C');
    await page.screenshot({ path: shots + '/board.png' });
    await context.close();
  }

  await browser.close();
}

module.exports = { run };
