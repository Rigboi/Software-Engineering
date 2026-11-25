// ===== Shared data (the repository) =====
// Read the assets that the Asset Management page saved.
// 'assetData' is the same key Antwon's page uses, so both pages share one data store.
const assets = JSON.parse(localStorage.getItem('assetData')) || [];

// ===== Helper: how many days until a warranty ends =====
function getDaysRemaining(warrantyDate) {
  if (!warrantyDate) return null; // SR-6: no warranty date recorded

  const today = new Date();
  today.setHours(0, 0, 0, 0); // compare whole days, ignore the time of day

  const endDate = new Date(warrantyDate + 'T00:00:00'); // midnight, local time
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((endDate - today) / msPerDay);
}

// ===== Helper: which status tag a device gets =====
function getStatus(daysRemaining) {
  if (daysRemaining === null) return 'No Warranty Date'; // SR-6
  if (daysRemaining < 0) return 'Warranty Expired';      // SR-5 (ending today = 0, not expired yet)
  return 'Active';
}

// ===== Helper: add one cell to a table row =====
function addCell(row, text) {
  const cell = document.createElement('td');
  cell.textContent = text;
  row.appendChild(cell);
  return cell;
}

// ===== SR-5 and SR-6: show every device with its status =====
function renderDeviceTable() {
  const table = document.getElementById('deviceTable');
  table.innerHTML = '';

  if (assets.length === 0) {
    table.innerHTML = '<tr><td colspan="7">No assets found. Add assets on the Asset Management page.</td></tr>';
    return;
  }

  assets.forEach(asset => {
    const days = getDaysRemaining(asset.warrantyDate);
    const status = getStatus(days);

    const row = document.createElement('tr');
    addCell(row, asset.tagId);
    addCell(row, asset.deviceType);
    addCell(row, asset.serialNumber);
    addCell(row, asset.condition);
    addCell(row, asset.warrantyDate || '—');
    addCell(row, days === null ? '—' : days);

    // Status column: a coloured tag
    const statusCell = addCell(row, '');
    const tag = document.createElement('span');
    tag.textContent = status;
    if (status === 'Warranty Expired') tag.className = 'tag expired';
    else if (status === 'No Warranty Date') tag.className = 'tag no-date';
    else tag.className = 'tag active';
    statusCell.appendChild(tag);

    table.appendChild(row);
  });
}

renderDeviceTable();

// ===== SR-1: warning days setting =====
const DEFAULT_WARNING_DAYS = [30, 15, 7, 1];

// Use the saved setting if there is one, otherwise the defaults (AC-1)
let warningDays = JSON.parse(localStorage.getItem('warningDays')) || DEFAULT_WARNING_DAYS;

const warningInput = document.getElementById('warningDays');
const settingsMessage = document.getElementById('settingsMessage');

// Show the current setting in the box when the page opens
warningInput.value = warningDays.join(', ');

function saveWarningDays() {
  // "60, 30, 7" -> ["60", "30", "7"]
  const parts = warningInput.value.split(',').map(p => p.trim()).filter(p => p !== '');

  if (parts.length === 0) {
    settingsMessage.textContent = 'Error: enter at least one number of days.';
    return;
  }

  const days = [];
  for (const part of parts) {
    const number = Number(part);
    // TS-2: reject 0, negatives, decimals and letters
    if (!Number.isInteger(number) || number < 1) {
      settingsMessage.textContent = `Error: "${part}" is not valid. Use whole numbers of 1 or more.`;
      return; // stop here, so the previous setting is kept
    }
    days.push(number);
  }

  // Remove duplicates and sort largest first: 60, 30, 7
  warningDays = [...new Set(days)].sort((a, b) => b - a);
  localStorage.setItem('warningDays', JSON.stringify(warningDays));

  warningInput.value = warningDays.join(', ');
  settingsMessage.textContent = 'Warning days saved.';
  renderAlerts();
}

document.getElementById('saveDaysBtn').addEventListener('click', saveWarningDays);

// ===== SR-2: the check - find devices exactly on a warning day =====
function findDevicesToAlert() {
  return assets.filter(asset => {
    const days = getDaysRemaining(asset.warrantyDate);
    return days !== null && warningDays.includes(days);
  });
}

