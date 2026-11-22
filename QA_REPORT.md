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

---

## Addendum — 2026-11-22 — YouTube in-feed / promoted ad hiding

Ticket: `tkt_4de71cff-dc17-42fe-9f3d-b824bf518eed` (QA verification of YouTube in-feed ad hiding)
Change under test: `tkt_a1ad0cf9-9ae8-4fbd-ab07-cb7938d5da34` (Developer, completed)
Environment: Linux, Node v22.23.5, Python 3.12.3, workspace `/home/agentroost/safeblock`
Method: static diff review + independent stub-DOM execution of the real content-script chain in Node
`vm`. **No browser is available**, so nothing below is a live-YouTube result.

**Verdict: PASS for the source change; DO NOT SHIP the current packaged artifacts.**
One release-artifact defect (stale zip + stale git bundle, DEF-1/DEF-2) must be fixed by
`tkt_521ecd3b-e70a-44fc-8abe-0e1e0d8b5477` before the packaged deliverable is shipped. No source-code
defect was found in `content/youtube.js`.

### 1. PASS/FAIL table

| # | Check (from the ticket) | Command / script actually run | Output | Verdict |
|---|---|---|---|---|
| 1 | Coverage: stub document with every Developer renderer + real first-party containers; stylesheet hides every ad renderer (incl. the ad.jpg card shape) and no first-party container | `node .verify/qa_youtube_feed_dom.js` (QA-owned harness; 12 checks) | `all independent QA checks passed`, exit 0 | **PASS** |
| 1b | Coverage test is not vacuous (fails on the pre-change script) | `git show HEAD:content/youtube.js > .verify/old_youtube.js` then `SAFEBLOCK_YOUTUBE_SRC=… node .verify/qa_youtube_feed_dom.js` | 2 FAIL, exit 1 ("stylesheet is missing ytd-ad-slot-renderer", "card root is not hidden") | **PASS** (negative control) |
| 2 | Gating / self-termination: `adBlocking=false` boot → no style, no observer; toggle off → style removed, observer disconnected, nav listeners detached; toggle on → style returns; no polling, only 250 ms debounce | `node .verify/qa_youtube_feed_dom.js` (scenarios A–D) | 6 gating/timer PASS lines, exit 0 | **PASS** |
| 3a | Scope: `manifest.json` byte-identical to the pre-change version | `git diff --exit-code -- manifest.json`; `git show HEAD:manifest.json \| cmp -s - manifest.json` | both exit 0; md5 `3875ae270b51f9f1652ba47eaa65a07d` on both | **PASS** |
| 3b | Scope: no `<all_urls>`, permissions exactly `['declarativeNetRequest','storage']`, exactly one `content_scripts` entry matching `*://*.youtube.com/*` | `node -e 'const m=require("./manifest.json"); …'`; also `node .verify/check_scope.js` | see §4 | **PASS** |
| 4a | Regression: `node .verify/check_scope.js` | `node .verify/check_scope.js` | 8 PASS, `all checks passed`, exit 0 | **PASS** |
| 4b | Regression: `node .verify/check_resource_types.js` | `node .verify/check_resource_types.js` | 12 PASS, `all checks passed`, exit 0 | **PASS** |
| 4c | Regression: `node .verify/check_amo_manifest.js` | `node .verify/check_amo_manifest.js` | 6 PASS, `all checks passed`, exit 0 | **PASS** |
| 4d | Regression: `node .verify/check_youtube_feed.js` | `node .verify/check_youtube_feed.js` | 8 PASS, `all checks passed`, exit 0 | **PASS** |
| 4e | Every JSON file parses | `python3 -m json.tool` on `manifest.json`, `rules/ads_trackers.json`, `rules/adult_filter.json` | 3/3 exit 0 | **PASS** |
| 5 | Stale artifacts (zip/bundle vs. source) | `python3` `zipfile` entry comparison; `git bundle list-heads` + bare clone + `git show main:content/youtube.js` | zip and bundle both contain the old 4-selector file | **FAIL — DEF-1 / DEF-2** |

### 2. Independent stub-DOM coverage (check 1)

