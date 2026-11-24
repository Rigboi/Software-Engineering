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