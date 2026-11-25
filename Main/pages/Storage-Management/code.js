'use strict';
let assets = [], locations = [], relocationHistory = [];
const $ = id => document.getElementById(id);
function showMessage(message, success) { $('relocation-message').textContent = message; $('relocation-message').style.color = success ? 'green' : '#a12622'; }
function cell(row, value) { const td = document.createElement('td'); td.textContent = value; row.append(td); }
function empty(body, text, count) { const row = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = count; td.textContent = text; row.append(td); body.append(row); }
function options(id, values) {
  const select = $(id), previous = select.value;
  select.replaceChildren(); const initial = document.createElement('option'); initial.value = ''; initial.textContent = 'Select an option'; select.append(initial);
  for (const [value, text] of values) { const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option); }
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}
async function request(url, body) {
  const response = await fetch(url, { cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load storage records.'); return data;
}
function currentLocation() { const asset = assets.find(asset => asset.assetID === $('asset-select').value); $('current-location').value = asset ? asset.location : ''; }
function searchAssets() {
  const body = $('asset-results'); body.replaceChildren();
  const location = $('location-search').value;
  if (!location) { empty(body, 'Select a location to view its assets.', 3); return; }
  const matches = assets.filter(asset => asset.location === location);
  if (!matches.length) empty(body, 'No assets are currently recorded at this location.', 3);
  for (const asset of matches) { const row = document.createElement('tr'); for (const value of [asset.assetID, asset.assetName, asset.location]) cell(row, value); body.append(row); }
}
function displayHistory() {
  const body = $('history-results'); body.replaceChildren(); const id = $('history-asset').value;
  if (!id) { empty(body, 'Select an asset to view its relocation history.', 4); return; }
  const records = relocationHistory.filter(record => record.assetID === id);
  if (!records.length) { const asset = assets.find(asset => asset.assetID === id); empty(body, 'No previous relocations recorded. Current location: ' + (asset?.location || 'Not recorded'), 4); }
  for (const record of records) { const row = document.createElement('tr'); for (const value of [record.previousLocation, record.newLocation, new Date(record.relocationDate).toLocaleString(), record.staffMember]) cell(row, value); body.append(row); }
}
async function refreshStorage() {
  try {
    const [data, account] = await Promise.all([request('/api/storage'), request('/api/auth/me')]);
    assets = data.assets; locations = data.locations; relocationHistory = data.history;
    $('staff-member').value = account.user.name;
    const assetOptions = assets.map(asset => [asset.assetID, `${asset.assetID} - ${asset.assetName}`]);
    options('asset-select', assetOptions); options('history-asset', assetOptions);
    options('destination', locations.map(location => [location, location])); options('location-search', locations.map(location => [location, location]));
    currentLocation(); searchAssets(); displayHistory();
  } catch (error) { showMessage(error.message, false); }
}
$('asset-select').addEventListener('change', currentLocation);
$('search-button').addEventListener('click', searchAssets);
$('location-search').addEventListener('change', searchAssets);
$('history-asset').addEventListener('change', displayHistory);
$('relocation-form').addEventListener('submit', async event => {
  event.preventDefault(); const asset = assets.find(asset => asset.assetID === $('asset-select').value);
  if (!asset) { showMessage('Select a valid asset.', false); return; }
  const button = event.submitter; if (button) button.disabled = true;
  try {
    await request('/api/storage/relocations', { assetID: asset.assetID, newLocation: $('destination').value, version: asset.version });
    await refreshStorage(); $('destination').value = ''; showMessage('Asset location updated in the shared database.', true);
  } catch (error) { showMessage(error.message, false); }
  finally { if (button) button.disabled = false; }
});
window.addEventListener('focus', refreshStorage);
refreshStorage();