The harness is QA-owned and separate from the Developer's `.verify/check_youtube_feed.js`. It builds a
stub `document`/`window`/`MutationObserver`/`browser.storage` context, evaluates the real
`lib/compat.js` + `lib/settings.js` + `content/youtube.js` in `node:vm`, then parses the injected
`<style>` and **matches its selectors against the stub tree** (tag / id / class / descendant / comma
matching, including ancestor-aware visibility) instead of checking substrings.

Modeled tree (all of it real first-party shapes):

* `ytd-app` → `ytd-masthead` → `#masthead-container` → `#masthead-ad` → `ytd-banner-promo-renderer`
* `#movie_player` → `.ytp-ad-module` → `.ytp-ad-overlay-container` (+ a skip button), `#player-ads` →
  `ytd-display-ad-renderer`
* `ytd-page-manager` → `ytd-browse` → `ytd-two-column-browse-results-renderer` → `#primary` →
  `ytd-rich-grid-renderer` → `#contents`, with:
  * first-party `ytd-rich-item-renderer` / `#content` / `ytd-rich-grid-media` video cards;
  * the ad.jpg card: `ytd-rich-item-renderer` → `#content` → `ytd-ad-slot-renderer` →
    `ytd-in-feed-ad-layout-renderer` → `ytd-promoted-sparkles-web-renderer` with an `<img>` card, text
    `Sponsored · Fideliana`, and a kebab `yt-icon-button` (`aria-label="Action menu"`);
  * `ytd-promoted-video-renderer`, `ytd-companion-slot-renderer`, `ytd-banner-promo-renderer`,
    `ytd-statement-banner-renderer`, `ytd-brand-video-shelf-renderer`, `ytd-display-ad-renderer`,
    a standalone `ytd-in-feed-ad-layout-renderer`, and a `#secondary` `ytd-ad-slot-renderer`;
  * second first-party video card and `#secondary` as controls.

Verbatim output (`node .verify/qa_youtube_feed_dom.js`, current working tree):

```
PASS adBlocking=true injects exactly one style element
PASS stylesheet has one rule per HIDE_SELECTORS entry
PASS every Developer ad renderer is hidden by actual selector matching
PASS ad.jpg card shape (image + 'Sponsored . advertiser' + kebab) is hidden
PASS no first-party container is matched or hidden
PASS stylesheet and injected style survive repeated passes without duplicates
PASS observer watches the player subtree with childList+subtree+class
PASS navigation listeners are attached while running
PASS adBlocking=false at boot creates no style, observer, listener or timer
PASS runtime toggle-off removes style, disconnects observer, detaches navigation
PASS runtime toggle-on re-injects the style, observer and navigation listeners
PASS only timer in source is the 250 ms debounce; no polling or console/network

all independent QA checks passed
[exit code: 0]
```

What the assertions actually prove:

* The injected stylesheet has exactly 13 rules, one per `HIDE_SELECTORS` entry
  (`content/youtube.js:26-43`), including all 9 added in-feed/promoted selectors.
* Every ad element is hidden by real matching, not by textual coincidence: `#player-ads`,
  `.ytp-ad-overlay-container`, `ytd-display-ad-renderer`, `.ytp-ad-module`, `ytd-ad-slot-renderer`,
  `ytd-in-feed-ad-layout-renderer`, `ytd-promoted-sparkles-web-renderer`,
  `ytd-promoted-video-renderer`, `ytd-companion-slot-renderer`, `ytd-banner-promo-renderer`,
  `ytd-statement-banner-renderer`, `ytd-brand-video-shelf-renderer`, `#masthead-ad`.
* The ad.jpg card is hidden at the `ytd-ad-slot-renderer` / `ytd-in-feed-ad-layout-renderer` /
  `ytd-promoted-sparkles-web-renderer` levels; the `<img>`, the `Sponsored · Fideliana` text and the
  kebab menu are all inside a hidden subtree.
* No stylesheet selector matches **any** element with tag `ytd-rich-item-renderer` or
  `ytd-rich-grid-renderer`, or id `content` or `primary` — a structural sweep over the tree, not just
  a check of the literal selector list. First-party video cards remain visible.
