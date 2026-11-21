"use strict";

// Cross-browser compatibility shim for Manifest V3 extensions.
//
// Firefox exposes the promise-based `browser` namespace, while Chrome exposes
// `chrome`. This file guarantees a `browser` global in both browsers so the
// rest of the extension can use promise-based calls uniformly.

(function () {
  if (typeof browser !== "undefined") {
    return;
  }
  if (typeof chrome === "undefined") {
    return;
  }
  // Chrome's Manifest V3 storage APIs return promises, so aliasing is enough.
  window.browser = chrome;
})();
