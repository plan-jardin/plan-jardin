import "./style.css";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { SPECIES } from "./crop-catalog.js";
import { connectAppData } from "./google-drive-appdata/src/index.js";
import { createWeatherGetter } from "./weather.js";
import { accumulatedGddAtDates, expectedHarvestDate } from "./gdd.js";

const GOOGLE_CLIENT_ID = "38344262241-jj9iqenmee3fe5s9qcncucu1baut9grb.apps.googleusercontent.com";
const appBasePath = new URL(import.meta.env.BASE_URL, window.location.origin).pathname;
const plannerPath = `${appBasePath}planner/`;
const homeView = document.querySelector("#home-view");
const plannerView = document.querySelector("#planner-view");
const loginButton = document.querySelector("#login-button");
const loginStatus = document.querySelector("#login-status");
const signOutButton = document.querySelector("#sign-out-button");
const syncStatus = document.querySelector("#sync-status");
const settingsMenu = document.querySelector("#settings-menu");
const resetDataButton = document.querySelector("#reset-data-button");
const selectedLocationLabel = document.querySelector("#selected-location");
const selectLocationButton = document.querySelector("#select-location-button");
const addCropButton = document.querySelector("#add-crop-button");
const cropList = document.querySelector("#crop-list");
const cropEmpty = document.querySelector("#crop-empty");
const previousCropList = document.querySelector("#previous-crop-list");
const previousCropEmpty = document.querySelector("#previous-crop-empty");
const cropDialog = document.querySelector("#crop-dialog");
const cropForm = document.querySelector("#crop-form");
const cropIdInput = document.querySelector("#crop-id");
const dialogTitle = document.querySelector("#crop-dialog-title");
const speciesSelect = document.querySelector("#species-select");
const speciesInfo = document.querySelector("#species-info");
const cultivarSelect = document.querySelector("#cultivar-select");
const cultivarInfo = document.querySelector("#cultivar-info");
const plantingDateInput = document.querySelector("#planting-date");
const plantCountInput = document.querySelector("#plant-count");
const closeDialogButton = document.querySelector("#close-dialog-button");
const cancelDialogButton = document.querySelector("#cancel-dialog-button");
const harvestDialog = document.querySelector("#harvest-dialog");
const harvestForm = document.querySelector("#harvest-form");
const harvestCropIdInput = document.querySelector("#harvest-crop-id");
const harvestIdInput = document.querySelector("#harvest-id");
const harvestDateInput = document.querySelector("#harvest-date");
const harvestGramsInput = document.querySelector("#harvest-grams");
const harvestDialogTitle = document.querySelector("#harvest-dialog-title");
const saveHarvestButton = document.querySelector("#save-harvest-button");
const closeHarvestDialogButton = document.querySelector("#close-harvest-dialog");
const cancelHarvestDialogButton = document.querySelector("#cancel-harvest-dialog");
const deleteConfirmationDialog = document.querySelector("#delete-confirmation-dialog");
const deleteConfirmationTitle = document.querySelector("#delete-confirmation-title");
const deleteConfirmationMessage = document.querySelector("#delete-confirmation-message");
const confirmDeleteButton = document.querySelector("#confirm-delete-button");
const closeDeleteConfirmationButton = document.querySelector("#close-delete-confirmation");
const cancelDeleteConfirmationButton = document.querySelector("#cancel-delete-confirmation");
const locationDialog = document.querySelector("#location-dialog");
const locationSearchForm = document.querySelector("#location-search-form");
const locationSearchInput = document.querySelector("#location-search-input");
const locationSearchStatus = document.querySelector("#location-search-status");
const locationResults = document.querySelector("#location-results");
const locationMapElement = document.querySelector("#location-map");
const locationNameInput = document.querySelector("#location-name");
const locationCoordinates = document.querySelector("#location-coordinates");
const saveLocationButton = document.querySelector("#save-location-button");
const closeLocationDialogButton = document.querySelector("#close-location-dialog");
const cancelLocationDialogButton = document.querySelector("#cancel-location-dialog");

let appDataStore = null;
let pendingDelete = null;
let cropRenderVersion = 0;
let locationMap = null;
let locationMarker = null;
let pendingLocation = null;
let reverseLookupTimer = null;
let reverseLookupController = null;
let reverseLookupVersion = 0;
let lastReverseLookupAt = 0;
let locationNameEdited = false;
const cropForecasts = new Map();
const cropHarvestMaturities = new Map();
const weatherGetters = new Map();

for (const species of SPECIES) {
  const option = document.createElement("option");
  option.value = species.id;
  option.textContent = species.name;
  speciesSelect.append(option);
}

updateSpeciesDetails();

