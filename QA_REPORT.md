# SafeBlock — QA verification report

Ticket: `tkt_ed9f3ee5-cb5e-4d7e-87d9-7fb793d908ed` (QA verification of the extension)
Developer: QA Engineer · Date: 2026-11-21 · Environment: Linux, Node v22.23.5, Python 3.12.3
Scope: **static verification only** — no browser is available in this environment. Everything below was
executed from the workspace root `/home/agentroost/safeblock`.

**Overall verdict: PASS WITH ISSUES** (0 blockers, 1 medium, 2 low defects; all acceptance criteria met)
**Production code changed by QA: none.** No trivial fixes were applied — every finding is filed as a defect.

---

## 1. Check results

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Tree inventory; every manifest-referenced path exists | **PASS** | inventory script, see §2.1 |
| 2 | All JSON files parse | **PASS** | `python3 -m json.tool` ×3, all exit 0 |
| 3 | DNR ruleset integrity (ids, actions, conditions, priorities) | **PASS with 1 finding** | integrity script, see §2.3 |
| 4 | `node --check` on every JS file | **PASS** | 7/7 exit 0 |
| 5 | Cross-browser API usage / manifest keys / script load order | **PASS** (see O4 for unverifiable runtime items) | see §2.5 |
| 6 | Privacy & resource checks (console, eval, remote URLs, timers, storage) | **PASS** | see §2.6 |
| 7 | Settings defaults, persistence, `updateEnabledRulesets` wiring | **PASS** (behavioural harness, 25 assertions, 0 failures) | see §2.7 |
| 8 | Report written with PASS/FAIL table + defect list | **PASS** | this file |

Acceptance criteria of the ticket:

1. Report lists each check with pass/fail — **met** (§1).
2. All `.json` files parse — **met** (§2.2).
3. Default ruleset states: `ads_trackers` `enabled: true`, `adult_filter` `enabled: false` — **met** (§2.2, §2.3).
4. `grep` for `console.*` and filesystem/log-writing APIs returns no matches — **met** (§2.6).
5. `manifest.json` `content_scripts` / `rule_resources` match expected files and matches — **met**, with one
   extra content-script entry beyond the brief (observation O1).
6. Report explicitly states issues found — **met** (§3).

---

## 2. Commands and results

### 2.1 Inventory and manifest reference resolution

Inventory (`find . -path ./.git -prune -o -type f -print` — 18 shipped files: 17 extension files plus `README.md`; 19 with this report. 192 KB of extension code, 208 KB with README, 228 KB with both docs):

```
manifest.json
lib/compat.js  lib/settings.js  lib/rules.js
content/youtube.js  content/adult.js
popup/popup.html  popup/popup.js  popup/popup.css
options/options.html  options/options.js  options/options.css
rules/ads_trackers.json  rules/adult_filter.json
icons/icon16.png  icons/icon48.png  icons/icon128.png
README.md          (added after the checks below; docs only, see §6)
QA_REPORT.md       (this report)
```

Reference resolution script (`python3`, walks `icons`, `action.default_popup`, `options_ui.page`,
`declarative_net_request.rule_resources[].path`, `content_scripts[].js`, plus every `src`/`href` in both
HTML pages): **13/13 manifest references OK, 10/10 HTML references OK, no MISS lines.**

Icons decode as valid RGBA PNGs at the declared sizes (16×16, 48×48, 128×128; each a single flat colour `#1b5e20`).

### 2.2 JSON parsing

```
$ python3 -m json.tool manifest.json > /dev/null            # exit 0
$ python3 -m json.tool rules/ads_trackers.json > /dev/null  # exit 0
$ python3 -m json.tool rules/adult_filter.json > /dev/null  # exit 0
```

Manifest `declarative_net_request.rule_resources` decoded:

```
ads_trackers : enabled=True   path=rules/ads_trackers.json
adult_filter : enabled=False  path=rules/adult_filter.json
```

### 2.3 DNR ruleset integrity

