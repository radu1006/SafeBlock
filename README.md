# SafeBlock

SafeBlock is a small, cross-browser Manifest V3 extension that blocks ad and
tracker domains with the browser's own `declarativeNetRequest` engine, dismisses
YouTube ads with a content script, and offers an **optional, off-by-default**
adult content filter.

There is no background page, no remote code, no telemetry and no logging: the
extension ships two static JSON rule lists and two settings booleans.

> **Status:** early development (`0.1.0`). The extension is loaded unpacked or as
> a temporary add-on; nothing is published to the Chrome Web Store or to
> addons.mozilla.org. See [Known issues](#known-issues-and-residual-risks) and
> [`QA_REPORT.md`](QA_REPORT.md) before relying on it.

Licensed under the [Apache License 2.0](LICENSE) · source:
<https://github.com/radu1006/SafeBlock>

---

## What it does

| Feature | How it works | Default |
|---|---|---|
| Ad and tracker blocking | Static `declarativeNetRequest` ruleset `ads_trackers` (`rules/ads_trackers.json`, 109 rules) blocks known ad/tracker domains for main frames, sub-frames, scripts, images and XHR. | **On** |
| YouTube ad handling | Content script `content/youtube.js` on `*.youtube.com` and `m.youtube.com` clicks skip buttons, seeks in-stream ad videos to their end, and hides ad slots. Runs only while ad blocking is on. | Follows ad blocking |
| Adult content filter | Second static ruleset `adult_filter` (`rules/adult_filter.json`, 181 rules) blocks known adult domains. Disabled in the manifest and off in settings until the user turns it on. | **Off (opt-in)** |

The adult filter is **never enabled automatically**. Its ruleset ships with
`"enabled": false` in `manifest.json`, and the settings default
(`lib/settings.js`) is `adultFilter: false`.

---

## Supported browsers

- **Chrome** (and other Chromium browsers) with Manifest V3 support.
- **Firefox** with Manifest V3 support. The manifest declares the Gecko
  extension ID `safeblock@example.com` under `browser_specific_settings`.

Static `declarativeNetRequest` rulesets are required for blocking to work, so the
manifest pins `browser_specific_settings.gecko.strict_min_version` to `113.0` —
the first Firefox release with static rulesets and
`updateEnabledRulesets()`. Older releases refuse the install instead of showing
toggles that block nothing.

The same section declares `data_collection_permissions.required: ["none"]`, the
declaration addons.mozilla.org asks for from an extension that collects nothing.

A small shim, `lib/compat.js`, aliases `chrome` to `browser` when needed, so the
same code path serves both engines.

---

## Install (unpacked / temporary)

No store build exists. Both browsers load the folder exactly as it is in this
repository.

### Chrome / Chromium

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select this extension folder — the directory containing `manifest.json`.
5. SafeBlock appears in the toolbar. Pin it if you want the popup one click away.

Chrome logs `Unrecognized manifest key 'browser_specific_settings'` on load. That
is expected for the cross-browser build and does not affect functionality.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` inside this folder.

A temporary add-on is removed when Firefox restarts; repeat the steps after a
restart, or sign the extension for permanent installation.

---

## Settings

Two switches exist, and both the popup and the options page show the same pair.

**Open the popup:** click the SafeBlock icon in the toolbar. Its page is
`popup/popup.html`.

**Open the options page:**

- Chrome: `chrome://extensions` → SafeBlock **Details** → **Extension options**.
- Firefox: `about:addons` → SafeBlock → **Options** / **Preferences**.

The options page is `options/options.html`. The popup does not link to it.

| Toggle | Effect | Default |
|---|---|---|
| **Block ads and trackers** (`adBlocking`) | Enables the `ads_trackers` ruleset and starts the YouTube content script. Turning it off disables that ruleset and stops the YouTube script; the adult filter keeps its own state and stays on if it was enabled. | On |
| **Block adult content (opt-in)** (`adultFilter`) | Enables the `adult_filter` ruleset. Turning it on shows a confirmation dialog first; cancelling it reverts the checkbox and stores nothing. | **Off** |

Changes take effect immediately — the extension calls
`declarativeNetRequest.updateEnabledRulesets()` from the popup/options page, and
the YouTube script also reacts to the settings change without a page reload.
Pages already loaded may keep content until refreshed.

The adult filter says "known adult domains": it is a domain blocklist. It does
not inspect page content.

---

## Permissions

SafeBlock requests exactly two permissions (`manifest.json`):

- **`declarativeNetRequest`** — lets the browser's networking engine apply the
  static block lists. SafeBlock does not read, intercept or modify requests in
  its own code; it only toggles which shipped rule lists are enabled. There is
  no `webRequest`, no `host_permissions`, no background worker.
- **`storage`** — stores the two settings booleans in `browser.storage.local`.
  Nothing else is stored.

### Privacy properties

- **No logging to disk.** Shipped code contains no `console.*` calls and no file
  or download APIs; there is no debug log to grow, rotate or leak.
- **No telemetry, no analytics, no network calls** from extension code. No
  remote scripts are loaded, and no URLs are fetched by SafeBlock itself.
- **Settings only.** The stored values are the booleans `adBlocking` and
  `adultFilter`. No history, no page contents, no browsing data, no cookies.
- The only timer in the code is a 250 ms debounce in `content/youtube.js`; it is
  cancelled when ad blocking is off. No polling anywhere.

---

## How it works / project structure

On a fresh install the browser applies only the ruleset the manifest marks
enabled (`ads_trackers`). The popup and options pages read the two settings
from `browser.storage.local`, then call `lib/rules.js` → `applyRuleState()`,
which translates them into a single
`declarativeNetRequest.updateEnabledRulesets()` call. Because there is no
background page, that toggle happens only while a settings page is open; stored
settings are re-applied the next time one is opened. Content scripts read the
same settings independently and start or stop themselves.

```
manifest.json            MV3 manifest: permissions, rulesets, content scripts, popup/options
rules/ads_trackers.json  Static DNR block list for ads/trackers (ids 1-109, priority 1)
rules/adult_filter.json  Static DNR block list for adult domains (ids 1000-1180, priority 2)
lib/compat.js            Aliases chrome -> browser so one code path works in both engines
lib/settings.js          Defaults + getSettings()/setSettings() over browser.storage.local
lib/rules.js             Maps settings to ruleset enable/disable via updateEnabledRulesets()
content/youtube.js       YouTube ad skipping and ad-slot hiding (youtube.com only)
popup/                   Toolbar popup: popup.html, popup.js, popup.css
options/                 Options page: options.html, options.js, options.css
icons/                   icon16.png, icon48.png, icon128.png
LICENSE                  Apache License 2.0
QA_REPORT.md             Static QA verification report and defects found against 0.1.0
SECURITY_REVIEW.md       Security and privacy review, with residual risk and release gate
RELEASE_REPORT.md        Packaging report: artifact hash, git commit, checks, rollback
```

There is no page-level adult content script. Domain blocking is done entirely by
the `adult_filter` ruleset, so the extension never asks for site-wide host access.

---

## Customizing the block lists

Both lists are static `declarativeNetRequest` rulesets with the same shape. Each
file is a **top-level JSON array** of rule objects (a static ruleset file is an
array, not an object wrapping a `rules` key), and each array element looks like
this:

```json
{
  "id": 110,
  "priority": 1,
  "action": { "type": "block" },
  "condition": {
    "urlFilter": "||example-adnetwork.com^",
    "resourceTypes": [
      "main_frame",
      "sub_frame",
      "script",
      "image",
      "xmlhttprequest",
      "ping",
      "object",
      "other"
    ]
  }
}
```

**To add an ad or tracker domain:** append an object to the top-level array in
`rules/ads_trackers.json`, give it the next free id, and use `priority` `1`.

**To add an adult domain:** append an object to the top-level array in
`rules/adult_filter.json`, give it the next free id, and use `priority` `2`.

Conventions used by both files:

- Keep ids inside the file's range: ads `1`–`999` (currently `1`–`109`, so the
  next free id is `110`); adult `1000` and up (currently `1000`–`1180`, so the
  next free id is `1181`). Ids must be unique, and the two ranges must not
  overlap.
