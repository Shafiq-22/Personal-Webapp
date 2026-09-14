import { loadConfig, saveConfig } from './config.js';

const baseUrlField = document.querySelector('#baseUrl');
const tokenField = document.querySelector('#token');
const statusLine = document.querySelector('#status');

loadConfig().then((config) => {
  baseUrlField.value = config.baseUrl;
  if (config.accessToken) tokenField.placeholder = 'A token is already saved';
});

document.querySelector('#save').addEventListener('click', async () => {
  const patch = { baseUrl: baseUrlField.value.trim().replace(/\/+$/, '') };
  if (tokenField.value.trim()) patch.accessToken = tokenField.value.trim();

  await saveConfig(patch);
  statusLine.className = 'ok';
  statusLine.textContent = 'Saved.';
  tokenField.value = '';
});