| Property | ads_trackers | adult_filter |
|---|---|---|
| top-level keys | `["rules"]` | `["rules"]` |
| rule count | 109 | 181 |
| id range / uniqueness | 1–109, 109 unique, no duplicates | 1000–1180, 181 unique, no duplicates |
| cross-file id collisions | **none** (1–109 vs 1000–1180) | — |
| action types | `block` ×109 | `block` ×181 |
| rules with `condition` | 109/109 | 181/181 |
| rules with `resourceTypes` | 109/109 | 181/181 |
| priorities | 1 (all) — as specified | 2 (all) — as specified |
| duplicate `urlFilter` in file | none | none |
| duplicate `urlFilter` across files | none | none |
| malformed filter shape | **1** (`||facebook.com/tr`, see D2) | none |

All ids are positive integers, all action types are valid DNR action types, no unknown condition keys,
no invalid `resourceTypes` values. Counts are far below the Chrome static-rule limit (30 000/ruleset).

### 2.4 JavaScript syntax

```
$ for f in lib/*.js content/*.js popup/*.js options/*.js; do node --check "$f"; done
OK  lib/compat.js      OK  content/adult.js    OK  popup/popup.js
OK  lib/rules.js       OK  content/youtube.js  OK  options/options.js
OK  lib/settings.js
```

### 2.5 Cross-browser and manifest surface

* No `background`, `service_worker`, `background.service_worker`, or `background.scripts` key.
  The only grep hit for "background" is a prose comment at `lib/rules.js:14`.
* `browser_specific_settings.gecko.id = "safeblock@example.com"` — present.
* `permissions` is exactly `["declarativeNetRequest","storage"]`; no `host_permissions`,
  no `optional_permissions`, no `web_accessible_resources`.
* No `chrome.*` API calls in shipped code except the guarded alias in `lib/compat.js:13,17`
  (`if (typeof chrome === "undefined") return; window.browser = chrome;`). No `chrome.tabs`,
  `chrome.scripting`, `chrome.webRequest`, `chrome.offscreen`, `chrome.alarms`.
* Page script order verified: `popup/popup.html:21-24` and `options/options.html:26-29` both load
  `lib/compat.js` → `lib/settings.js` → `lib/rules.js` → page script. Content scripts list
  `lib/compat.js`, `lib/settings.js` before their entry script.
* No inline `<script>` blocks and no inline event handlers in either HTML page (MV3 CSP safe).
* `compat.js` behaviour exercised in a sandbox (harness E): Firefox path leaves an existing `browser`
  intact; Chrome path sets `window.browser === chrome`; missing-both path does not throw.

### 2.6 Privacy and resource checks

```
$ grep -rn "console\." . --include='*.js' --include='*.html' --include='*.json' --include='*.css'   # exit 1, no matches
$ grep -rn "setInterval" . --include='*.js'                                                        # exit 1, no matches
$ grep -rn "requestAnimationFrame" . --include='*.js'                                              # exit 1, no matches
$ grep -rnE "\beval\s*\(|new Function|importScripts|innerHTML|document\.write" . --include='*.js' --include='*.html'  # exit 1
$ grep -rniE "downloads|FileWriter|showSaveFilePicker|indexedDB|filesystem|localStorage|sessionStorage|document.cookie|sendBeacon" . --include='*.js' --include='*.html'  # exit 1
$ grep -rnE "https?://" . --include='*.js' --include='*.html' --include='*.css'                     # exit 1, no matches
$ grep -nE "\"(background|service_worker|host_permissions|optional_permissions|web_accessible_resources)\"" manifest.json  # exit 1
$ grep -rnE "setInterval|setTimeout|requestAnimationFrame" . --include='*.js'                       # 1 hit: content/youtube.js:189 (see below)
```

* Only timer in the tree: `content/youtube.js:189` `setTimeout(..., DEBOUNCE_MS)` with
  `DEBOUNCE_MS = 250` — a mutation-driven debounce, not a polling interval; the script disconnects its
  observer and clears the timer when `adBlocking` is off (`stop()`, `content/youtube.js:236-249`).
  No `setInterval` anywhere, so the "no interval below 1000 ms" rule holds vacuously.