- Anchor a domain filter with the `||domain^` form so it matches the domain and
  its subdomains only. A bare `||domain/path` also matches longer paths.
- `resourceTypes` lists the request kinds to block; copy the existing list unless
  you need something narrower. Every rule currently covers `main_frame`,
  `sub_frame`, `script`, `image`, `xmlhttprequest`, `ping`, `object` and `other`,
  so `navigator.sendBeacon()`/`<a ping>` beacons and `<object>`/`<embed>` loads
  to a listed domain are blocked as well.
- Existing rules use `"priority": 1` (ads) and `"priority": 2` (adult).

**The JSON must stay valid**, or the browser will refuse to load the extension
and report a manifest/ruleset error. After editing, run:

```sh
python3 -m json.tool rules/ads_trackers.json > /dev/null
python3 -m json.tool rules/adult_filter.json > /dev/null
# the top level must be an array of rules
python3 -c 'import json;assert isinstance(json.load(open("rules/ads_trackers.json")), list)'
python3 -c 'import json;assert isinstance(json.load(open("rules/adult_filter.json")), list)'
```

Then reload the extension (see below) so the new ruleset is read.

---

## Limitations and troubleshooting

- **No per-site allowlist.** There is no "pause on this site" control; toggles
  are global. Current workaround: turn ad blocking off for the site you need,
  then turn it back on.
