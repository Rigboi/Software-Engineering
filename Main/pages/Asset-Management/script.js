// Array to store assets in memory (for a real app, this would connect to a database)
let assets = [];

// DOM Elements
const assetForm = document.getElementById('assetForm');
const inventoryList = document.getElementById('inventoryList');
const searchInput = document.getElementById('searchInput');
const messageBox = document.getElementById('messageBox');
const noResults = document.getElementById('noResults');
const formTitle = document.getElementById('formTitle');
const submitBtn = document.getElementById('submitBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');

// Event Listeners
assetForm.addEventListener('submit', handleFormSubmit);
searchInput.addEventListener('input', filterInventory);

// Function to show messages
function showMessage(text, type) {
    messageBox.textContent = text;
    messageBox.className = type; // 'error' or 'success'
    setTimeout(() => {
        messageBox.className = 'hidden';
    }, 4000);
}

// Handle Form Submission (Create or Update)
function handleFormSubmit(e) {
    e.preventDefault();

    // Get values
    const tagId = document.getElementById('tagId').value.trim();
    const serialNumber = document.getElementById('serialNumber').value.trim();
    const deviceType = document.getElementById('deviceType').value.trim();
    const purchaseDate = document.getElementById('purchaseDate').value;
    const condition = document.getElementById('condition').value;
    const location = document.getElementById('location').value.trim();
    const warrantyDate = document.getElementById('warrantyDate').value;
    const editIndex = document.getElementById('editIndex').value;

    // AC-4 & Scenario 4: Validate required fields
    if (!tagId || !serialNumber || !deviceType || !purchaseDate || !condition || !location) {
        showMessage("Error: All required fields (*) must be filled out.", "error");
        return;
    }

    // Check for duplicates (AC-2, Scenario 2 & 3)
    const isDuplicateTag = assets.some((asset, index) => asset.tagId === tagId && index.toString() !== editIndex);
    const isDuplicateSerial = assets.some((asset, index) => asset.serialNumber === serialNumber && index.toString() !== editIndex);

    if (isDuplicateTag) {
        showMessage("Error: Tag ID already exists. Please use a unique Tag ID.", "error");
        return;
    }
    if (isDuplicateSerial) {
        showMessage("Error: Serial Number already exists. Please use a unique Serial Number.", "error");
        return;
    }

    const assetData = { tagId, serialNumber, deviceType, purchaseDate, condition, location, warrantyDate };

    if (editIndex === "-1") {
        // Create new (Scenario 1)
        assets.push(assetData);
        showMessage("Asset record created successfully!", "success");
    } else {
        // Update existing (Scenario 7)
        assets[editIndex] = assetData;
        showMessage("Asset details updated successfully!", "success");
    }

    resetForm();
    renderInventory();
}

// Render the inventory table
function renderInventory(filterText = "") {
    inventoryList.innerHTML = "";
    
    // AC-3: Filter inventory (Scenario 5 & 6)
    const filteredAssets = assets.filter(asset => 
        asset.tagId.toLowerCase().includes(filterText.toLowerCase()) || 
        asset.deviceType.toLowerCase().includes(filterText.toLowerCase())
    );

    if (filteredAssets.length === 0) {
        noResults.classList.remove('hidden');
    } else {
        noResults.classList.add('hidden');
    }

    // We need to find the original index for editing purposes
    filteredAssets.forEach((asset) => {
        const originalIndex = assets.findIndex(a => a.tagId === asset.tagId);

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${asset.tagId}</td>
            <td>${asset.serialNumber}</td>
            <td>${asset.deviceType}</td>
            <td>${asset.location}</td>
            <td>${asset.condition}</td>
            <td>
                <button onclick="editAsset(${originalIndex})" style="padding: 5px 10px; font-size: 12px;">Edit</button>
            </td>
        `;
        inventoryList.appendChild(row);
    });
}

// Filter function
function filterInventory() {
    renderInventory(searchInput.value);
}

// Function to populate form for editing (AC-4, Scenario 7)
function editAsset(index) {
    const asset = assets[index];
    
    document.getElementById('tagId').value = asset.tagId;
    document.getElementById('serialNumber').value = asset.serialNumber;
    document.getElementById('deviceType').value = asset.deviceType;
    document.getElementById('purchaseDate').value = asset.purchaseDate;
    document.getElementById('condition').value = asset.condition;
    document.getElementById('location').value = asset.location;
    document.getElementById('warrantyDate').value = asset.warrantyDate;
    
    document.getElementById('editIndex').value = index;
    
    formTitle.textContent = "Edit Asset";
    submitBtn.textContent = "Update Asset";
    cancelEditBtn.classList.remove('hidden');
    
    // Scroll to top to see the form
    window.scrollTo(0, 0);
}

// Reset form to default state
function resetForm() {
    assetForm.reset();
    document.getElementById('editIndex').value = "-1";
    formTitle.textContent = "Create New Asset";
    submitBtn.textContent = "Save Asset";
    cancelEditBtn.classList.add('hidden');
}

// Initial render
renderInventory();