* Storage: only `browser.storage.local` in `lib/settings.js:9,15`, keys `adBlocking` and `adultFilter`;
  `content/youtube.js:279-292` only *reads* change events. No `storage.sync`, no unrelated keys, no disk I/O.
* No remote code, no remote script URLs, no telemetry endpoints in shipped code.

### 2.7 Settings behaviour (executable harness)

The real `lib/compat.js`, `lib/settings.js`, `lib/rules.js`, `popup/popup.js` and `options/options.js` were
run in a Node `vm` sandbox whose context mimics a shared classic-script global scope, with stubbed
`browser.storage.local` and `browser.declarativeNetRequest.updateEnabledRulesets` recording every call.
Harness: `/tmp/safeblock_qa/harness.js` (temporary artifact outside the workspace; not part of the shipped tree).

```
$ node /tmp/safeblock_qa/harness.js
=== A. popup page: load + both toggles ===
PASS  popup load: adBlocking checkbox checked (default true)
PASS  popup load: adultFilter checkbox unchecked (default false)
PASS  popup load: enables ads_trackers only
PASS  popup load: no settings write
PASS  adult ON: confirm() shown
PASS  adult ON: persisted {adBlocking:true,adultFilter:true}
PASS  adult ON: updateEnabledRulesets enable=[ads_trackers,adult_filter] disable=[]
PASS  adult OFF: persisted {adBlocking:true,adultFilter:false}
PASS  adult OFF: updateEnabledRulesets enable=[ads_trackers] disable=[adult_filter]
PASS  adBlocking OFF: persisted {adBlocking:false,adultFilter:false}
PASS  adBlocking OFF: updateEnabledRulesets enable=[] disable=[ads_trackers,adult_filter]
=== B. popup: adult-filter confirmation cancelled ===
PASS  cancel: checkbox reverted to unchecked
PASS  cancel: nothing persisted
PASS  cancel: no ruleset update
=== C. options page: load ===
PASS  options load: toggles match defaults
PASS  options load: enables ads_trackers only
=== D. persisted settings applied on reload ===
PASS  reload: checkboxes reflect stored settings
PASS  reload: rulesets match stored settings
=== E. compat shim ===
PASS  compat: Firefox path leaves browser global intact
PASS  compat: Chrome path sets window.browser === chrome
PASS  compat: neither chrome nor browser does not throw
=== F. rules.js failure paths ===
PASS  applyRuleState -> true on success
PASS  applyRuleState -> false (no throw) when API missing
PASS  applyRuleState -> false (no throw) when API throws
PASS  applyRuleState -> false (no throw) when API rejects
=== G. shared globals: lib/settings.js evaluated twice ===
NOTE  second evaluation throws -> SyntaxError: Identifier 'DEFAULT_SETTINGS' has already been declared
INFO  getSettings still defined after duplicate: function
RESULT failures=0
```

Defaults verified: `adBlocking: true` (`lib/settings.js:4`, ruleset ships `enabled: true`),
`adultFilter: false` (`lib/settings.js:5`, ruleset ships `enabled: false`). Both UI toggles persist through
`setSettings()` and then call `applyRuleState()` → `updateEnabledRulesets()` with mutually exclusive
enable/disable id lists. Negative path (API missing/throwing/rejecting, confirm cancelled) never throws.

`updateEnabledRulesets` arguments recorded by the harness, in order:

```
load                -> enable: ["ads_trackers"]                 disable: ["adult_filter"]
adult ON            -> enable: ["ads_trackers","adult_filter"]  disable: []
adult OFF           -> enable: ["ads_trackers"]                 disable: ["adult_filter"]
adBlocking OFF      -> enable: []                               disable: ["ads_trackers","adult_filter"]
reload (stored false/true) -> enable: ["adult_filter"]          disable: ["ads_trackers"]
```

---

## 3. Defects

### D1 — Medium — `lib/settings.js` is injected twice on YouTube, throwing a `SyntaxError` in every page console