- **YouTube DOM changes can break the content script.** `content/youtube.js`
  relies on YouTube's class names (`.ytp-ad-skip-button*`, `.ad-interrupting
  video`, `.ytp-ad-module`, …). If YouTube renames or restructures them, ad
  handling silently stops while domain blocking keeps working.
- **Unpacked extension needs reloading after code changes.** After editing JS,
  HTML, CSS or rules, click the reload button on the SafeBlock card in
  `chrome://extensions`; in Firefox, remove and re-add the temporary add-on.
  Then refresh the affected tabs — content scripts do not update in already-open
  pages.
- **Toggles move but nothing is blocked.** Confirm the browser supports static
  rulesets (Firefox 113+), and confirm the matching ruleset is enabled. A
  ruleset that was never enabled, or a broken JSON file, produces no blocking.
- **Some sites still show ads.** First-party or server-side ads served from the
  site's own domain are not in the list; adding that domain would block the
  whole site. Add only dedicated ad/tracker hosts.

### Known issues and residual risks

- **Not exercised in a browser.** All of the verification recorded in
  [`QA_REPORT.md`](QA_REPORT.md) and [`SECURITY_REVIEW.md`](SECURITY_REVIEW.md)
  is static: no Chrome or Firefox run is recorded. Loading the unpacked
  extension and confirming that a known ad domain is blocked is still required
  before release.
- **Adult filter false positives (L3).** The opt-in list blocks whole domains
  with no per-site allowlist, including mixed-use hosts such as `nifty.org`, so
  a false positive can only be undone by turning the whole filter off. The list
  is a curated static snapshot, last reviewed 2026-11-21; its provenance is not
  recorded per entry.
- **The review documents describe 0.1.0 as reviewed, not as shipped here.** The
  findings QA and the security review filed against that snapshot — the
  `<all_urls>` content script (H1/O1), the duplicate `lib/settings.js` injection
  (D1/M1), `||facebook.com/tr` (D2/L2), the missing `strict_min_version`
  (D3/I2) and the missing `ping`/`object`/`other` resource types (L1) — are
  fixed in this tree. The reports keep the original findings as the record of
  that review.

---

## Development notes

Sanity-check the shipped files before loading a build:

```sh
# JSON syntax (manifest and both rulesets)
python3 -m json.tool manifest.json > /dev/null
python3 -m json.tool rules/ads_trackers.json > /dev/null
python3 -m json.tool rules/adult_filter.json > /dev/null

# JavaScript syntax, every shipped script
for f in lib/*.js content/*.js popup/*.js options/*.js; do node --check "$f"; done
```

Both commands exit `0` and print nothing on success. Prefer `node --check` over
running the files: the scripts expect `browser.storage` and a DOM, so they only
execute inside the extension.

Load order matters. Popup and options pages load `lib/compat.js`, then
`lib/settings.js`, then `lib/rules.js`, then their own script; content scripts
load `lib/compat.js` and `lib/settings.js` before `content/*.js`. Keep that order
if you add files, and keep `lib/settings.js` re-entrant: it can be evaluated more
than once in one isolated world, so it keeps its declarations inside an IIFE and
publishes `getSettings`/`setSettings` only when they are still missing.

There is no build step, no package manager, and no bundler: the repository root
is the extension.

---

## License

SafeBlock is released under the [Apache License 2.0](LICENSE).

```
Copyright 2026 radu1006
```

You may not use the project except in compliance with the License; a copy ships
in [`LICENSE`](LICENSE) and is also available at
<http://www.apache.org/licenses/LICENSE-2.0>. Unless required by applicable law
or agreed to in writing, the software is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

The license covers the extension source, the static rule lists in `rules/` and
the documentation in this repository. Third-party domain names appear in the
block lists for identification only; no trademark rights are granted.

Source: <https://github.com/radu1006/SafeBlock>