* Repeated mutation passes do not duplicate the `<style>`: exactly one `<style>` in `<head>`.

Negative control — the same harness pointed at `git show HEAD:content/youtube.js` (pre-change source,
old 4-selector `HIDE_SELECTORS`):

```
PASS adBlocking=true injects exactly one style element
PASS stylesheet has one rule per HIDE_SELECTORS entry
FAIL every Developer ad renderer is hidden by actual selector matching - stylesheet is missing ytd-ad-slot-renderer
FAIL ad.jpg card shape (image + 'Sponsored . advertiser' + kebab) is hidden - card root is not hidden
PASS no first-party container is matched or hidden
PASS stylesheet and injected style survive repeated passes without duplicates
PASS observer watches the player subtree with childList+subtree+class
PASS navigation listeners are attached while running
PASS adBlocking=false at boot creates no style, observer, listener or timer
PASS runtime toggle-off removes style, disconnects observer, detaches navigation
PASS runtime toggle-on re-injects the style, observer and navigation listeners
PASS only timer in source is the 250 ms debounce; no polling or console/network

2 check(s) failed
  - every Developer ad renderer is hidden by actual selector matching: stylesheet is missing ytd-ad-slot-renderer
  - ad.jpg card shape (image + 'Sponsored . advertiser' + kebab) is hidden: card root is not hidden
[exit code: 1]
```

This proves the coverage assertions fail when the 9 new selectors are absent, i.e. the green run above
is not a vacuous pass.

### 3. Gating and self-termination (check 2)

The same harness, with a controllable `browser.storage` mock and an instrumented
`setTimeout`/`MutationObserver`:

* **`adBlocking=false` at boot:** no `<style>` (and `<head>` has zero children), no
  `MutationObserver` instance, zero document/window navigation listeners, zero timers. Exactly one
  passive `storage.onChanged` listener remains registered by design, so re-enabling works without a
  page reload.
* **Toggle off after start:** the injected `<style>` is removed from `<head>`; the observer's
  `disconnect()` is called and it is no longer connected; both `yt-navigate-finish` (document) and
  `popstate` (window) listeners are detached; a pending 250 ms debounce timer is cleared and never
  fires; no new observer is created.
* **Toggle back on:** the style returns with all 13 rules, a fresh observer is connected to
  `#movie_player` with `{childList:true, subtree:true, attributes:true, attributeFilter:["class"]}`,
  and both navigation listeners are re-attached.
* **Timer hygiene:** source contains exactly one `setTimeout(` call, whose delay is `DEBOUNCE_MS = 250`;
  `setInterval`, `requestAnimationFrame`, `console.*`, `fetch` and `XMLHttpRequest` are absent. Every
  instrumented timer observed during the run had delay `250`; two synchronous mutation callbacks
  coalesced into one timer, and a third pass after firing created none.

`content/youtube.js` was not modified by QA. The only extension-source change is the Developer's
selector addition (`git diff`: 1 file, +13/−1). (The `git status` snapshot above was taken before this
report was appended; `QA_REPORT.md` is now modified as well.)

### 4. Scope discipline (check 3)

```
$ git diff --exit-code -- manifest.json
[exit code: 0]
$ git show HEAD:manifest.json | cmp -s - manifest.json
[exit code: 0]
$ md5sum manifest.json /tmp/manifest.head.json
3875ae270b51f9f1652ba47eaa65a07d  manifest.json
3875ae270b51f9f1652ba47eaa65a07d  /tmp/manifest.head.json
$ git status --porcelain=v1 --untracked-files=all
 M content/youtube.js
```

`manifest.json` sha256 `b6ca1cb3b78757356fcb82f577ea436fb2dfb32d7e919545df17835d16d296df` in both the
working tree and `HEAD`; the Developer's change did not touch it.