* **Files:** `manifest.json:24-48` (two `content_scripts` entries), `lib/settings.js:3`, `lib/compat.js`, `content/youtube.js`, `content/adult.js`
* **Reproduction:** the YouTube entry (`*://*.youtube.com/*`, `*://m.youtube.com/*`) and the adult-filter
  entry (`<all_urls>`) both list `lib/compat.js` and `lib/settings.js`. On any YouTube page both entries
  match, so both files are evaluated in the same extension isolated world.
  Node emulation of that shared scope (harness G above) reproduces:
  `SyntaxError: Identifier 'DEFAULT_SETTINGS' has already been declared`.
* **Expected:** shared libraries are evaluated once per frame; no uncaught errors on page load.
* **Actual:** an uncaught `SyntaxError` per YouTube page load. Functionality survives only because
  `getSettings` from the first evaluation remains in the global scope; if injection order changed or the
  first script were skipped, `content/adult.js` would silently no-op.
* **Suggested fix (smallest):** merge the two entries where possible, or make the shared files
  re-entrant — e.g. wrap `lib/settings.js` in an IIFE that assigns `self.getSettings` / `self.setSettings`
  only when undefined (same for `lib/compat.js`), or use a `var`-based guard instead of top-level `const`.
  Re-check with `node --check` plus a browser smoke test on `www.youtube.com`.

### D2 — Low — over-broad DNR filter `||facebook.com/tr` blocks unrelated Facebook paths

* **File:** `rules/ads_trackers.json:1846` (rule id 109)
* **Reproduction:** `python3` integrity script; this is the only one of 290 filters that does not have the
  `||domain^` shape.
* **Expected:** `"urlFilter": "||facebook.com/tr^"` — anchor the pixel endpoint at a separator so only
  `facebook.com/tr?...` matches.
* **Actual:** `||facebook.com/tr` matches any URL containing that substring, e.g.
  `https://www.facebook.com/travel`, `/trending`, `/transparency`, `/tr…`. The rule applies to
  `main_frame`, `sub_frame`, `script`, `image`, `xmlhttprequest`, so those pages/requests are blocked
  outright for every user with ad blocking on (default).
* **Acceptance:** `||facebook.com/tr^` present, all 109 filters match `^\|\|[^ ]+\^$`, JSON parses,
  rule id 109 unchanged.

### D3 — Low — no Firefox `strict_min_version`; Firefox 109–112 installs but can never block

* **File:** `manifest.json:60-64`
* **Expected:** `"browser_specific_settings": { "gecko": { "id": "safeblock@example.com", "strict_min_version": "113.0" } }`
  (113 is the first Firefox release with static `declarativeNetRequest` rulesets and
  `updateEnabledRulesets`).
* **Actual:** the extension declares MV3 Firefox support with no minimum version. On Firefox releases that
  support MV3 but not DNR (~109–112) it would install successfully and silently block nothing, with the
  popup toggles appearing to work (`applyRuleState` correctly returns `false` and stays quiet).
* **Acceptance:** `strict_min_version` present; manifest still parses; Chrome still loads (unknown
  `browser_specific_settings` key is ignored — see O3).

---

## 4. Observations and residual risks (not defects)

* **O1 — extra content script beyond the brief.** `manifest.json:37-47` registers
  `content/adult.js` on `<all_urls>` (top frame only, `document_idle`), which is not in this ticket's
  expected-contents list. It is written correctly for an opt-in feature (single async settings read, early
  return before any DOM work when `adultFilter !== true`, no listeners/polling), but it does mean one
  storage read per top-level page load for every user, and it is the trigger for D1. Worth a product
  confirmation that the DOM-level guard is intended given that blocking is already done by the DNR ruleset.
  The parallel security review reached the same conclusion and filed it as `tkt_2dd3aad3` (High, remove the
  `<all_urls>` content script); see §5 for how that ticket and D1 interact.
* **O2 — unhandled storage write.** `popup/popup.js:23` and `options/options.js:23` call `setSettings()`
  without awaiting or handling rejection. A failed write (quota/IO) would surface as an unhandled promise
  rejection in the extension console and the UI would show a state that was not persisted. Low risk, no
  logging — noted only.
