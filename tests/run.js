// Запуск всех проверок: node tests/run.js [--shots папка-для-скриншотов]
const fs = require('fs');
const path = require('path');
const { createReport } = require('./lib/fixtures');

(async () => {
  const at = process.argv.indexOf('--shots');
  const shots = at > 0 ? path.resolve(process.argv[at + 1]) : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const report = createReport();
  for (const suite of ['content', 'options', 'extension']) {
    try {
      await require(`./${suite}.test.js`).run(report, shots);
    } catch (e) {
      report.check(`${suite}`, `Набор ${suite} упал`, 'без исключений', e.message, false);
    }
  }
  const failed = report.results.filter((r) => r.status !== 'Пройден');
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(report.results, null, 2));
  console.log(`\nИтого: ${report.results.length - failed.length} из ${report.results.length} пройдено`);
  process.exitCode = failed.length ? 1 : 0;
})();
