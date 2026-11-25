'use strict';
let assets = [], editing = null, busy = false;
const $ = id => document.getElementById(id);
const fields = ['tagId', 'assetName', 'serialNumber', 'deviceType', 'purchaseDate', 'condition', 'location', 'warrantyDate'];
function showMessage(text, type = 'success') { $('messageBox').textContent = text; $('messageBox').className = type; }
async function api(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options,
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to save the asset.');
  return data;
}
function renderInventory() {
  const query = $('searchInput').value.trim().toLowerCase();
  const matches = assets.filter(asset => [asset.tagId, asset.assetName, asset.deviceType, asset.serialNumber].some(value => value.toLowerCase().includes(query)));
  $('inventoryList').replaceChildren(); $('noResults').classList.toggle('hidden', matches.length > 0);
  for (const asset of matches) {
    const row = document.createElement('tr');
    for (const value of [asset.tagId, asset.serialNumber, `${asset.assetName} / ${asset.deviceType}`, asset.location, asset.condition, asset.status]) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    const actions = document.createElement('td'); const edit = document.createElement('button');
    edit.type = 'button'; edit.textContent = 'Edit'; edit.disabled = busy; edit.addEventListener('click', () => editAsset(asset));
    actions.append(edit); row.append(actions); $('inventoryList').append(row);
  }
}
async function refreshAssets() {
  try { assets = await api('/api/assets'); renderInventory(); }
  catch (error) { showMessage(error.message, 'error'); }
}
function editAsset(asset) {
  editing = { tagId: asset.tagId, version: asset.version };
  for (const field of fields) $(field).value = asset[field];
  $('tagId').readOnly = true;
  $('formTitle').textContent = 'Edit Asset'; $('submitBtn').textContent = 'Update Asset'; $('cancelEditBtn').classList.remove('hidden');
  window.scrollTo(0, 0); $('assetName').focus();
}
function resetForm() {
  editing = null; $('assetForm').reset(); $('tagId').readOnly = false; $('editIndex').value = '-1';
  $('formTitle').textContent = 'Create New Asset'; $('submitBtn').textContent = 'Save Asset'; $('cancelEditBtn').classList.add('hidden');
}
$('assetForm').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  busy = true; $('submitBtn').disabled = true; $('cancelEditBtn').disabled = true; renderInventory();
  const data = Object.fromEntries(fields.map(field => [field, $(field).value.trim()]));
  if (editing) data.version = editing.version;
  try {
    await api(editing ? '/api/assets/' + encodeURIComponent(editing.tagId) : '/api/assets', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(data) });
    const updated = !!editing; resetForm(); await refreshAssets(); showMessage(updated ? 'Asset updated in the shared database.' : 'Asset saved in the shared database.');
  } catch (error) { showMessage(error.message, 'error'); }
  finally { busy = false; $('submitBtn').disabled = false; $('cancelEditBtn').disabled = false; renderInventory(); }
});
$('searchInput').addEventListener('input', renderInventory);
$('refreshAssets').addEventListener('click', refreshAssets);
try {
  const saved = JSON.parse(localStorage.getItem('assetData') || '[]');
  if (Array.isArray(saved) && saved.length) {
    $('importAssets').hidden = false; $('importNote').hidden = false;
    $('importAssets').addEventListener('click', async () => {
      $('importAssets').disabled = true;
      try {
        const result = await api('/api/assets/import', { method: 'POST', body: JSON.stringify({ assets: saved }) });
        showMessage(`Imported ${result.imported} assets into the shared database.`); $('importAssets').hidden = true; $('importNote').hidden = true; await refreshAssets();
      } catch (error) { showMessage('Import was not saved: ' + error.message, 'error'); }
      finally { $('importAssets').disabled = false; }
    });
  }
} catch { showMessage('Your old browser inventory could not be read. Shared database records are still available.', 'error'); }
window.addEventListener('focus', () => { if (!busy) refreshAssets(); });
refreshAssets();
