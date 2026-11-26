'use strict';
const model = window.ReturnModel;
const demoMode = new URLSearchParams(location.search).get('demo') === '1';
const demoKey = 'wjcAssetReturnsDemo.v1';
const $ = id => document.getElementById(id);
let loans = [], history = [], emails = [], selectedID = null, correctionRecord = null, busy = false, loaded = false;

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
  try { model.validateSearch($('loan-search').value); $('search-error').hidden = true; $('loan-search').removeAttribute('aria-invalid'); }
  catch (error) { $('search-error').hidden = false; $('search-error').textContent = error.message; $('loan-search').setAttribute('aria-invalid', 'true'); $('loan-list').replaceChildren(); empty($('loan-list'), 4, 'Correct the search input to view results.'); return; }
  const outstanding = loans.filter(loan => model.loanState(loan) !== 'Returned');
  const matches = outstanding.filter(loan => (!$('overdue-only').checked || loan.dueDate < model.today()) && [loan.assetID, loan.assetName, loan.borrowerName, loan.borrowerID].some(value => String(value || '').toLowerCase().includes(query)));
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
  if (!matches.length) empty(body, 8, query ? 'No returns match your search.' : 'No returns recorded yet.');
  for (const item of matches) {
    const row = document.createElement('tr'); cell(row, new Date(item.returnedAt).toLocaleString()); assetCell(row, item);
    const conditionCell = cell(row, `${item.previousCondition} → ${item.correctedCondition ?? item.condition}`);
    if (item.correctedCondition != null) { const original = document.createElement('small'); original.textContent = `Original return: ${item.condition}. Correction: ${item.correctionReason}`; conditionCell.append(original); } cell(row, item.assetStatus); cell(row, item.staffName);
    cell(row, item.emailStatus === 'Pending' ? 'Pending delivery' : item.emailStatus); cell(row, (item.correctedNotes ?? item.notes) || '—');
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Correct history'; edit.disabled = demoMode; edit.addEventListener('click', () => openCorrection(item)); cell(row, '').append(edit); body.append(row);
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
    if (!demoMode) { const evidence = await request('/emails'); emails = evidence.emails; $('email-configuration').textContent = evidence.senderConfigured ? 'Sent means accepted by the configured mail service. Captured means a test inbox received it; no real recipient delivery occurred.' : 'Email transport is not configured. Content can be previewed; configure SMTP or ETHEREAL_EMAIL=1 and restart to test delivery.'; }
    else { emails = []; $('email-configuration').textContent = 'Sample mode does not send emails. Use connected records for email and reminder tests.'; }
    renderEvidence(); loadReminderLoans();
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
    if (loaded) showMessage(demoMode ? 'Sample return recorded. No inventory records were changed and no email was sent.' : 'Return recorded. Review its confirmation content and delivery status in Email evidence.');
  } catch (error) { showMessage(error.message, true); }
  finally { busy = false; $('return-fields').disabled = selectedID === null; $('refresh').disabled = false; renderLoans(); }
});
$('loan-search').addEventListener('input', renderLoans);
$('overdue-only').addEventListener('change', renderLoans);
$('history-search').addEventListener('input', renderHistory);
$('refresh').addEventListener('click', () => { clearSelection(); refresh(); });
$('cancel-return').addEventListener('click', clearSelection);
$('demo-toggle').addEventListener('click', () => { const url = new URL(location.href); if (demoMode) url.searchParams.delete('demo'); else url.searchParams.set('demo', '1'); location.href = url.href; });
$('demo-staff-field').hidden = !demoMode; $('demo-staff').required = demoMode;
$('demo-toggle').textContent = demoMode ? 'Use connected loan records' : 'Try with sample loans';
$('mode-note').textContent = demoMode ? 'Sample mode: fictional loans are saved only in this browser. Real inventory and email are not connected.' : 'Connected mode: inspection history, corrections, custom reminders, and email evidence are saved in the database.';
function openCorrection(item) {
  correctionRecord = item; $('correction-panel').hidden = false; $('correction-asset').textContent = `${item.assetID} — ${item.borrowerName}`;
  $('correction-condition').value = item.correctedCondition ?? item.condition; $('correction-notes').value = item.correctedNotes ?? item.notes; $('correction-reason').value = '';
  $('correction-panel').scrollIntoView({ behavior: 'smooth' }); $('correction-condition').focus();
}
$('cancel-correction').addEventListener('click', () => { correctionRecord = null; $('correction-panel').hidden = true; });
$('correction-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!correctionRecord) return; const button = event.submitter; button.disabled = true;
  const input = { condition: $('correction-condition').value, notes: $('correction-notes').value, reason: $('correction-reason').value, revision: correctionRecord.revision || 0 };
  try { model.validateCorrection(input); await request(`/history/${correctionRecord.returnID}/corrections`, { method: 'POST', body: JSON.stringify(input) });
    correctionRecord = null; $('correction-panel').hidden = true; await refresh(); showMessage('History correction saved. The original return record was retained.');
  } catch (error) { showMessage(error.message, true); } finally { button.disabled = false; }
});
function loadReminderLoans() {
  const select = $('reminder-loan'), previous = select.value; select.replaceChildren();
  const first = document.createElement('option'); first.value = ''; first.textContent = 'Select a loan'; select.append(first);
  for (const loan of loans.filter(item => model.loanState(item) !== 'Returned')) { const option = document.createElement('option'); option.value = loan.transactionID; option.textContent = `${loan.assetID} — ${loan.borrowerName}`; select.append(option); }
  select.value = previous; $('save-reminders').disabled = demoMode; $('process-reminders').disabled = demoMode;
  const date = new Date(Date.now() + 60000); date.setSeconds(0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  for (const id of ['borrowed-at', 'overdue-at', 'missing-at']) $(id).min = local;
}
$('reminder-form').addEventListener('submit', async event => {
  event.preventDefault(); if (demoMode) return; $('save-reminders').disabled = true;
  try {
    const input = { borrowedAt: new Date($('borrowed-at').value).toISOString(), overdueAt: new Date($('overdue-at').value).toISOString(), missingAt: new Date($('missing-at').value).toISOString() };
    model.validateSchedule(input); await request(`/reminders/${encodeURIComponent($('reminder-loan').value)}`, { method: 'POST', body: JSON.stringify(input) });
    await refresh(); showMessage('Custom reminder dates saved. Emails will become ready when their labels are applied.');
  } catch (error) { showMessage(error.message, true); } finally { $('save-reminders').disabled = false; }
});
$('process-reminders').addEventListener('click', async () => {
  $('process-reminders').disabled = true;
  try { await request('/process-reminders', { method: 'POST', body: '{}' }); await refresh(); showMessage('Due reminder check completed. Review email statuses below.'); }
  catch (error) { showMessage(error.message, true); } finally { $('process-reminders').disabled = false; }
});
function renderEvidence() {
  const body = $('email-list'); body.replaceChildren(); if (!emails.length) empty(body, 5, 'No confirmation or reminder emails recorded.');
  for (const email of emails) {
    const row = document.createElement('tr'); cell(row, email.kind === 'return' ? 'Return confirmation' : email.tag + ' reminder');
    cell(row, email.recipient); const timing = cell(row, new Date(email.scheduledAt || email.createdAt).toLocaleString());
    if (email.administeredAt) { const applied = document.createElement('small'); applied.textContent = 'Label applied: ' + new Date(email.administeredAt).toLocaleString(); timing.append(applied); }
    if (email.sentAt) { const sent = document.createElement('small'); sent.textContent = 'Processed: ' + new Date(email.sentAt).toLocaleString(); timing.append(sent); }
    cell(row, email.status + (email.lastError ? ' — ' + email.lastError : ''));
    const actions = cell(row, ''); const preview = document.createElement('button'); preview.type = 'button'; preview.textContent = 'Preview content';
    preview.addEventListener('click', () => { $('email-subject').textContent = email.subject; $('email-recipient').textContent = 'To: ' + email.recipient; $('email-body').textContent = email.body; $('email-preview').showModal(); }); actions.append(preview);
    if (['Pending', 'Failed'].includes(email.status)) {
      const send = document.createElement('button'); send.type = 'button'; send.textContent = email.status === 'Failed' ? 'Retry email' : 'Send email';
      send.addEventListener('click', async () => { send.disabled = true;
        try { const result = await request(`/emails/${email.kind}/${email.emailID}/send`, { method: 'POST', body: '{}' }); await refresh(); showMessage(result.error || 'Email status: ' + result.status, result.status === 'Failed'); }
        catch (error) { showMessage(error.message, true); } finally { send.disabled = false; }
      }); actions.append(send);
    }
    if (email.previewUrl) { try { const url = new URL(email.previewUrl); if (url.protocol === 'https:') { const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open test inbox'; actions.append(link); } } catch {} }
    body.append(row);
  }
}
renderLoans(); renderHistory(); refresh();
