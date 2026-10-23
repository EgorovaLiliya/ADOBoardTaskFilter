/*
 * Service worker. Регистрирует content script только для тех серверов,
 * которые пользователь добавил в настройках и к которым выдал доступ.
 */
importScripts('shared/settings.js');

const SCRIPT_ID = 'btf-board';
const CONTENT_FILES = [
  'src/shared/settings.js',
  'src/content/ado-client.js',
  'src/content/board-index.js',
  'src/content/board-dom.js',
  'src/content/panel.js',
  'src/content/controller.js'
];

async function grantedServers(servers) {
  const result = [];
  for (const origin of servers) {
    const { permission, boardMatches } = BTF.settings.parseServer(origin);
    if (await chrome.permissions.contains({ origins: [permission] })) {
      result.push(...boardMatches);
    }
  }
  return result;
}

async function syncContentScripts() {
  const settings = await BTF.settings.load();
  const matches = await grantedServers(settings.servers);

  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }
  if (!matches.length) return;

  await chrome.scripting.registerContentScripts([{
    id: SCRIPT_ID,
    matches,
    js: CONTENT_FILES,
    runAt: 'document_idle',
    persistAcrossSessions: true
  }]);
}

// Выдача доступа и сохранение списка серверов приходят почти одновременно.
// Синхронизации выполняются строго по очереди, иначе скрипт зарегистрируется дважды.
let queue = Promise.resolve();
function resync() {
  queue = queue
    .then(syncContentScripts)
    .catch((e) => console.error('[ADO Board Task Filter]', e));
  return queue;
}

chrome.runtime.onInstalled.addListener((details) => {
  resync();
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(resync);
chrome.permissions.onAdded.addListener(resync);
chrome.permissions.onRemoved.addListener(resync);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.servers) resync();
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
