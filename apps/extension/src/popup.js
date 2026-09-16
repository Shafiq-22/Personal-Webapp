import { callApi } from './config.js';
import { extractPageData } from './extract.js';

const titleField = document.querySelector('#title');
const noteField = document.querySelector('#note');
const contextLine = document.querySelector('#context');
const createTaskBox = document.querySelector('#createTask');
const saveButton = document.querySelector('#save');
const statusLine = document.querySelector('#status');

let page = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageData });
    page = result;
    titleField.value = result.title ?? '';

    const bits = [];
    if (result.kind !== 'article') bits.push(result.kind);
    if (result.doi) bits.push(`DOI ${result.doi}`);
    if (result.arxivId) bits.push(`arXiv:${result.arxivId}`);
    if (result.authors.length) bits.push(`${result.authors.length} author${result.authors.length === 1 ? '' : 's'}`);
    if (result.hasSelection) bits.push('using your selection as the note');
    contextLine.textContent = bits.join(' · ');
  } catch {
    // Chrome refuses to inject into its own pages; saving the URL still works.
    page = { url: tab.url, title: tab.title, authors: [], kind: 'article' };
    titleField.value = tab.title ?? '';
    contextLine.textContent = 'Only the link could be read from this page.';
  }
}

saveButton.addEventListener('click', async () => {
  if (!page) return;
  saveButton.disabled = true;
  statusLine.className = '';
  statusLine.textContent = 'Saving...';

  try {
    const clipped = await callApi('/api/items', {
      body: { ...page, title: titleField.value, summary: noteField.value || page.summary },
    });

    if (createTaskBox.checked) {
      await callApi('/api/tasks', {
        body: {
          title: `Read: ${titleField.value}`.slice(0, 500),
          notes: page.url,
          estimateMinutes: 25,
          origin: 'clipper',
          sourceItemId: clipped.item.id,
        },
      });
    }

    statusLine.className = 'ok';
    statusLine.textContent = clipped.deduped ? 'Already in your library - marked as saved.' : 'Saved.';
    setTimeout(() => window.close(), 900);
  } catch (error) {
    statusLine.className = 'error';
    statusLine.textContent = error.message;
    saveButton.disabled = false;
  }
});

document.querySelector('#cancel').addEventListener('click', () => window.close());

init();