loginButton.addEventListener("click", async () => {
  if (appDataStore) {
    navigateToPlanner();
    return;
  }

  loginButton.disabled = true;
  loginButton.textContent = "Connecting...";
  loginStatus.textContent = "Connecting to Google Drive...";

  try {
    appDataStore = await connectAppData({
      clientId: GOOGLE_CLIENT_ID,
      defaults: { crops: [] },
    });
    migrateLegacyHarvestUnits(appDataStore);
    appDataStore.addEventListener("saved", () => {
      syncStatus.textContent = "All changes saved";
    });
    appDataStore.addEventListener("error", () => {
      syncStatus.textContent = "Could not save changes. Check your connection.";
    });
    loginButton.textContent = "Open planner";
    navigateToPlanner();
  } catch (error) {
    console.error("Google Drive sign-in failed:", error);
    appDataStore = null;
    loginButton.disabled = false;
    loginButton.textContent = "Log in with Google";
    loginStatus.textContent = "Sign-in failed. Please try again.";
  }
});

signOutButton.addEventListener("click", async () => {
  if (!appDataStore) return;

  signOutButton.disabled = true;
  syncStatus.textContent = "Signing out...";

  try {
    await appDataStore.signOut();
  } catch (error) {
    console.error("Google Drive sign-out failed:", error);
    syncStatus.textContent = "Could not sign out. Please try again.";
    signOutButton.disabled = false;
    return;
  }

  appDataStore = null;
  history.replaceState(null, "", appBasePath);
  showHome();
  loginButton.disabled = false;
  loginButton.textContent = "Log in with Google";
  loginStatus.textContent = "You are signed out.";
  signOutButton.disabled = false;
});

resetDataButton.addEventListener("click", () => {
  settingsMenu.open = false;
  openResetConfirmation();
});

addCropButton.addEventListener("click", () => openCropDialog());
selectLocationButton.addEventListener("click", () => openLocationDialog());
closeDialogButton.addEventListener("click", () => cropDialog.close());
cancelDialogButton.addEventListener("click", () => cropDialog.close());
closeHarvestDialogButton.addEventListener("click", () => harvestDialog.close());
cancelHarvestDialogButton.addEventListener("click", () => harvestDialog.close());
closeDeleteConfirmationButton.addEventListener("click", () => deleteConfirmationDialog.close());
cancelDeleteConfirmationButton.addEventListener("click", () => deleteConfirmationDialog.close());
confirmDeleteButton.addEventListener("click", confirmPendingDelete);
closeLocationDialogButton.addEventListener("click", () => locationDialog.close());
cancelLocationDialogButton.addEventListener("click", () => locationDialog.close());
speciesSelect.addEventListener("change", () => updateSpeciesDetails());
cultivarSelect.addEventListener("change", () => updateCultivarDetails());
locationNameInput.addEventListener("input", () => {
  locationNameEdited = true;
});

locationSearchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = locationSearchInput.value.trim();
  if (query.length < 2) {
    locationSearchStatus.textContent = "Enter at least two characters to search.";
    return;
  }

  locationSearchStatus.textContent = "Searching places...";
  locationResults.replaceChildren();

  try {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.search = new URLSearchParams({ name: query, count: "8", language: "en", format: "json" });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Place search failed (${response.status}).`);
    const data = await response.json();
    const results = data.results ?? [];

    if (results.length === 0) {
      locationSearchStatus.textContent = "No places found. Try another search.";
      return;
    }

    locationSearchStatus.textContent = `${results.length} places found. Select one or click the map.`;
    locationResults.replaceChildren(...results.map(createLocationResult));
  } catch (error) {
    console.error("Location search failed:", error);
    locationSearchStatus.textContent = "Place search failed. Try again or select a point on the map.";
  }
});

saveLocationButton.addEventListener("click", () => {
  if (!appDataStore || !pendingLocation) {
    locationSearchStatus.textContent = "Select a place or point on the map first.";
    return;
  }

  const name = locationNameInput.value.trim();
  if (!name) {
    locationNameInput.focus();
    locationSearchStatus.textContent = "Enter a name for this location.";
    return;
  }

  appDataStore.data.location = { ...pendingLocation, name };
  cropForecasts.clear();
  selectedLocationLabel.textContent = name;
  syncStatus.textContent = "Saving location to Google Drive...";
  locationDialog.close();
  renderCrops();
});

cropForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!appDataStore) return;

  const crop = {
    id: cropIdInput.value || crypto.randomUUID(),
    species: speciesSelect.value,
    cultivar: cultivarSelect.value,
    plantingDate: plantingDateInput.value,
    plants: Number(plantCountInput.value),
  };
  const crops = [...(appDataStore.data.crops ?? [])];
  const existingIndex = crops.findIndex(({ id }) => id === crop.id);

  if (existingIndex === -1) {
    crops.push({ ...crop, finishedAt: null, harvests: [] });
  } else {
    crops[existingIndex] = { ...crops[existingIndex], ...crop };
  }

  appDataStore.data.crops = crops;
  syncStatus.textContent = "Saving to Google Drive...";
  cropDialog.close();
  renderCrops();
});

harvestForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!appDataStore) return;

  const harvest = {
    id: harvestIdInput.value || crypto.randomUUID(),
    date: harvestDateInput.value,
    grams: Number(harvestGramsInput.value),
  };
  appDataStore.data.crops = appDataStore.data.crops.map((crop) =>
    {
      if (crop.id !== harvestCropIdInput.value) return crop;
      const harvests = [...(crop.harvests ?? [])];
      const existingIndex = harvests.findIndex(({ id }) => id === harvest.id);
      if (existingIndex === -1) harvests.push(harvest);
      else harvests[existingIndex] = harvest;
      return { ...crop, harvests };
    },
  );
  syncStatus.textContent = "Saving harvest to Google Drive...";
  harvestDialog.close();
  renderCrops();
});

function handleCropListClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button || !appDataStore) return;

  const crop = appDataStore.data.crops?.find(({ id }) => id === button.dataset.id);
  if (!crop) return;

  if (button.dataset.action === "record-harvest") {
    openHarvestDialog(crop);
    return;
  }

  if (button.dataset.action === "edit-harvest") {
    const harvest = crop.harvests?.find(({ id }) => id === button.dataset.harvestId);
    if (harvest) openHarvestDialog(crop, harvest);
    return;
  }

  if (button.dataset.action === "delete-harvest") {
    const harvest = crop.harvests?.find(({ id }) => id === button.dataset.harvestId);
    if (harvest) openDeleteConfirmation(crop, harvest);
    return;
  }

  if (button.dataset.action === "edit") {
    openCropDialog(crop);
    return;
  }

  if (button.dataset.action === "finish") {
    setCropFinished(crop, true);
    return;
  }

  if (button.dataset.action === "reopen") {
    setCropFinished(crop, false);
    return;
  }

  if (button.dataset.action === "delete") openDeleteConfirmation(crop);
}

cropList.addEventListener("click", handleCropListClick);
previousCropList.addEventListener("click", handleCropListClick);

window.addEventListener("popstate", () => {
  if (window.location.pathname === plannerPath && appDataStore) {
    showPlanner();
  } else {
    showHome();
  }
});

function navigateToPlanner() {
  history.pushState(null, "", plannerPath);
  showPlanner();
}

function showHome() {
  plannerView.hidden = true;
  homeView.hidden = false;
}

function showPlanner() {
  if (!appDataStore) {
    history.replaceState(null, "", appBasePath);
    showHome();
    return;
  }

  homeView.hidden = true;
  plannerView.hidden = false;
  renderCrops();
}

function openCropDialog(crop = null) {
  cropForm.reset();
  cropIdInput.value = crop?.id ?? "";
  dialogTitle.textContent = crop ? "Edit crop" : "Add a crop";
  speciesSelect.value = crop?.species ?? SPECIES[0].id;
  updateSpeciesDetails(crop?.cultivar);
  plantingDateInput.value = crop?.plantingDate ?? todayAsInputValue();
  plantCountInput.value = String(crop?.plants ?? 1);
  cropDialog.showModal();
}

function openHarvestDialog(crop, harvest = null) {
  harvestForm.reset();
  harvestCropIdInput.value = crop.id;
  harvestIdInput.value = harvest?.id ?? "";
  harvestDateInput.value = harvest?.date ?? todayAsInputValue();
  harvestGramsInput.value = harvest ? String(harvest.grams) : "";
  harvestDialogTitle.textContent = harvest ? "Edit harvest" : "Record harvest";
  saveHarvestButton.textContent = harvest ? "Save changes" : "Save harvest";
  harvestDialog.showModal();
}

function openDeleteConfirmation(crop, harvest = null) {
  const species = SPECIES.find(({ id }) => id === crop.species);
  const cultivar = species?.cultivars.find(({ id }) => id === crop.cultivar);
  const cropName = `${cultivar?.name ?? crop.cultivar} ${species?.name ?? crop.species}`;

  pendingDelete = { cropId: crop.id, harvestId: harvest?.id ?? null };
  cancelDeleteConfirmationButton.textContent = "Keep record";
  confirmDeleteButton.disabled = false;
  confirmDeleteButton.textContent = "Delete";
  deleteConfirmationTitle.textContent = harvest ? "Delete harvest?" : "Delete crop?";
  deleteConfirmationMessage.textContent = harvest
    ? `Delete the ${formatGrams(harvest.grams)} g harvest recorded on ${formatDate(harvest.date)} for ${cropName}?`
    : `Delete ${cropName} and all of its harvest records? This cannot be undone.`;
  deleteConfirmationDialog.showModal();
}

function openResetConfirmation() {
  pendingDelete = { type: "reset" };
  confirmDeleteButton.disabled = false;
  deleteConfirmationTitle.textContent = "Reset all plan data?";
  deleteConfirmationMessage.textContent = "This clears all crops, harvest records, and your saved location from Google Drive. Your Google account stays connected. This cannot be undone.";
  cancelDeleteConfirmationButton.textContent = "Keep my data";
  confirmDeleteButton.textContent = "Reset data";
  deleteConfirmationDialog.showModal();
}

async function confirmPendingDelete() {
  if (!appDataStore || !pendingDelete) return;

  if (pendingDelete.type === "reset") {
    confirmDeleteButton.disabled = true;
    confirmDeleteButton.textContent = "Resetting...";
    syncStatus.textContent = "Resetting data in Google Drive...";

    try {
      for (const key of Object.keys(appDataStore.data)) {
        delete appDataStore.data[key];
      }
      appDataStore.data.crops = [];
      await appDataStore.flush();
    } catch (error) {
      console.error("Plan reset failed:", error);
      syncStatus.textContent = "Could not reset data. Please try again.";
      confirmDeleteButton.disabled = false;
      confirmDeleteButton.textContent = "Reset data";
      return;
    }

    cropForecasts.clear();
    cropHarvestMaturities.clear();
    selectedLocationLabel.textContent = "No location selected";
    syncStatus.textContent = "Plan reset. Start fresh whenever you’re ready.";
    pendingDelete = null;
    deleteConfirmationDialog.close();
    cancelDeleteConfirmationButton.textContent = "Keep record";
    confirmDeleteButton.disabled = false;
    confirmDeleteButton.textContent = "Delete";
    renderCrops();
    return;
  }

  const { cropId, harvestId } = pendingDelete;
  if (harvestId) {
    appDataStore.data.crops = appDataStore.data.crops.map((crop) =>
      crop.id === cropId
        ? { ...crop, harvests: (crop.harvests ?? []).filter(({ id }) => id !== harvestId) }
        : crop,
    );
    syncStatus.textContent = "Saving harvest to Google Drive...";
  } else {
    appDataStore.data.crops = appDataStore.data.crops.filter(({ id }) => id !== cropId);
    syncStatus.textContent = "Saving to Google Drive...";
  }

  pendingDelete = null;
  deleteConfirmationDialog.close();
  cancelDeleteConfirmationButton.textContent = "Keep record";
  renderCrops();
}

function setCropFinished(crop, finished) {
  appDataStore.data.crops = appDataStore.data.crops.map((item) =>
    item.id === crop.id
      ? { ...item, finishedAt: finished ? todayAsInputValue() : null }
      : item,
  );
  syncStatus.textContent = "Saving to Google Drive...";
  renderCrops();
}

function updateSpeciesDetails(selectedCultivar = null) {
  const species = SPECIES.find(({ id }) => id === speciesSelect.value) ?? SPECIES[0];
  speciesInfo.textContent = `Growing range: base ${species.baseGdd} GDD, upper limit ${species.upperGdd} GDD.`;
  cultivarSelect.replaceChildren();

  for (const cultivar of species.cultivars) {
    const option = document.createElement("option");
    option.value = cultivar.id;
    option.textContent = cultivar.name;
    cultivarSelect.append(option);
  }

  cultivarSelect.value = selectedCultivar && species.cultivars.some(({ id }) => id === selectedCultivar)
    ? selectedCultivar
    : species.cultivars[0].id;
  updateCultivarDetails();
}

function updateCultivarDetails() {
  const species = SPECIES.find(({ id }) => id === speciesSelect.value) ?? SPECIES[0];
  const cultivar = species.cultivars.find(({ id }) => id === cultivarSelect.value);
  cultivarInfo.textContent = `Estimated GDD to harvest: ${cultivar.requiredGdd}.`;
}

async function renderCrops() {
  if (!appDataStore) return;

  const renderVersion = ++cropRenderVersion;
  const location = appDataStore.data.location;
  selectedLocationLabel.textContent = location?.name ?? "No location selected";
  const crops = Array.isArray(appDataStore.data.crops) ? appDataStore.data.crops : [];
  const activeCrops = crops.filter(({ finishedAt }) => !finishedAt);
  const previousCrops = crops.filter(({ finishedAt }) => Boolean(finishedAt));
  const rows = new Map(crops.map((crop) => {
    const row = createCropRow(crop);
    return [crop.id, row];
  }));
  cropList.replaceChildren(...activeCrops.map(({ id }) => rows.get(id)));
  previousCropList.replaceChildren(...previousCrops.map(({ id }) => rows.get(id)));
  cropEmpty.hidden = activeCrops.length > 0;
  previousCropEmpty.hidden = previousCrops.length > 0;

  await Promise.all(crops.map(async (crop) => {
    const row = rows.get(crop.id);
    const species = SPECIES.find(({ id }) => id === crop.species);
    const cultivar = species?.cultivars.find(({ id }) => id === crop.cultivar);

    if (!row) return;
    const calculations = [];

    if (!crop.finishedAt) {
      if (!species || !cultivar || !crop.plantingDate) {
        showForecastError(row);
      } else if (!location) {
        showLocationRequired(row);
      } else {
        calculations.push({
          type: "forecast",
          promise: getCropForecast(crop, species, cultivar, location),
        });
      }
    }

    if ((crop.harvests?.length ?? 0) > 0) {
      if (!species || !cultivar || !crop.plantingDate || !location) {
        showHarvestMaturityError(row);
      } else {
        calculations.push({
          type: "maturity",
          promise: getCropHarvestMaturities(crop, species, cultivar, location),
        });
      }
    }

    const results = await Promise.allSettled(calculations.map(({ promise }) => promise));
    if (renderVersion !== cropRenderVersion || !row.isConnected) return;

    results.forEach((result, index) => {
      const { type } = calculations[index];
      if (result.status === "rejected") {
        console.error(`${type} calculation failed for ${crop.id}:`, result.reason);
        if (type === "forecast") showForecastError(row);
        else showHarvestMaturityError(row);
        return;
      }

      if (type === "forecast") showForecast(row, result.value);
      else showHarvestMaturities(row, result.value);
    });
  }));
}

function createCropRow(crop) {
  const species = SPECIES.find(({ id }) => id === crop.species);
  const cultivar = species?.cultivars.find(({ id }) => id === crop.cultivar);
  const item = document.createElement("li");
  item.className = "crop-item";

  const details = document.createElement("div");
  details.className = "crop-details";

  const title = document.createElement("h3");
  title.textContent = `${cultivar?.name ?? crop.cultivar} ${species?.name ?? crop.species}`;

  const titleRow = document.createElement("div");
  titleRow.className = "crop-title-row";

  const plantCount = document.createElement("span");
  plantCount.className = "crop-plant-count";
  const plantTotal = Number(crop.plants ?? 1);
  plantCount.textContent = `${plantTotal} ${plantTotal === 1 ? "plant" : "plants"}`;

  const planting = document.createElement("span");
  planting.className = "crop-planting-date";
  planting.textContent = `Planted ${formatDate(crop.plantingDate)}`;
  titleRow.append(title, plantCount, planting);

  let forecast = null;
  let finishedInfo = null;

  if (crop.finishedAt) {
    finishedInfo = document.createElement("p");
    finishedInfo.className = "crop-finished-info";
    finishedInfo.textContent = `Finished ${formatDate(crop.finishedAt)}`;
  } else {
    const harvestDate = document.createElement("p");
    harvestDate.className = "crop-growing-info";
    harvestDate.textContent = "Calculating harvest date...";

    forecast = document.createElement("div");
    forecast.className = "crop-forecast";

    const progressRow = document.createElement("div");
    progressRow.className = "progress-row";

    const progressDescription = document.createElement("div");
    progressDescription.className = "progress-description";

    const progress = document.createElement("progress");
    progress.className = "crop-progress";
    progress.max = cultivar?.requiredGdd ?? 1;
    progress.value = 0;
    progress.setAttribute("aria-label", `Growing progress for ${title.textContent}`);

    const progressLabel = document.createElement("span");
    progressLabel.className = "progress-label";
    progressLabel.textContent = "Calculating...";

    progressDescription.append(harvestDate, progressLabel);
    progressRow.append(progress, progressDescription);
    forecast.append(progressRow);
  }

  const history = document.createElement("details");
  history.className = "crop-harvest-history";
  const historySummary = document.createElement("summary");
  const harvests = Array.isArray(crop.harvests) ? crop.harvests : [];
  historySummary.textContent = `Harvest history (${harvests.length})`;
  history.append(historySummary, createHarvestHistory(harvests, crop.id, Boolean(crop.finishedAt)));

  const actions = document.createElement("div");
  actions.className = "crop-actions";
  if (crop.finishedAt) {
    actions.append(createCropAction("Reopen", "reopen", crop.id));
  } else {
    actions.append(
      createCropAction("Record harvest", "record-harvest", crop.id),
      createCropAction("Edit", "edit", crop.id),
      createCropAction("Finish", "finish", crop.id),
      createCropAction("Delete", "delete", crop.id),
    );
  }
  titleRow.append(actions);

  details.append(titleRow);
  if (forecast) details.append(forecast);
  if (finishedInfo) details.append(finishedInfo);
  item.append(details, history);
  item.dataset.cropId = crop.id;
  return item;
}

function createHarvestHistory(harvests, cropId, readOnly = false) {
  const scrollContainer = document.createElement("div");
  scrollContainer.className = "harvest-table-scroll";

  const table = document.createElement("table");
  table.className = "harvest-record-table";

  const columns = document.createElement("colgroup");
  for (let index = 0; index < 4; index += 1) {
    const column = document.createElement("col");
    column.className = `harvest-column-${index + 1}`;
    columns.append(column);
  }
  table.append(columns);

  const sortedHarvests = [...harvests].sort((first, second) =>
    second.date.localeCompare(first.date),
  );
  table.classList.toggle("is-empty", sortedHarvests.length === 0);

  const body = document.createElement("tbody");
  if (sortedHarvests.length === 0) {
    const row = document.createElement("tr");
    const empty = document.createElement("td");
    empty.colSpan = 4;
    empty.className = "harvest-record-empty";
    empty.textContent = "No harvests recorded yet.";
    row.append(empty);
    body.append(row);
  } else {
    for (const harvest of sortedHarvests) {
      const row = document.createElement("tr");

      const date = document.createElement("td");
      date.textContent = formatDate(harvest.date);

      const amount = document.createElement("td");
      amount.className = "harvest-yield";
      amount.textContent = `${formatGrams(harvest.grams)} g`;

      const maturity = document.createElement("td");
      maturity.className = "harvest-maturity";
      maturity.dataset.harvestId = harvest.id;
      maturity.textContent = "Calculating maturity...";

      const actions = document.createElement("td");
      actions.className = "harvest-record-actions";
      if (!readOnly) {
        actions.append(
          createHarvestAction("Edit", "edit-harvest", cropId, harvest.id),
          createHarvestAction("Delete", "delete-harvest", cropId, harvest.id),
        );
      }

      row.append(date, amount, maturity, actions);
      body.append(row);
    }

    const totalYield = sortedHarvests.reduce((total, harvest) => total + Number(harvest.grams || 0), 0);
    const totalRow = document.createElement("tr");
    totalRow.className = "harvest-total-row";

    const totalLabel = document.createElement("th");
    totalLabel.scope = "row";
    totalLabel.textContent = "Total yield";

    const totalAmount = document.createElement("td");
    totalAmount.className = "harvest-yield";
    totalAmount.textContent = `${formatGrams(totalYield)} g`;

    totalRow.append(totalLabel, totalAmount, document.createElement("td"), document.createElement("td"));
    body.append(totalRow);
  }

  table.append(body);
  scrollContainer.append(table);
  return scrollContainer;
}

function createHarvestAction(label, action, cropId, harvestId) {
  const button = document.createElement("button");
  button.className = action === "delete-harvest" ? "crop-action delete-action" : "crop-action";
  button.type = "button";
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.id = cropId;
  button.dataset.harvestId = harvestId;
  return button;
}

function getCropForecast(crop, species, cultivar, location) {
  const key = `${crop.plantingDate}:${species.id}:${cultivar.id}:${location.latitude}:${location.longitude}`;
  const cached = cropForecasts.get(crop.id);
  if (cached?.key === key) return cached.promise;

  const promise = expectedHarvestDate(
    getWeatherGetter(location),
    new Date(`${crop.plantingDate}T00:00:00.000Z`),
    {
      baseTemperature: species.baseGdd,
      upperLimit: species.upperGdd,
      requiredGDD: cultivar.requiredGdd,
    },
  );

  cropForecasts.set(crop.id, { key, promise });
  return promise;
}

function getCropHarvestMaturities(crop, species, cultivar, location) {
  const harvests = Array.isArray(crop.harvests) ? crop.harvests : [];
  if (harvests.length === 0) return Promise.resolve(new Map());

  const key = JSON.stringify([
    crop.plantingDate,
    species.id,
    cultivar.id,
    location.latitude,
    location.longitude,
    harvests.map(({ id, date }) => [id, date]).sort(([firstId], [secondId]) => firstId.localeCompare(secondId)),
  ]);
  const cached = cropHarvestMaturities.get(crop.id);
  if (cached?.key === key) return cached.promise;

  const promise = accumulatedGddAtDates(
    getWeatherGetter(location),
    new Date(`${crop.plantingDate}T00:00:00.000Z`),
    harvests.map(({ date }) => date),
    {
      baseTemperature: species.baseGdd,
      upperLimit: species.upperGdd,
    },
  ).then((totals) => new Map(harvests.map((harvest) => [
    harvest.id,
    (totals.get(harvest.date) ?? 0) / cultivar.requiredGdd * 100,
  ])));

  cropHarvestMaturities.set(crop.id, { key, promise });
  return promise;
}

function showHarvestMaturities(row, maturities) {
  row.querySelectorAll(".harvest-maturity").forEach((label) => {
    const maturity = maturities.get(label.dataset.harvestId);
    label.textContent = Number.isFinite(maturity)
      ? `@ ${Math.round(maturity)}% maturity`
      : "@ Maturity unavailable";
  });
}

function showHarvestMaturityError(row) {
  row.querySelectorAll(".harvest-maturity").forEach((label) => {
    label.textContent = "@ Maturity unavailable";
  });
}

function getWeatherGetter(location) {
  const key = `${location.latitude}:${location.longitude}`;
  if (!weatherGetters.has(key)) {
    weatherGetters.set(key, createWeatherGetter({
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: "auto",
    }));
  }
  return weatherGetters.get(key);
}

function showForecast(row, forecast) {
  const accumulatedGDD = Math.max(0, forecast.accumulatedGDD);
  const progress = Math.min(forecast.requiredGDD, accumulatedGDD);
  const progressBar = row.querySelector(".crop-progress");
  progressBar.max = forecast.requiredGDD;
  progressBar.value = progress;
  const progressText = `${formatGdd(accumulatedGDD)} of ${formatGdd(forecast.requiredGDD)} growing degree days accumulated`;
  row.querySelector(".progress-label").textContent = progressText;
  progressBar.setAttribute("aria-valuetext", progressText);
  row.querySelector(".crop-growing-info").textContent =
    `Expected harvest ${formatDate(forecast.harvestDate)}`;
}

function showForecastError(row) {
  if (!row) return;
  row.querySelector(".crop-growing-info").textContent = "Harvest estimate unavailable";
  row.querySelector(".progress-label").textContent = "Weather data unavailable";
}

function showLocationRequired(row) {
  row.querySelector(".crop-growing-info").textContent = "Select a location for a harvest estimate.";
  row.querySelector(".crop-progress").value = 0;
  row.querySelector(".progress-label").textContent = "Location required";
}

function openLocationDialog() {
  if (!appDataStore) return;

  cancelReverseLookup();
  locationNameEdited = false;
  const savedLocation = appDataStore.data.location;
  pendingLocation = savedLocation ? { ...savedLocation } : null;
  locationNameInput.value = savedLocation?.name ?? "";
  locationSearchInput.value = "";
  locationSearchResultsReset();
  locationCoordinates.textContent = savedLocation
    ? formatCoordinates(savedLocation.latitude, savedLocation.longitude)
    : "Search for a place or select a point on the map.";
  locationDialog.showModal();

  requestAnimationFrame(() => {
    initializeLocationMap();
    locationMap.invalidateSize();
    if (savedLocation) {
      locationMap.setView([savedLocation.latitude, savedLocation.longitude], 10);
      updateLocationMarker(savedLocation.latitude, savedLocation.longitude);
    }
  });
}

function initializeLocationMap() {
  if (locationMap) return;

  locationMap = L.map(locationMapElement, {
    scrollWheelZoom: true,
    touchZoom: true,
  })
    .setView([46.6, 2.4], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  }).addTo(locationMap);
  locationMap.on("click", ({ latlng }) => {
    suggestLocationForCoordinates(latlng.lat, latlng.lng);
  });
}

function createLocationResult(result) {
  const parts = [result.name, result.admin1, result.country].filter(Boolean);
  const name = [...new Set(parts)].join(", ");
  const button = document.createElement("button");
  button.className = "location-result";
  button.type = "button";
  button.textContent = name;
  button.addEventListener("click", () => {
    cancelReverseLookup();
    locationNameEdited = false;
    pendingLocation = {
      name,
      latitude: result.latitude,
      longitude: result.longitude,
    };
    locationNameInput.value = name;
    locationCoordinates.textContent = formatCoordinates(result.latitude, result.longitude);
    locationMap.setView([result.latitude, result.longitude], 11);
    updateLocationMarker(result.latitude, result.longitude);
    locationSearchStatus.textContent = `${name} selected.`;
  });
  return button;
}

function updateLocationMarker(latitude, longitude) {
  if (locationMarker) locationMarker.remove();
  locationMarker = L.marker([latitude, longitude], {
    draggable: true,
    icon: L.divIcon({
      className: "location-marker",
      html: "<span></span>",
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    }),
  }).addTo(locationMap);
  locationMarker.on("dragend", ({ target }) => {
    const position = target.getLatLng();
    suggestLocationForCoordinates(position.lat, position.lng);
  });
}

function suggestLocationForCoordinates(latitude, longitude) {
  latitude = Number(latitude.toFixed(5));
  longitude = Number(longitude.toFixed(5));
  pendingLocation = { name: "", latitude, longitude };
  locationNameEdited = false;
  locationNameInput.value = "Finding place name...";
  locationCoordinates.textContent = formatCoordinates(latitude, longitude);
  locationSearchStatus.textContent = "Looking up the selected location...";
  updateLocationMarker(latitude, longitude);

  const version = ++reverseLookupVersion;
  clearTimeout(reverseLookupTimer);
  reverseLookupController?.abort();
  const wait = Math.max(1100 - (Date.now() - lastReverseLookupAt), 0);

  reverseLookupTimer = setTimeout(async () => {
    const controller = new AbortController();
    reverseLookupController = controller;
    lastReverseLookupAt = Date.now();

    try {
      const url = new URL("https://nominatim.openstreetmap.org/reverse");
      url.search = new URLSearchParams({
        format: "jsonv2",
        lat: String(latitude),
        lon: String(longitude),
        zoom: "10",
        addressdetails: "1",
      });
      const response = await fetch(url, {
        signal: controller.signal,
        referrerPolicy: "strict-origin-when-cross-origin",
      });
      if (!response.ok) throw new Error(`Reverse geocoding failed (${response.status}).`);
      const result = await response.json();
      if (version !== reverseLookupVersion) return;

      const address = result.address ?? {};
      const locality = address.city || address.town || address.village ||
        address.municipality || address.hamlet || address.suburb || address.county;
      const suggestion = [locality, address.state, address.country]
        .filter(Boolean)
        .filter((part, index, parts) => parts.indexOf(part) === index)
        .join(", ") || result.name || `Location ${formatCoordinates(latitude, longitude)}`;

      pendingLocation.name = suggestion;
      if (!locationNameEdited) locationNameInput.value = suggestion;
      locationSearchStatus.textContent = "Location name suggested from the map pin. You can edit it before saving.";
    } catch (error) {
      if (error.name === "AbortError" || version !== reverseLookupVersion) return;
      console.warn("Reverse geocoding failed:", error);
      const fallbackName = `Location ${formatCoordinates(latitude, longitude)}`;
      pendingLocation.name = fallbackName;
      if (!locationNameEdited) locationNameInput.value = fallbackName;
      locationSearchStatus.textContent = "Could not find a place name. You can enter one manually.";
    }
  }, wait);
}

function cancelReverseLookup() {
  reverseLookupVersion += 1;
  clearTimeout(reverseLookupTimer);
  reverseLookupController?.abort();
  reverseLookupController = null;
}

function locationSearchResultsReset() {
  locationSearchStatus.textContent = "Search for a place or click the map to choose coordinates.";
  locationResults.replaceChildren();
}

function formatCoordinates(latitude, longitude) {
  return `${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`;
}

function createCropAction(label, action, id) {
  const button = document.createElement("button");
  button.className = action === "delete" ? "crop-action delete-action" : "crop-action";
  button.type = "button";
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.id = id;
  return button;
}

function formatDate(value) {
  if (!value) return "date not set";
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function todayAsInputValue() {
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  return today.toISOString().slice(0, 10);
}

function formatGdd(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

function formatGrams(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function migrateLegacyHarvestUnits(store) {
  const crops = Array.isArray(store.data.crops) ? store.data.crops : [];
  let hasLegacyHarvests = false;

  const migratedCrops = crops.map((crop) => {
    if (!Array.isArray(crop.harvests)) return crop;

    let cropChanged = false;
    const harvests = crop.harvests.map((harvest) => {
      if (typeof harvest.grams === "number" && Number.isFinite(harvest.grams)) {
        if (!("kg" in harvest)) return harvest;
        const { kg, ...migratedHarvest } = harvest;
        cropChanged = true;
        return migratedHarvest;
      }

      const kilograms = Number(harvest.kg);
      if (!Number.isFinite(kilograms)) return harvest;

      const { kg, ...migratedHarvest } = harvest;
      cropChanged = true;
      return { ...migratedHarvest, grams: Math.round(kilograms * 1000) };
    });

    if (!cropChanged) return crop;
    hasLegacyHarvests = true;
    return { ...crop, harvests };
  });

  if (hasLegacyHarvests) store.data.crops = migratedCrops;
}