```
$ node -e 'const m=require("./manifest.json"); console.log("permissions:", JSON.stringify(m.permissions)); console.log("content_scripts entries:", m.content_scripts.length); console.log("matches:", JSON.stringify(m.content_scripts[0].matches)); console.log("js:", JSON.stringify(m.content_scripts[0].js)); console.log("run_at:", m.content_scripts[0].run_at); console.log("host_permissions:", m.host_permissions); console.log("has <all_urls>:", JSON.stringify(m).includes("<all_urls>"));'
permissions: ["declarativeNetRequest","storage"]
content_scripts entries: 1
matches: ["*://*.youtube.com/*"]
js: ["lib/compat.js","lib/settings.js","content/youtube.js"]
run_at: document_idle
host_permissions: undefined
has <all_urls>: false
```

Exactly one content-script entry, matching only `*://*.youtube.com/*` (the old `m.youtube.com` entry is
gone, subsumed by the wildcard); no host permissions; no `<all_urls>`. Note: the manifest is unchanged
by design, so this check is a guard against accidental scope creep, not a property this change created.

### 5. Regression suite and JSON (checks 4a–4e)

All four scripts were run from the workspace root **after** the last source edit; every one exited 0.
Verbatim output:

```
===== node .verify/check_scope.js =====
PASS manifest declares exactly one content_scripts entry
PASS content script matches only *://*.youtube.com/*
PASS manifest has no broad host access
PASS permissions are exactly declarativeNetRequest + storage
PASS content/adult.js is gone
PASS no shipped file or README references adult.js
PASS adult filter remains opt-in through the DNR ruleset
PASS YouTube content script chain evaluates once without error

all checks passed
[exit code: 0]

===== node .verify/check_resource_types.js =====
PASS rules/ads_trackers.json is a non-empty array
PASS rules/ads_trackers.json ids are unchanged and unique
PASS rules/ads_trackers.json urlFilters are unchanged
PASS rules/ads_trackers.json no field except condition.resourceTypes changed
PASS rules/ads_trackers.json every rule covers ping, object and other
PASS rules/ads_trackers.json spot-checked rules list the new types
PASS rules/adult_filter.json is a non-empty array
PASS rules/adult_filter.json ids are unchanged and unique
PASS rules/adult_filter.json urlFilters are unchanged
PASS rules/adult_filter.json no field except condition.resourceTypes changed
PASS rules/adult_filter.json every rule covers ping, object and other
PASS rules/adult_filter.json spot-checked rules list the new types

all checks passed
[exit code: 0]

===== node .verify/check_amo_manifest.js =====
PASS manifest.json parses
PASS gecko data_collection_permissions is declared
PASS required collection is exactly ['none']
PASS declared collection categories are valid
PASS gecko id and minimum version are unchanged
PASS extension still requests only declarativeNetRequest + storage

all checks passed
[exit code: 0]

===== node .verify/check_youtube_feed.js =====
PASS HIDE_SELECTORS declares at least one selector
PASS HIDE_SELECTORS contains every required ad selector
PASS HIDE_SELECTORS contains no first-party container selector
PASS adBlocking=true injects a rule for every HIDE_SELECTORS entry
PASS injected stylesheet never hides first-party containers
PASS adBlocking=false injects no style
PASS storage.onChanged adBlocking=false removes the injected style
PASS content script keeps one debounce timer and no console/network calls

all checks passed
[exit code: 0]
```

JSON validation (all JSON files in the tree, `.git` excluded):

```
$ for f in ./manifest.json ./rules/ads_trackers.json ./rules/adult_filter.json; do python3 -m json.tool "$f" > /dev/null; echo "$f -> exit $?"; done
./manifest.json -> exit 0
./rules/ads_trackers.json -> exit 0
./rules/adult_filter.json -> exit 0
```

`node --check` also passed for every shipped JS file (6/6) and every `.verify` script including the QA
harness (6/6 at the time, including the temporary old-copy file; exit 0 each).

The Developer's `.verify/check_youtube_feed.js` is a useful second opinion but is **not** the primary
evidence above: it checks the stylesheet text with `String.includes`, not selector matching. The QA
harness complements it with real matching and the negative control.

### 6. Stale packaged artifacts — DEFECT (check 5)

**DEF-1 — Medium — `safeblock-extension.zip` does not contain the in-feed fix.**
**DEF-2 — Low — `safeblock-main.bundle` does not contain the in-feed fix.**
Both are covered by `tkt_521ecd3b-e70a-44fc-8abe-0e1e0d8b5477` (Release Engineer, high).

