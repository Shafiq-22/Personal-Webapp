import { callApi } from './config.js';
import { extractPageData } from './extract.js';

/**
 * Right-click menu: save a page, or a selection, without opening the popup.
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'cortex-save', title: 'Save to Cortex', contexts: ['page', 'link', 'selection'] });
  chrome.contextMenus.create({ id: 'cortex-task', title: 'Create a Cortex task to read this', contexts: ['page', 'link', 'selection'] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageData });
    const clipped = await callApi('/api/items', { body: result });

    if (info.menuItemId === 'cortex-task') {
      await callApi('/api/tasks', {
        body: {
          title: `Read: ${result.title}`.slice(0, 500),
          notes: result.url,
          estimateMinutes: 25,
          origin: 'clipper',
          sourceItemId: clipped.item.id,
        },
      });
    }

    await notify('Saved to Cortex', clipped.deduped ? 'Already in your library - marked as saved.' : result.title);
  } catch (error) {
    await notify('Could not save', error.message);
  }
});

async function notify(title, message) {
  // A badge rather than a notification permission: less intrusive, and it does
  // not require another prompt.
  await chrome.action.setBadgeText({ text: title.startsWith('Saved') ? 'OK' : '!' });
  await chrome.action.setBadgeBackgroundColor({ color: title.startsWith('Saved') ? '#16a34a' : '#dc2626' });
  await chrome.action.setTitle({ title: `${title}: ${message}` });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
}