* **O3 — Chrome cosmetic warning.** Chrome logs `Unrecognized manifest key 'browser_specific_settings'`
  and still loads the extension. Expected for a cross-browser build; no action needed.
* **O4 — not verifiable without a browser.** None of the following could be exercised statically and must
  be covered by the manual smoke test before release: actual DNR enforcement on both engines
  (in particular whether Firefox needs host permissions for the `main_frame` resource type used by all 290
  rules — the manifest declares no `host_permissions` by design); `chrome.storage` promise support on the
  oldest supported Chrome; MV3 popup/options rendering in both browsers; the YouTube selectors
  (`.ytp-ad-skip-button*`, `.ad-interrupting video`, …) against the current YouTube DOM; and whether Firefox
  injects both content-script entries into the same isolated world exactly as emulated in D1.
* **O5 — icon artwork** is a valid but flat single-colour PNG set; acceptable as a placeholder, but the
  Release/Store submission may want real artwork.

---

## 5. Recommended follow-up

Filed and assigned to the Developer:

* `tkt_6d3b1c06-6701-407b-9d3e-bee582f4c280` — D1 (Medium), duplicate content-script lib injection.
* `tkt_41e32719-14bd-4556-ba35-eb98b3ac8df2` — D2 + D3 (Low), facebook filter + `strict_min_version`.

Interaction with the security-review tickets filed in parallel (`tkt_e015c4c3`):

* `tkt_2dd3aad3` (High, remove the `<all_urls>` content script = O1) **also removes the trigger for D1**.
  If that ticket is implemented by dropping the second `content_scripts` entry, D1 is fixed by the same
  change and only needs a re-verification of `lib/settings.js` being injected once. If instead the entry
  survives in any form, D1 still needs the re-entrancy fix.
* `tkt_ebe084c1` (Low, add `ping`/`object`/`other` to `resourceTypes`) edits both rulesets after this
  verification. Any such edit must re-run §2.2 and §2.3 (JSON parse, unique ids, `||domain^` shape,
  priorities 1/2) — the tighter filter-shape rule in D2 applies to new rules too.

O1 needs a product decision from the Project Manager (keep `content/adult.js` on `<all_urls>` or drop it),
and O4 must be executed as a browser smoke test by whoever can run Chrome and Firefox before packaging
(see `tkt_900cdd95`, Release Engineer).

---

## 6. Post-verification tree changes (checked, no re-verification needed)

While this report was being written, `README.md` was added by the Technical Writer (the extension files
themselves are unchanged — see the hash list recorded in §6.1). README claims were spot-checked against this
verification and agree with it: 109/181 rule counts and priorities, `permissions` = `declarativeNetRequest`
+ `storage`, "no `host_permissions`", "only timer is the 250 ms debounce", the `||domain^` filter
convention (which is exactly D2), no `strict_min_version` + "Firefox 113 or newer" (D3), and a "YouTube
console error" section that describes D1. README links to this report and lists D1–D3 under Known issues.
The new file is documentation only: it is not referenced by `manifest.json` and does not change any result
above.

### 6.1 Verification snapshot (md5 of the shipped files at verification time)

```
7fad8ca382e7cb96f3dba369a376a217  manifest.json
b32cdf92f0e12d7fbc709f58e3b60e63  rules/ads_trackers.json
3b7f7ba16bc01d289dc4d0f8fe7bb3a9  rules/adult_filter.json
11d10eb66aa6e28f1f2239ec41cba0f6  lib/compat.js
e90eca18ad85901e37bb4a67c6597879  lib/rules.js
2b1908ca61e1e8ac013b40b397cdce5d  lib/settings.js
2581c995f99259924aa5f0a058fd10b5  content/adult.js
d5f88f2f2b7cd59a8efa48154e421801  content/youtube.js
c3b68963c608ed759b70ddcad4602d0a  popup/popup.js      (identical to options/options.js)
```
