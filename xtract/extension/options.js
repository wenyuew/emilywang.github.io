const $ = id => document.getElementById(id);

chrome.storage.local.get(['apiKey', 'model']).then(({ apiKey, model }) => {
  $('apiKey').value = apiKey || '';
  $('model').value = model || '';
});

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim()
  });
  $('msg').textContent = 'Saved';
  setTimeout(() => { $('msg').textContent = ''; }, 2000);
});