Evidence (source vs. artifacts):

```
source content/youtube.js: bytes=8713 sha256=678242a5df6ddaddbabeb7be9d4e8c2c9a2604b4fb10525b7a60f3000625f61d
zip entry content/youtube.js: bytes=8229 sha256=7a51e27f0a9a4adeba18954087d9ccc9528d3589ba4230f5951e406545e6d144
zip HIDE_SELECTORS:
const HIDE_SELECTORS = [
    "#player-ads",
    ".ytp-ad-overlay-container",
    "ytd-display-ad-renderer",
    ".ytp-ad-module"
  ];

safeblock-main.bundle refs/heads/main: 03e81ee5835988c222cc102efe774f8922a1cb12
bundle main content/youtube.js sha256: 7a51e27f0a9a4adeba18954087d9ccc9528d3589ba4230f5951e406545e6d144
bundle HIDE_SELECTORS: same 4-entry block as the zip
workspace HEAD: 03e81ee (the fix is an uncommitted working-tree edit)
```

* `safeblock-extension.zip` → `content/youtube.js:26-31`: old 4-selector block, missing all 9 new
  selectors. Zip timestamp 2026-11-21 17:30; source mtime 2026-11-22 12:53. All other 15 zip entries
  are byte-identical to the working tree, so `content/youtube.js` is the only stale entry.
* `safeblock-main.bundle` → git bundle, `refs/heads/main` = `03e81ee` (workspace `HEAD`), so it can
  only contain committed history; `git show main:content/youtube.js` is the same 8229-byte old file.
  Bundle timestamp 2026-11-21 18:54.
* Severity rationale: the zip is the distributable, so a store/user install would not get in-feed
  blocking at all — release-blocking for the packaged deliverable (Medium, DEF-1). The bundle is a
  local source snapshot regenerated from a commit, so it becomes correct as soon as the change is
  committed and the bundle is rebuilt (Low, DEF-2). **QA did not rebuild either artifact**, per the
  ticket.

### 7. Defects and must-fix list

| ID | Severity | File:line | Problem | Fix |
|---|---|---|---|---|
| DEF-1 | **Medium** | `safeblock-extension.zip` → `content/youtube.js:26-31` | Distributable zip ships the pre-change 4-selector script; in-feed/promoted ads are not hidden for anyone installing the zip. | Rebuild the zip from the post-change tree; verify the entry sha256 equals `678242a5…` and all 13 selectors are present. `tkt_521ecd3b-e70a-44fc-8abe-0e1e0d8b5477`. |
| DEF-2 | Low | `safeblock-main.bundle` → `refs/heads/main 03e81ee`, `content/youtube.js:26-31` | Git bundle predates the uncommitted fix and carries the old script. | Rebuild the bundle after committing the change; verify `git show main:content/youtube.js` sha256 equals `678242a5…`. Same ticket. |

No source-code defect was found: the diff is limited to `HIDE_SELECTORS` (`content/youtube.js:32-42`,
+13/−1), the rule set is correct, gating and self-termination behave as documented, and the regression
suite is green.

### 8. Residual risks / not verified

1. **No browser/DOM fixture of live YouTube.** The stub tree is modeled from the renderer names and the
   ad.jpg description. Real YouTube markup can differ (attribute-level selectors, shadow DOM, renamed
   tags), and the `display: none !important` rules were not exercised against a real page. A browser
   smoke test remains required before release.
2. **Possible blank grid cell.** In the real home feed an ad slot is usually wrapped in a first-party
   `ytd-rich-item-renderer`. Hiding the inner `ytd-ad-slot-renderer` removes the card content, but the
   wrapper (and therefore possibly a grid cell) is intentionally left visible, so a gap may remain.
   This is a consequence of the ticket's explicit "do not hide first-party containers" rule; visual
   confirmation is needed.
3. **Renderer variants not listed.** `ytd-compact-promoted-video-renderer` (watch sidebar),
   `ytd-promoted-sparkles-text-search-renderer` (search ads) and similar tags are not explicit
   selectors. Some are likely nested under covered wrappers (`ytd-ad-slot-renderer`,
   `ytd-in-feed-ad-layout-renderer`), but that is unverified; treat as a follow-up if a real ad slips
   through.
