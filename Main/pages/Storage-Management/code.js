
// -----------------------------------------
// DEMO DATA
// -----------------------------------------

// Sample assets for testing.
// These will eventually come from the shared database.

const assets = [
    {
        id: "WJC-001",
        description: "Dell Latitude Laptop",
        location: "IT Storage Room"
    },
    {
        id: "WJC-002",
        description: "HP LaserJet Printer",
        location: "Main Office"
    },
    {
        id: "WJC-003",
        description: "Cisco Network Switch",
        location: "Server Room"
    },
    {
        id: "WJC-004",
        description: "Samsung Monitor",
        location: "IT Storage Room"
    }
];

// Registered storage locations.
const locations = [
    "IT Storage Room",
    "Main Office",
    "Server Room",
    "Computer Lab",
    "Equipment Cabinet"
];

// Stores successful relocation records.
const relocationHistory = [];


// -----------------------------------------
// HTML ELEMENTS
// -----------------------------------------

const assetSelect = document.getElementById("asset-select");
const currentLocation = document.getElementById("current-location");
const destinationSelect = document.getElementById("destination");
const staffInput = document.getElementById("staff-member");
const relocationForm = document.getElementById("relocation-form");
const relocationMessage = document.getElementById("relocation-message");

const locationSearch = document.getElementById("location-search");
const searchButton = document.getElementById("search-button");
const assetResults = document.getElementById("asset-results");

const historyAsset = document.getElementById("history-asset");
const historyResults = document.getElementById("history-results");


// -----------------------------------------
// HELPER FUNCTION: ADD DROPDOWN OPTIONS
// -----------------------------------------

function addOption(selectElement, value, text) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    selectElement.appendChild(option);
}


// -----------------------------------------
// LOAD ASSETS AND LOCATIONS
// -----------------------------------------

function loadDropdowns() {
    assets.forEach(asset => {
        addOption(
            assetSelect,
            asset.id,
            `${asset.id} - ${asset.description}`
        );

        addOption(
            historyAsset,
            asset.id,
            `${asset.id} - ${asset.description}`
        );
    });

    locations.forEach(location => {
        addOption(destinationSelect, location, location);
        addOption(locationSearch, location, location);
    });
}


// -----------------------------------------
// DISPLAY CURRENT LOCATION
// -----------------------------------------

assetSelect.addEventListener("change", function () {
    const selectedAsset = assets.find(
        asset => asset.id === assetSelect.value
    );

    currentLocation.value = selectedAsset
        ? selectedAsset.location
        : "";

    relocationMessage.textContent = "";
});


// -----------------------------------------
// RELOCATE AN ASSET
// -----------------------------------------

relocationForm.addEventListener("submit", function (event) {
    event.preventDefault();

    const selectedAsset = assets.find(
        asset => asset.id === assetSelect.value
    );

    const newLocation = destinationSelect.value;
    const staffMember = staffInput.value.trim();

    // Check that an existing asset was selected.
    if (!selectedAsset) {
        showMessage("Please select a valid asset.", false);
        return;
    }

    // Check that the destination is registered.
    if (!locations.includes(newLocation)) {
        showMessage("Please select a valid storage location.", false);
        return;
    }

    // Check that a staff member was entered.
    if (!staffMember) {
        showMessage("Please enter the responsible staff member.", false);
        return;
    }

    // Prevent moving an asset to its existing location.
    if (selectedAsset.location === newLocation) {
        showMessage(
            "The asset is already stored at this location.",
            false
        );
        return;
    }

    // Record the previous location before updating it.
    const previousLocation = selectedAsset.location;

    // Create the relocation record.
    const relocationRecord = {
        assetId: selectedAsset.id,
        previousLocation: previousLocation,
        newLocation: newLocation,
        relocationDate: new Date().toLocaleDateString(),
        staffMember: staffMember
    };

    // Update the asset's current location.
    selectedAsset.location = newLocation;

    // Save the successful relocation in the history.
    relocationHistory.push(relocationRecord);

    // Update the page.
    currentLocation.value = newLocation;

    showMessage("Asset relocated successfully!", true);

    // Refresh displayed information.
    searchAssets();
    displayHistory();

    // Clear the form fields.
    destinationSelect.value = "";
    staffInput.value = "";
});


// -----------------------------------------
// DISPLAY SUCCESS OR ERROR MESSAGE
// -----------------------------------------

function showMessage(message, success) {
    relocationMessage.textContent = message;
    relocationMessage.style.color = success ? "green" : "red";
}


// -----------------------------------------
// SEARCH ASSETS BY LOCATION
// -----------------------------------------

function searchAssets() {
    const selectedLocation = locationSearch.value;

    assetResults.replaceChildren();

    if (!selectedLocation) {
        addTableMessage(
            assetResults,
            "Select a location to view its assets.",
            3
        );
        return;
    }

    const matchingAssets = assets.filter(
        asset => asset.location === selectedLocation
    );

    if (matchingAssets.length === 0) {
        addTableMessage(
            assetResults,
            "No assets are currently recorded at this location.",
            3
        );
        return;
    }

    matchingAssets.forEach(asset => {
        const row = document.createElement("tr");

        addTableCell(row, asset.id);
        addTableCell(row, asset.description);
        addTableCell(row, asset.location);

        assetResults.appendChild(row);
    });
}


// -----------------------------------------
// VIEW RELOCATION HISTORY
// -----------------------------------------

function displayHistory() {
    const selectedAssetId = historyAsset.value;

    historyResults.replaceChildren();

    if (!selectedAssetId) {
        addTableMessage(
            historyResults,
            "Select an asset to view its relocation history.",
            4
        );
        return;
    }

    const selectedAsset = assets.find(
        asset => asset.id === selectedAssetId
    );

    const assetHistory = relocationHistory.filter(
        record => record.assetId === selectedAssetId
    );

    if (assetHistory.length === 0) {
        addTableMessage(
            historyResults,
            `No previous relocations recorded. Current location: ${selectedAsset.location}`,
            4
        );
        return;
    }

    assetHistory.forEach(record => {
        const row = document.createElement("tr");

        addTableCell(row, record.previousLocation);
        addTableCell(row, record.newLocation);
        addTableCell(row, record.relocationDate);
        addTableCell(row, record.staffMember);

        historyResults.appendChild(row);
    });
}


// -----------------------------------------
// TABLE HELPER FUNCTIONS
// -----------------------------------------

function addTableCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.appendChild(cell);
}

function addTableMessage(tableBody, message, columnCount) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = columnCount;
    cell.textContent = message;

    row.appendChild(cell);
    tableBody.appendChild(row);
}


// -----------------------------------------
// EVENT LISTENERS
// -----------------------------------------

searchButton.addEventListener("click", searchAssets);

locationSearch.addEventListener("change", searchAssets);

historyAsset.addEventListener("change", displayHistory);


// -----------------------------------------
// INITIALIZE THE PAGE
// -----------------------------------------

loadDropdowns();
