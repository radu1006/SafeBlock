"use strict";

// This file can be evaluated more than once in the same isolated world, so
// everything stays inside an IIFE and the API is published only when it is
// still missing. A second evaluation is then a no-op instead of a redeclaration
// SyntaxError.

(function () {
  const DEFAULT_SETTINGS = {
    adBlocking: true,
    adultFilter: false
  };

  function getSettings() {
    return browser.storage.local.get(DEFAULT_SETTINGS).then((stored) => {
      return Object.assign({}, DEFAULT_SETTINGS, stored);
    });
  }

  function setSettings(settings) {
    return browser.storage.local.set(settings);
  }

  const globalScope = typeof globalThis !== "undefined" ? globalThis : window;
  if (typeof globalScope.getSettings !== "function") {
    globalScope.getSettings = getSettings;
  }
  if (typeof globalScope.setSettings !== "function") {
    globalScope.setSettings = setSettings;
  }
})();