// ===== SR-3: show an alert for each device found =====
function renderAlerts() {
  const list = document.getElementById('alertList');
  list.innerHTML = '';

  const devices = findDevicesToAlert();

  if (devices.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'No warranty alerts today.';
    list.appendChild(item);
    return;
  }

  devices.forEach(asset => {
    const days = getDaysRemaining(asset.warrantyDate);
    const item = document.createElement('li');
    item.textContent = `${asset.deviceType} (${asset.tagId}): warranty ends ${asset.warrantyDate}, ${days} day(s) left.`;
    list.appendChild(item);
  });
}

renderAlerts();

// ===== PDF report: fill the device type filter from the real assets =====
function fillDeviceTypeFilter() {
  const select = document.getElementById('filterType');
  // Collect each device type once: ["Laptop", "Microphone", "Projector"]
  const types = [...new Set(assets.map(asset => asset.deviceType))].sort();

  types.forEach(type => {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    select.appendChild(option);
  });
}

fillDeviceTypeFilter();

// ===== PDF report: keep only the assets that match the chosen filters =====
function getFilteredAssets(condition, type, from, to) {
  return assets.filter(asset => {
    if (condition && asset.condition !== condition) return false;
    if (type && asset.deviceType !== type) return false;
    if (from || to) {
      if (!asset.warrantyDate) return false; // no date can't fall inside a date range
      if (from && asset.warrantyDate < from) return false;
      if (to && asset.warrantyDate > to) return false;
    }
    return true;
  });
}

// ===== PDF report: build the file and download it =====
function downloadPdfReport() {
  const reportMessage = document.getElementById('reportMessage');
  const condition = document.getElementById('filterCondition').value;
  const type = document.getElementById('filterType').value;
  const from = document.getElementById('filterFrom').value;
  const to = document.getElementById('filterTo').value;

  if (from && to && from > to) {
    reportMessage.textContent = 'Error: the "from" date must be before the "to" date.';
    return;
  }

  const filtered = getFilteredAssets(condition, type, from, to);

  if (filtered.length === 0) {
    reportMessage.textContent = 'No assets match these filters, so no report was created.';
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text('WJC IT Asset Summary Report', 14, 15);
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleDateString()}    Assets listed: ${filtered.length}`, 14, 22);

  const rows = filtered.map(asset => [
    asset.tagId,
    asset.deviceType,
    asset.serialNumber,
    asset.condition,
    asset.warrantyDate || 'Not recorded',
    getStatus(getDaysRemaining(asset.warrantyDate))
  ]);

  doc.autoTable({
    head: [['Tag ID', 'Device Type', 'Serial Number', 'Condition', 'Warranty End Date', 'Status']],
    body: rows,
    startY: 28
  });

  doc.save('warranty-report.pdf');
  reportMessage.textContent = `Report downloaded with ${filtered.length} asset(s).`;
}

document.getElementById('downloadPdfBtn').addEventListener('click', downloadPdfReport);

// ===== SR-4: email the MITS department through the server =====
function todayString() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`; // YYYY-MM-DD, local time
}

async function sendWarrantyEmail() {
  const emailStatus = document.getElementById('emailStatus');

  // Only send the details the email needs (data minimisation)
  const devices = findDevicesToAlert().map(asset => ({
    tagId: asset.tagId,
    deviceType: asset.deviceType,
    warrantyDate: asset.warrantyDate
  }));

  if (devices.length === 0) {
    emailStatus.textContent = 'No email sent: no devices reached a warning day.'; // TS-8
    return;
  }

  emailStatus.textContent = 'Sending email to MITS...';

  try {
    const response = await fetch('/api/warranty-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devices })
    });
    const result = await response.json();

    if (!response.ok) {
      emailStatus.textContent = 'Email could not be sent: ' + result.error;
      return;
    }

    localStorage.setItem('lastWarrantyEmail', todayString());
    emailStatus.textContent = 'Email sent to MITS. ';
    if (!result.previewUrl) return;
    const link = document.createElement('a');
    link.href = result.previewUrl;
    link.target = '_blank';
    link.textContent = 'View the email';
    emailStatus.appendChild(link);
  } catch (error) {
    emailStatus.textContent = 'Email could not be sent: the server is not running.';
  }
}

// Send automatically, once per day, only when there are alerts
if (findDevicesToAlert().length > 0 && localStorage.getItem('lastWarrantyEmail') !== todayString()) {
  sendWarrantyEmail();
}

document.getElementById('sendEmailBtn').addEventListener('click', sendWarrantyEmail);