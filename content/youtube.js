"use strict";

// SafeBlock - YouTube ad handling content script.
//
// Injected on YouTube pages only, and only while `adBlocking` is enabled in the
// shared settings. It dismisses skippable ads, fast-forwards in-stream ad
// videos where that is safe, hides ad slots/overlays, and hides the first-party
// feed tile that wraps an in-feed ad so no empty grid cell is left behind. A
// tile that is a multi-item container (a search result list, a feed section) is
// only hidden while the ad is all it holds, so first-party content next to an
// ad is never taken with it.
//
// The script is self-terminating: when `adBlocking` is switched off it clears
// its pending timer, disconnects its MutationObserver, removes its injected
// style, strips its tile markers and detaches its navigation listeners, so an
// idle page costs nothing.
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
    // Watch-page sidebar, search-result text ads and search promoted-video
    // ("pyv") units. These are ad renderers, not first-party content.
    "ytd-compact-promoted-video-renderer",
    "ytd-promoted-sparkles-text-search-renderer",
    "ytd-search-pyv-renderer",
    "ytd-companion-slot-renderer",
    "ytd-banner-promo-renderer",
    "ytd-statement-banner-renderer",
    "ytd-brand-video-shelf-renderer",
    "#masthead-ad"
  ];
  // Wrapper elements a feed ad sits inside. ytd-rich-item-renderer is a single
  // grid cell; the other two are containers of many items. Hiding only the inner
  // ad renderer leaves an empty cell, so the wrapper is collapsed instead. The
  // removed ytd-rich-grid-media is first-party card markup: it sits *inside* a
  // cell, so stopping there left the outer cell visible. See hideAdTiles().
  const TILE_WRAPPER_TAGS = [
    "ytd-rich-item-renderer",
    "ytd-rich-section-renderer",
    "ytd-item-section-renderer"
  ];
  // The wrapper tags above that hold many items rather than a single cell: a
  // search-result list or a home-feed section. Marking one of these hides every
  // result in it, so a container is only hidden while the ad is all it holds.
  const TILE_CONTAINER_TAGS = [
    "ytd-rich-section-renderer",
    "ytd-item-section-renderer"
  ];
  // First-party renderers that share a container with an ad on real YouTube.
  // If a container holds any of them, it is left visible and the ad renderer's
  // own rule does the hiding.
  const FIRST_PARTY_CONTENT_SELECTOR = [
    "ytd-video-renderer",
    "ytd-rich-grid-media",
    "ytd-compact-video-renderer",
    "ytd-shelf-renderer",
    "ytd-grid-video-renderer"
  ].join(", ");
  const TILE_MARKER_CLASS = "safeblock-hidden-tile";
  const TILE_MARKER_SELECTOR = "." + TILE_MARKER_CLASS;
  // Every element-name entry of HIDE_SELECTORS is an ad renderer and therefore
  // a valid anchor for the wrapper pass; the id/class entries (#player-ads,
  // .ytp-ad-module, ...) cover player and masthead units that never sit inside
  // a feed cell.
  const TILE_ANCHOR_SELECTORS = HIDE_SELECTORS.filter(function (selector) {
    return selector.charAt(0) !== "." && selector.charAt(0) !== "#";
  });
  const TILE_ANCHOR_QUERY = TILE_ANCHOR_SELECTORS.join(", ");
  const MAX_WRAPPER_DEPTH = 16;
  const STYLE_SELECTORS = HIDE_SELECTORS.concat([TILE_MARKER_SELECTOR]);
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
    style.textContent = STYLE_SELECTORS.map(function (selector) {
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

  // --- Feed tile wrappers ---------------------------------------------------
  //
  // Hiding an ad renderer inside `ytd-rich-item-renderer` removes the card but
  // leaves the wrapper (and its grid cell) in place, which shows up as a blank
  // tile. A CSS parent selector would be shorter, but the relational :has
  // pseudo-class only shipped in Firefox 121 while manifest.json allows gecko
  // strict_min_version 113.0, so such a rule would silently match nothing on
  // Firefox 113-120. Instead the pass walks up to the nearest wrapper tag and
  // marks it with a class hidden by the injected stylesheet. No inline
  // element.style is used, so stop() can restore the page completely.

  function hasTileMarker(element) {
    if (!element || !element.classList ||
        typeof element.classList.contains !== "function") {
      return false;
    }
    try {
      return element.classList.contains(TILE_MARKER_CLASS);
    } catch (error) {
      return false;
    }
  }

  function addTileMarker(element) {
    if (!element || !element.classList || hasTileMarker(element)) {
      return;
    }
    if (typeof element.classList.add !== "function") {
      return;
    }
    try {
      // The guard above skips the write for an already marked tile, so a pass
      // triggered by our own class mutation finds nothing to change and the
      // observer feedback loop dies out after the first marking.
      element.classList.add(TILE_MARKER_CLASS);
    } catch (error) {
      // Ignore a node whose class list cannot be written.
    }
  }

  function removeTileMarker(element) {
    if (!element || !element.classList ||
        typeof element.classList.remove !== "function") {
      return;
    }
    try {
      element.classList.remove(TILE_MARKER_CLASS);
    } catch (error) {
      // Ignore a node whose class list cannot be written.
    }
  }

  function isTileWrapper(element) {
    if (!element) {
      return false;
    }
    const name = element.localName || element.tagName;
    if (!name) {
      return false;
    }
    const tag = String(name).toLowerCase();
    for (let index = 0; index < TILE_WRAPPER_TAGS.length; index += 1) {
      if (tag === TILE_WRAPPER_TAGS[index]) {
        return true;
      }
    }
    return false;
  }

  function isTileContainer(element) {
    if (!element) {
      return false;
    }
    const name = element.localName || element.tagName;
    if (!name) {
      return false;
    }
    const tag = String(name).toLowerCase();
    for (let index = 0; index < TILE_CONTAINER_TAGS.length; index += 1) {
      if (tag === TILE_CONTAINER_TAGS[index]) {
        return true;
      }
    }
    return false;
  }

  // Walk up from the ad renderer to the nearest feed cell wrapper. The depth cap
  // keeps the pass cheap on deep pages and bounds the work per ad node.
  function nearestTileWrapper(node) {
    let current = node ? node.parentNode : null;
    let depth = 0;
    while (current && depth < MAX_WRAPPER_DEPTH) {
      if (isTileWrapper(current)) {
        return current;
      }
      current = current.parentNode;
      depth += 1;
    }
    return null;
  }

  function containsAdRenderer(tile) {
    if (!tile || typeof tile.querySelector !== "function") {
      return true;
    }
    try {
      return !!tile.querySelector(TILE_ANCHOR_QUERY);
    } catch (error) {
      return true;
    }
  }

  // A container can host first-party results next to an ad. Hiding it then
  // hides content the user asked for, so containers get a stricter rule than a
  // single cell: see shouldHideTile().
  function containsFirstPartyContent(tile) {
    if (!tile || typeof tile.querySelector !== "function") {
      return false;
    }
    try {
      return !!tile.querySelector(FIRST_PARTY_CONTENT_SELECTOR);
    } catch (error) {
      return true;
    }
  }

  // A cell wrapper may be hidden once it holds an ad renderer. A container
  // wrapper may only be hidden while the ad is its only content; otherwise the
  // ad renderer's own rule hides the ad and the container stays visible.
  function shouldHideTile(tile) {
    if (!containsAdRenderer(tile)) {
      return false;
    }
    if (!isTileContainer(tile)) {
      return true;
    }
    return !containsFirstPartyContent(tile);
  }

  // Idempotent: marking an already marked tile performs no DOM write. The prune
  // step drops a stale marker when YouTube recycles a tile element for a normal
  // video, or adds first-party content next to the ad in a shared container, so
  // a reused cell or container cannot stay hidden.
  function hideAdTiles() {
    TILE_ANCHOR_SELECTORS.forEach(function (selector) {
      each(selector, function (adNode) {
        const wrapper = nearestTileWrapper(adNode);
        if (wrapper && shouldHideTile(wrapper)) {
          addTileMarker(wrapper);
        }
      });
    });
    each(TILE_MARKER_SELECTOR, function (tile) {
      if (!shouldHideTile(tile)) {
        removeTileMarker(tile);
      }
    });
  }

  function stripTileMarkers() {
    each(TILE_MARKER_SELECTOR, removeTileMarker);
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
    hideAdTiles();
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
    // Strip markers only after the observer is disconnected, so removing class
    // attributes here cannot schedule another pass.
    stripTileMarkers();
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
