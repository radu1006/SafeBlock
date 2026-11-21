"use strict";

const adBlockingCheckbox = document.getElementById("adBlocking");
const adultFilterCheckbox = document.getElementById("adultFilter");

const ADULT_CONFIRM_MESSAGE =
  "Enable the adult content filter? Known adult domains will be blocked in " +
  "this browser. You can turn it off again at any time.";

function loadSettings() {
  getSettings().then((settings) => {
    adBlockingCheckbox.checked = settings.adBlocking;
    adultFilterCheckbox.checked = settings.adultFilter === true;
    applyRuleState(settings);
  });
}

function saveSettings() {
  const settings = {
    adBlocking: adBlockingCheckbox.checked,
    adultFilter: adultFilterCheckbox.checked
  };
  setSettings(settings);
  applyRuleState(settings);
}

// The adult filter is opt-in: turning it ON requires explicit confirmation.
// Cancelling reverts the checkbox so the stored state and the UI agree.
function onAdultFilterChange() {
  if (adultFilterCheckbox.checked && !confirm(ADULT_CONFIRM_MESSAGE)) {
    adultFilterCheckbox.checked = false;
    return;
  }
  saveSettings();
}

adBlockingCheckbox.addEventListener("change", saveSettings);
adultFilterCheckbox.addEventListener("change", onAdultFilterChange);

loadSettings();
