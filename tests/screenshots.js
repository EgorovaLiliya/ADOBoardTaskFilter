// Скриншоты для документации на демонстрационных данных: node tests/screenshots.js docs/img
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { EXT, CONTENT_FILES, boardHtml, CHROME_SHIM } = require('./lib/fixtures');

const OUT = path.resolve(process.argv[2] || 'docs/img');
const person = (name, login) => ({ displayName: name, uniqueName: login + '@company.ru', id: login });
const P = {
  anna: person('Анна Иванова', 'a.ivanova'), sergey: person('Сергей Петров', 's.petrov'),
  olga: person('Ольга Морозова', 'o.morozova'), dmitry: person('Дмитрий Козлов', 'd.kozlov'),
  kate: person('Екатерина Новикова', 'e.novikova'), alex: person('Алексей Смирнов', 'a.smirnov')
};
const CARDS = {
  11: [P.olga, [[P.sergey, 'Active'], [P.dmitry, 'Active']]],
  12: [P.olga, [[P.anna, 'Active']]],
  13: [P.alex, [[P.sergey, 'Closed'], [P.kate, 'Active']]],
  14: [P.olga, [[P.dmitry, 'Active']]],
  15: [P.alex, [[P.anna, 'Active'], [P.kate, 'Active']]],
  16: [P.olga, [[P.sergey, 'Active']]],
  17: [P.alex, [[P.dmitry, 'Closed']]],
  18: [P.olga, [[P.anna, 'Closed']]]
};

async function panelShots(browser) {
  const ids = Object.keys(CARDS).map(Number);
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.addInitScript(CHROME_SHIM);
    await page.route('https://ado.example.com/**', async (route) => {
      const u = route.request().url();
      if (!u.includes('/_apis/')) return route.fulfill({ contentType: 'text/html', body: boardHtml(ids) });
      const body = JSON.parse(route.request().postData());
      if (u.includes('wiql')) {
        const rel = [];
        for (const id of ids) CARDS[id][1].forEach((_, i) => rel.push({ rel: 'System.LinkTypes.Hierarchy-Forward', source: { id }, target: { id: id * 10 + i } }));
        return route.fulfill({ json: { workItemRelations: rel } });
      }
      const value = body.ids.map((id) => {
        if (CARDS[id]) return { id, fields: { 'System.Id': id, 'System.AssignedTo': CARDS[id][0] } };
        const [assignee, state] = CARDS[Math.floor(id / 10)][1][id % 10];
        return { id, fields: { 'System.Id': id, 'System.State': state, 'System.AssignedTo': assignee } };
      });
      return route.fulfill({ json: { value } });
    });
    await page.goto('https://ado.example.com/Coll/Proj/_boards/board/t/Team/Stories');
    for (const code of CONTENT_FILES) await page.addScriptTag({ content: code });
    await page.waitForFunction(() => document.querySelector('btf-panel')?.shadowRoot.querySelector('.status')?.textContent.startsWith('Карточек'));
    await page.locator('btf-panel .row[data-key="a.ivanova@company.ru"]').click();
    await page.locator('btf-panel .row[data-key="d.kozlov@company.ru"]').click();
    await page.waitForTimeout(200);
    await page.locator('btf-panel .card').screenshot({ path: path.join(OUT, `panel-${scheme}.png`) });
    if (scheme === 'light') {
      await page.locator('btf-panel .hide').click();
      await page.waitForTimeout(150);
      await page.locator('btf-panel .pill').screenshot({ path: path.join(OUT, 'panel-collapsed.png') });
    }
    await ctx.close();
  }
}

async function optionsShots(browser) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(CHROME_SHIM + `
    localStorage.setItem('__shim_sync', JSON.stringify({ servers: ['https://ado.company.ru', 'http://tfs.local:8080'] }));
    window.chrome.permissions = {
      contains: async ({ origins }) => origins[0].startsWith('https://ado.company.ru'),
      request: async () => true, remove: async () => true
    };`);
  await page.route('https://options.test/**', (route) => {
    const file = path.join(EXT, new URL(route.request().url()).pathname.slice(1));
    const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' }[path.extname(file)];
    return fs.existsSync(file) ? route.fulfill({ body: fs.readFileSync(file), contentType: type }) : route.fulfill({ status: 404 });
  });
  await page.goto('https://options.test/src/options/options.html');
  await page.waitForTimeout(400);
  await page.locator('section.card').first().screenshot({ path: path.join(OUT, 'options-servers.png') });
  await page.screenshot({ path: path.join(OUT, 'options.png'), fullPage: true });
  await ctx.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  await panelShots(browser);
  await optionsShots(browser);
  await browser.close();
  console.log('Скриншоты сохранены в', OUT);
})();