4. **First-party promos may also hide.** `ytd-banner-promo-renderer` and
   `ytd-statement-banner-renderer` can carry YouTube's own promotional banners, not just paid ads. This
   matches the ticket's requested list but is a product trade-off.
5. **Passive listener remains while disabled.** One `storage.onChanged` listener stays registered when
   `adBlocking` is off (by design, to re-enable without reload). It performs no work and no polling; not
   a leak, but it is a listener the "self-terminating" comment should be read as allowing.
6. **Artifacts** (DEF-1/DEF-2) are stale and are the only ship blocker.

### 9. Acceptance criteria mapping

1. Dated section with one PASS/FAIL row per ticket check, naming the command/script — **met** (§1).
2. Stub-DOM evidence that all in-feed/promoted ad renderers (incl. the card shape) are matched and no
   first-party container selector is emitted — **met** (§2; 13/13 ad selectors, structural sweep of
   `ytd-rich-item-renderer` / `ytd-rich-grid-renderer` / `#content` / `#primary`).
3. `adBlocking=false` boot creates no style/observer, and runtime toggle-off removes the style —
   **met** (§3, PASS lines 9–11).
4. All four `.verify` scripts quoted verbatim with exit codes — **met** (§5, all exit 0).
5. Stale-artifact status stated as PASS or defect with severity — **met** (§6; DEF-1 Medium, DEF-2 Low).
6. Explicit ship / do-not-ship recommendation and defect ids — **met** (§10, §12).

### 10. Recommendation

**The source change is verified and may land.** The current packaged deliverables must **not** ship:
`safeblock-extension.zip` and `safeblock-main.bundle` still contain the old `content/youtube.js`, so
the advertised in-feed ad fix would be absent from what users install.

* **Do not ship** the current `safeblock-extension.zip` / `safeblock-main.bundle` as-is.
* **Fix first:** DEF-1 and DEF-2 via `tkt_521ecd3b-e70a-44fc-8abe-0e1e0d8b5477` (rebuild both
  artifacts from the post-change tree, verify the 13 selectors and matching sha256).
* After that rebuild, the source + artifacts pair is ready for the manual browser smoke test (live
  YouTube home feed and a watch page, Chrome + Firefox), which this environment cannot run.

### 11. QA self-review

* **Changed files:** `content/youtube.js` — Developer's change only (1 file, +13/−1; verified with
  `git diff`). `QA_REPORT.md` — this addendum. `.verify/qa_youtube_feed_dom.js` — new QA harness in the
  gitignored `.verify/` scratch directory; `.verify/old_youtube.js` and output captures are scratch and
  were deleted after the run. No source, manifest, rules or artifact file was edited by QA.
* **Diff review:** the only hunk adds a comment split and the 9 in-feed/promoted selectors to
  `HIDE_SELECTORS`; no dead code, debug output, secrets, network calls, new timers, or unrelated
  refactors. The pre-existing gating/observer code is unchanged and was exercised as-is.
* **Reproduction:**
  `node .verify/qa_youtube_feed_dom.js` (expect exit 0);
  `git show HEAD:content/youtube.js > .verify/old_youtube.js && SAFEBLOCK_YOUTUBE_SRC="$PWD/.verify/old_youtube.js" node .verify/qa_youtube_feed_dom.js`
  (expect exit 1 — negative control).

### 12. Final ship / do-not-ship decision

**DO NOT SHIP the current packaged artifacts.** `safeblock-extension.zip` (DEF-1, Medium) and
`safeblock-main.bundle` (DEF-2, Low) still contain the pre-change `content/youtube.js`; anyone
installing them would not get the in-feed/promoted ad fix. Both must be rebuilt under
`tkt_521ecd3b-e70a-44fc-8abe-0e1e0d8b5477` **before** release.

**The source change itself is PASS and approved to land.** No source-code defect was found; after the
artifact rebuild, the pair is ready for the manual Chrome + Firefox YouTube smoke test.
