'use strict';
const model = window.ReturnModel;
const demoMode = new URLSearchParams(location.search).get('demo') === '1';
const demoKey = 'wjcAssetReturnsDemo.v1';
const $ = id => document.getElementById(id);
let loans = [], history = [], selectedID = null, busy = false, loaded = false;

function sampleState() {
  const date = offset => {
    const value = new Date(); value.setDate(value.getDate() + offset);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  };
  return { loans: [
    { transactionID: 1, assetID: 'DEMO-001', assetName: 'Dell Latitude laptop', borrowerName: 'Alex Morgan', borrowerID: 'STAFF-101', borrowerEmail: 'alex@example.com', checkOutDate: date(-10), dueDate: date(-2), status: 'Active', condition: 'Good' },
    { transactionID: 2, assetID: 'DEMO-002', assetName: 'Epson projector', borrowerName: 'Jordan Ellis', borrowerID: 'STAFF-102', borrowerEmail: 'jordan@example.com', checkOutDate: date(-3), dueDate: date(5), status: 'Active', condition: 'Fair' },
    { transactionID: 3, assetID: 'DEMO-003', assetName: 'Wireless microphone', borrowerName: 'Sam Taylor', borrowerID: 'STAFF-103', borrowerEmail: 'sam@example.com', checkOutDate: date(-50), dueDate: date(-33), status: 'Missing', condition: 'Good' }
  ], returns: [] };
}
function readDemo() {
  const saved = localStorage.getItem(demoKey);
  const state = saved ? JSON.parse(saved) : sampleState();
  if (!Array.isArray(state.loans) || !Array.isArray(state.returns)) throw new Error('The saved sample records could not be read.');
  return state;
}
async function request(path, options = {}) {
  const response = await fetch(`/api/returns${path}`, { credentials: 'same-origin', ...options,
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error('The Returns API is not connected. Use sample loans to preview this page.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to load or save returns.');
  return data;
}
function showMessage(text, error = false) {
  $('message').hidden = false; $('message').textContent = text;
  $('message').className = error ? 'error' : 'success';
}
function cell(row, text) {
  const td = document.createElement('td'); td.textContent = text ?? '—'; row.append(td); return td;
}
function empty(body, columns, text) {
  const row = document.createElement('tr'); const td = cell(row, text); td.colSpan = columns; td.className = 'empty'; body.append(row);
}
function assetCell(row, loan) {
  const td = cell(row, ''); const title = document.createElement('strong'); title.textContent = loan.assetID;
  const name = document.createElement('span'); name.textContent = loan.assetName || 'Asset name not recorded';
  const borrower = document.createElement('small'); borrower.textContent = `${loan.borrowerName} · ${loan.borrowerID}`;
  td.append(title, name, borrower);
}
function renderLoans() {
  const query = $('loan-search').value.trim().toLowerCase();
  const outstanding = loans.filter(loan => model.loanState(loan) !== 'Returned');
  const matches = outstanding.filter(loan => [loan.assetID, loan.assetName, loan.borrowerName, loan.borrowerID].some(value => String(value || '').toLowerCase().includes(query)));
  $('outstanding-count').textContent = loaded ? outstanding.length : '—';
  $('overdue-count').textContent = loaded ? outstanding.filter(loan => loan.dueDate < model.today()).length : '—';
  $('returns-count').textContent = loaded ? history.length : '—';
  $('result-count').textContent = loaded ? `${matches.length} shown` : '';
  const body = $('loan-list'); body.replaceChildren();
  if (!matches.length) empty(body, 4, !loaded ? 'Connect the Returns API or try sample loans below.' : query ? 'No loans match your search.' : 'No outstanding loans.');
  for (const loan of matches) {
    const row = document.createElement('tr'); if (String(loan.transactionID) === String(selectedID)) row.className = 'selected';
    assetCell(row, loan); cell(row, loan.dueDate);
    const state = model.loanState(loan); const badge = document.createElement('span'); badge.className = `badge ${state.toLowerCase()}`; badge.textContent = state; cell(row, '').append(badge);
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Select'; button.disabled = busy;
    button.setAttribute('aria-label', `Return ${loan.assetID} borrowed by ${loan.borrowerName}`);
    button.addEventListener('click', () => selectLoan(loan)); cell(row, '').append(button); body.append(row);
  }
}
function renderHistory() {
  const body = $('history-list'); body.replaceChildren();
  const query = $('history-search').value.trim().toLowerCase();
  const matches = history.filter(item => [item.assetID, item.assetName, item.borrowerName, item.borrowerID, item.staffName].some(value => String(value || '').toLowerCase().includes(query)));
  if (!matches.length) empty(body, 7, query ? 'No returns match your search.' : 'No returns recorded yet.');
  for (const item of matches) {
    const row = document.createElement('tr'); cell(row, new Date(item.returnedAt).toLocaleString()); assetCell(row, item);
    cell(row, `${item.previousCondition} → ${item.condition}`); cell(row, item.assetStatus); cell(row, item.staffName);
    cell(row, item.emailStatus === 'Pending' ? 'Pending delivery' : item.emailStatus); cell(row, item.notes || '—'); body.append(row);
  }
}
function clearSelection() {
  selectedID = null; $('return-form').reset(); $('return-fields').disabled = true;
  $('loan-details').hidden = true; $('selection-help').hidden = false; renderLoans();
}
function selectLoan(loan) {
  selectedID = loan.transactionID; $('return-form').reset(); $('return-fields').disabled = false;
  $('selection-help').hidden = true; const details = $('loan-details'); details.hidden = false; details.replaceChildren();
  for (const [label, value] of [['Asset', `${loan.assetID} · ${loan.assetName || ''}`], ['Borrower', `${loan.borrowerName} (${loan.borrowerID})`], ['Borrower email', loan.borrowerEmail], ['Due date', loan.dueDate], ['Previous condition', loan.condition || 'Not recorded']]) {
    const dt = document.createElement('dt'); dt.textContent = label; const dd = document.createElement('dd'); dd.textContent = value; details.append(dt, dd);
  }
  if (['New', 'Good', 'Fair', 'Poor'].includes(loan.condition)) $('return-condition').value = loan.condition;
  renderLoans(); $('return-condition').focus();
}
async function refresh() {
  $('refresh').disabled = true;
  try {
    const data = demoMode ? readDemo() : await request('');
    loans = data.loans; history = data.returns; loaded = true;
    if (selectedID !== null && !loans.some(item => String(item.transactionID) === String(selectedID) && model.loanState(item) !== 'Returned')) clearSelection();
  } catch (error) { loans = []; history = []; loaded = false; clearSelection(); showMessage(error.message, true); }
  finally { $('refresh').disabled = false; renderLoans(); renderHistory(); }
}
$('return-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || selectedID === null) return;
  const input = { condition: $('return-condition').value, assetStatus: $('return-status').value, notes: $('return-notes').value, received: $('physical-confirmation').checked };
  try {
    model.validateReturn(input); busy = true; $('return-fields').disabled = true; $('refresh').disabled = true; renderLoans();
    if (demoMode) {
      const next = model.recordDemoReturn(readDemo(), selectedID, input, $('demo-staff').value);
      localStorage.setItem(demoKey, JSON.stringify(next));
    } else await request(`/${encodeURIComponent(selectedID)}`, { method: 'POST', body: JSON.stringify(input) });
    clearSelection(); await refresh();
    if (loaded) showMessage(demoMode ? 'Sample return recorded. No inventory records were changed and no email was sent.' : 'Return recorded. Borrower confirmation is pending email delivery.');
  } catch (error) { showMessage(error.message, true); }
  finally { busy = false; $('return-fields').disabled = selectedID === null; $('refresh').disabled = false; renderLoans(); }
});
$('loan-search').addEventListener('input', renderLoans);
$('history-search').addEventListener('input', renderHistory);
$('refresh').addEventListener('click', () => { clearSelection(); refresh(); });
$('cancel-return').addEventListener('click', clearSelection);
$('demo-toggle').addEventListener('click', () => { const url = new URL(location.href); if (demoMode) url.searchParams.delete('demo'); else url.searchParams.set('demo', '1'); location.href = url.href; });
$('demo-staff-field').hidden = !demoMode; $('demo-staff').required = demoMode;
$('demo-toggle').textContent = demoMode ? 'Use connected loan records' : 'Try with sample loans';
$('mode-note').textContent = demoMode ? 'Sample mode: fictional loans are saved only in this browser. Real inventory and email are not connected.' : 'Connected mode: uses your signed-in staff account and the Returns API. Email confirmations remain pending until an email worker is connected.';
renderLoans(); renderHistory(); refresh();
