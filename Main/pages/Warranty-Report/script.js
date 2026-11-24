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