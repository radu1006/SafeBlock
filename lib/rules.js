"use strict";

// SafeBlock - declarativeNetRequest ruleset control.
//
// Two static rulesets are declared in the manifest:
//   `ads_trackers` (rules/ads_trackers.json)  - enabled by default
//   `adult_filter` (rules/adult_filter.json)  - disabled by default (opt-in)
//
// This file keeps their runtime state in sync with the shared settings:
//   settings.adBlocking  -> ads_trackers  (default true)
//   settings.adultFilter -> adult_filter  (default false)
//
// A static ruleset can only be toggled through `updateEnabledRulesets` - there
// is no background page to do it for us, so the popup/options pages call into
// here. Both rulesets are updated in a single call so the two toggles can never
// leave the browser in a half-applied state.
//
// Usage:
//   applyRuleState(settings)          // settings -> both rulesets
//   applyRuleState({ adBlocking: false, adultFilter: true });
//
// Returns a promise that resolves to true when the request reached the
// declarativeNetRequest API and false when the API is unavailable or rejected
// the update (for example an older browser without static ruleset control).
// It never throws and never logs, so the UI stays usable either way.

const ADS_RULESET_ID = "ads_trackers";
const ADULT_RULESET_ID = "adult_filter";

function updateRuleset(dnr, update) {
  var pending = null;
  try {
    pending = dnr.updateEnabledRulesets(update);
  } catch (error) {
    return Promise.resolve(false);
  }
  if (pending && typeof pending.then === "function") {
    return pending.then(function () {
      return true;
    }, function () {
      return false;
    });
  }
  return Promise.resolve(true);
}

function applyRuleState(settings) {
  // `adBlocking` defaults to true (see DEFAULT_SETTINGS) and the ads ruleset
  // ships enabled, so only an explicit false turns blocking off.
  // `adultFilter` defaults to false and its ruleset ships disabled, so only an
  // explicit true opts in.
  var adsEnabled = !(settings && settings.adBlocking === false);
  var adultEnabled = !!(settings && settings.adultFilter === true);

  var dnr = typeof browser !== "undefined" && browser
    ? browser.declarativeNetRequest
    : null;

  if (!dnr || typeof dnr.updateEnabledRulesets !== "function") {
    return Promise.resolve(false);
  }

  // Update both rulesets in one call: enable the opted-in ones, disable the
  // rest. An id only ever appears in one of the two lists.
  var enableRulesetIds = [];
  var disableRulesetIds = [];
  (adsEnabled ? enableRulesetIds : disableRulesetIds).push(ADS_RULESET_ID);
  (adultEnabled ? enableRulesetIds : disableRulesetIds).push(ADULT_RULESET_ID);

  return updateRuleset(dnr, {
    enableRulesetIds: enableRulesetIds,
    disableRulesetIds: disableRulesetIds
  });
}
