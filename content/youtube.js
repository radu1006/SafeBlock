"use strict";

// SafeBlock - YouTube ad handling content script.
//
// Injected on YouTube pages only, and only while `adBlocking` is enabled in the
// shared settings. It dismisses skippable ads, fast-forwards in-stream ad
// videos where that is safe, and hides ad slots/overlays.
//
// The script is self-terminating: when `adBlocking` is switched off it clears
// its pending timer, disconnects its MutationObserver, removes its injected
// style and detaches its navigation listeners, so an idle page costs nothing.
// One passive storage listener stays registered so the script can start again
// if the user re-enables ad blocking.
//
// There is no polling. Work is driven by a single debounced MutationObserver
// and by YouTube's own `yt-navigate-finish` SPA event.

(function () {
  const SKIP_SELECTORS = [
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-skip-ad-button"
  ];
  const OVERLAY_CLOSE_SELECTORS = [".ytp-ad-overlay-close-button"];
  const AD_VIDEO_SELECTOR = ".ad-interrupting video, video.ad-showing";
  const HIDE_SELECTORS = [
    // Player-area ads.
    "#player-ads",
    ".ytp-ad-overlay-container",
    "ytd-display-ad-renderer",
    ".ytp-ad-module",
    // In-feed, promoted, shelf and masthead ads. These are first-party DOM, so
    // they can only be hidden here and not through the network rulesets.
    "ytd-ad-slot-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-promoted-video-renderer",
    "ytd-companion-slot-renderer",
    "ytd-banner-promo-renderer",
    "ytd-statement-banner-renderer",
    "ytd-brand-video-shelf-renderer",
    "#masthead-ad"
  ];
  const STYLE_ID = "safeblock-youtube-ads";
  const DEBOUNCE_MS = 250;
  const CLICK_COOLDOWN_MS = 1000;

  let running = false;
  let observer = null;
  let observedTarget = null;
  let debounceTimer = null;
  const clickedAt = typeof WeakMap === "function" ? new WeakMap() : null;

  // Run `fn` for every node matching `selector`, swallowing selector errors.
  function each(selector, fn) {
    if (!document || typeof document.querySelectorAll !== "function") {
      return;
    }
    let nodes = null;
    try {
      nodes = document.querySelectorAll(selector);
    } catch (error) {
      return;
    }
    if (!nodes) {
      return;
    }
    for (let index = 0; index < nodes.length; index += 1) {
      if (nodes[index]) {
        fn(nodes[index]);
      }
    }
  }

  // Rate-limit clicks per node: YouTube can render a skip button before it
  // becomes actionable, so a click must be retried, but never in a tight loop.
  function clickOnce(element) {
    if (!element || typeof element.click !== "function") {
      return;
    }
    const now = Date.now();
    if (clickedAt) {
      const last = clickedAt.get(element);
      if (typeof last === "number" && now - last < CLICK_COOLDOWN_MS) {
        return;
      }
      clickedAt.set(element, now);
    }
    try {
      element.click();
    } catch (error) {
      // Ignore a detached or otherwise unclickable button.
    }
  }

  function dismissAds() {
    SKIP_SELECTORS.forEach(function (selector) {
      each(selector, clickOnce);
    });
    OVERLAY_CLOSE_SELECTORS.forEach(function (selector) {
      each(selector, clickOnce);
    });
  }

  // Seeking an ad to its end is only safe once a finite duration is known.
  function fastForwardAdVideos() {
    each(AD_VIDEO_SELECTOR, function (video) {
      if (!video || typeof video.currentTime !== "number") {
        return;
      }
      const duration = video.duration;
      if (typeof duration !== "number" || !isFinite(duration) || duration <= 0) {
        return;
      }
      if (video.currentTime >= duration - 0.5) {
        return;
      }
      try {
        video.currentTime = Math.max(0, duration - 0.1);
      } catch (error) {
        // Ignore a video that is not seekable yet.
      }
    });
  }

  function injectStyle() {
    if (!document || typeof document.getElementById !== "function") {
      return;
    }
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const parent = document.head || document.documentElement;
    if (!parent || typeof document.createElement !== "function" ||
        typeof parent.appendChild !== "function") {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = HIDE_SELECTORS.map(function (selector) {
      return selector + " { display: none !important; }";
    }).join("\n");
    parent.appendChild(style);
  }

  function removeStyle() {
    if (!document || typeof document.getElementById !== "function") {
      return;
    }
    const style = document.getElementById(STYLE_ID);
    if (style && typeof style.remove === "function") {
      style.remove();
    }
  }

  function observerTarget() {
    if (!document) {
      return null;
    }
    const player = typeof document.getElementById === "function"
      ? document.getElementById("movie_player")
      : null;
    return player || document.body || document.documentElement || null;
  }

  // Keep one observer attached, re-targeted when YouTube swaps the player.
  function attachObserver() {
    if (!running || typeof MutationObserver !== "function") {
      return;
    }
    const target = observerTarget();
    if (!target) {
      return;
    }
    if (observer && observedTarget === target) {
      return;
    }
    if (observer) {
      observer.disconnect();
    }
    try {
      observer = new MutationObserver(schedule);
      observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"]
      });
      observedTarget = target;
    } catch (error) {
      observer = null;
      observedTarget = null;
    }
  }

  // Coalesce bursts of mutations into at most one pass per DEBOUNCE_MS.
  function schedule() {
    if (!running || debounceTimer !== null) {
      return;
    }
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      runChecks();
    }, DEBOUNCE_MS);
  }

  function runChecks() {
    if (!running) {
      return;
    }
    dismissAds();
    fastForwardAdVideos();
    injectStyle();
    attachObserver();
  }

  function onNavigate() {
    if (!running) {
      return;
    }
    injectStyle();
    attachObserver();
    schedule();
  }

  // Toggle the document-level navigation listeners alongside `running`.
  function watchNavigation(enable) {
    const method = enable ? "addEventListener" : "removeEventListener";
    if (document && typeof document[method] === "function") {
      document[method]("yt-navigate-finish", onNavigate);
    }
    if (typeof window !== "undefined" && window && typeof window[method] === "function") {
      window[method]("popstate", onNavigate);
    }
  }

  function start() {
    if (running) {
      return;
    }
    running = true;
    injectStyle();
    watchNavigation(true);
    attachObserver();
    runChecks();
  }

  function stop() {
    running = false;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    observedTarget = null;
    watchNavigation(false);
    removeStyle();
  }

  function loadSettings() {
    if (typeof getSettings !== "function") {
      stop();
      return;
    }
    let pending = null;
    try {
      pending = getSettings();
    } catch (error) {
      stop();
      return;
    }
    if (!pending || typeof pending.then !== "function") {
      stop();
      return;
    }
    pending.then(function (settings) {
      if (settings && settings.adBlocking) {
        start();
      } else {
        stop();
      }
    }).catch(function () {
      stop();
    });
  }

  // React to the popup/options toggles without waiting for a page reload.
  function onStorageChanged(changes, area) {
    if (area && area !== "local") {
      return;
    }
    if (!changes || !Object.prototype.hasOwnProperty.call(changes, "adBlocking")) {
      return;
    }
    const next = changes.adBlocking ? changes.adBlocking.newValue : undefined;
    if (next === false) {
      stop();
    } else {
      loadSettings();
    }
  }

  function boot() {
    if (typeof document === "undefined" || !document) {
      return;
    }
    if (typeof getSettings !== "function") {
      return;
    }
    if (typeof browser !== "undefined" && browser && browser.storage &&
        browser.storage.onChanged &&
        typeof browser.storage.onChanged.addListener === "function") {
      browser.storage.onChanged.addListener(onStorageChanged);
    }
    loadSettings();
  }

  boot();
})();
