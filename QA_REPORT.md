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

---

## Addendum — 2026-11-24 — Icon artwork follow-up (QA_REPORT O5)

**Scope.** Independent verification of the Developer's artwork change (`tkt_be15f144`, run
`run_b49d3351`) against the QA ticket `tkt_2bcfb67d`. Every figure below was re-derived by QA from
the bytes on disk with a decoder written for this check (`.verify/qa_icons.py`, `zlib` + `struct`
only — `PIL` is **not** installed in this environment, so no third-party decoder was involved).
Nothing in the Developer's report was taken on trust.

**O5 (`QA_REPORT.md` §4, line 276) is CLOSED.** The icon set is no longer a flat single-colour fill.

### 1. Verdict

**PASS.** All seven acceptance checks pass, no defect is filed. Residual risk is limited to the
browser rendering check, which this environment cannot run (see §10).

| # | Acceptance check | Command / method | Observed | Result |
|---|---|---|---|---|
| 1 | Four icons decode as 16/32/48/128 px, 8-bit, colour type 6, IHDR first, all CRCs valid, full IDAT decode | `python3 .verify/qa_icons.py .` | 4/4 pass; 3 chunks each (IHDR/IDAT/IEND), 3/3 CRCs valid, exact inflated IDAT size | **PASS** |
| 2 | Non-flat evidence per icon (unique colours, transparent share, dominant colour share); a flat fill must fail | same script, plus re-run on the `HEAD` icons as a negative control | unique 30/43/43/49; dominant `#1b5e20` 30.5/40.8/42.5/45.9 % (guard threshold 95 %); `HEAD` icons measured 100 % and **failed** the guard | **PASS** |
| 3 | Old flat files replaced, not supplemented; four icons not byte-identical | `sha256sum icons/*.png`, `git show HEAD:icons/…` | 3 old files overwritten (82/126/300 B → 326/781/1988 B), `icon32.png` new; 4 distinct sha256 | **PASS** |
| 4 | `manifest.json` parses; `action.default_icon` exactly 16/32/48/128, paths resolve; `icons` has 32; permissions unchanged; DNR/content_scripts/popup/options/version unchanged vs HEAD | `python3 .verify/qa_manifest.py .`, `python3 -m json.tool manifest.json`, `git diff manifest.json` | 5 added keys, 0 removed, 0 changed; 9 protected sections identical; `json.tool` exit 0 | **PASS** |
| 5 | Every icon reference in manifest, `popup/`, `options/` resolves | `qa_manifest.py` reference walk | 8 manifest icon paths + 10 HTML/CSS/JS references all resolve; no `icons/` path hard-coded outside the manifest | **PASS** |
| 6 | `tools/make_icons.py` is stdlib-only and reproduces the shipped icons byte-for-byte in a temp dir | AST import scan vs `sys.stdlib_module_names`; run copied script in `tmp/qa_icons_repro/` | imports `math`, `os`, `struct`, `zlib` (all stdlib); 4/4 sha256 identical; two runs identical | **PASS** |
| 7 | Scope: only `manifest.json`, `README.md`, `icons/`, `tools/make_icons.py`; runtime dirs and artifacts untouched | `git status --porcelain`, `git diff --stat`, `git diff --name-only -- content lib popup options rules` | exactly those paths; runtime dirs empty diff; stale artifacts are the known release item | **PASS** |

### 2. Icon decode — size, format, chunks

`python3 .verify/qa_icons.py .` (exit 0, 0 failures). Each file: PNG signature `89 50 4E 47 0D 0A 1A 0A`,
chunk order `IHDR IDAT IEND` (IHDR first, IEND last), colour type 6, bit depth 8, compression 0,
filter 0, interlace 0, every chunk CRC recomputed and matching, and the IDAT zlib stream inflated to
exactly `height × (1 + 4 × width)` bytes with all five PNG filter types implemented in the decoder.

| File | Bytes | Dimensions | IHDR | Chunks / CRCs | Inflated IDAT | sha256 |
|---|---|---|---|---|---|---|
| `icons/icon16.png` | 326 | 16×16 | 8-bit, type 6 | 3 / 3 valid | 1040 B | `4571aa833699bb60b001b1ec0eecb981c7baf1d78d136a5aa6aaf42960564234` |
| `icons/icon32.png` | 557 | 32×32 | 8-bit, type 6 | 3 / 3 valid | 4128 B | `c41a2491e4489ec4ae45179552d7f599fe093eebb404b058ba70e86258a82319` |
| `icons/icon48.png` | 781 | 48×48 | 8-bit, type 6 | 3 / 3 valid | 9264 B | `6c3eff8808d75bc9371b6ed818637f35570cd307ec6fb0cc95897601d8a4b592` |
| `icons/icon128.png` | 1988 | 128×128 | 8-bit, type 6 | 3 / 3 valid | 65664 B | `eae0ed307681fc972b6f42596dd23a059e3fdda9ca3745ef4c643708cf9beedd` |

No ancillary chunks are present (no `tEXt`, `pHYs`, `iCCP`), so nothing but geometry and pixels is
shipped. The four sha256 values are pairwise distinct, and no file matches any other: these are four
independent renders, not one bitmap copied to four names.

### 3. Non-flat evidence

Rule applied: a flat fill would show one unique colour covering ~100 % of pixels. The guard fails any
icon whose dominant non-transparent colour reaches ≥ 95 % of **all** pixels.

| Icon | Unique RGBA | Unique RGB | Fully transparent | Anti-aliased edge px | Dominant RGB | Share of all px | Guard |
|---|---|---|---|---|---|---|---|
| `icon16.png` | 30 | 22 | 32/256 = 12.5 % | 46 | `#1b5e20` | 78/256 = **30.5 %** | OK |
| `icon32.png` | 43 | 28 | 158/1024 = 15.4 % | 88 | `#1b5e20` | 418/1024 = **40.8 %** | OK |
| `icon48.png` | 43 | 29 | 434/2304 = 18.8 % | 76 | `#1b5e20` | 980/2304 = **42.5 %** | OK |
| `icon128.png` | 49 | 33 | 3150/16384 = 19.2 % | 340 | `#1b5e20` | 7513/16384 = **45.9 %** | OK |

Palette composition (exact colours only; `other` is the anti-aliased blend band):

| Icon | `#1b5e20` green | `#0f3d14` rim | white mark | other | clear |
|---|---|---|---|---|---|
| 16 px | 30.5 % | 12.5 % | 15.6 % (40 px) | 28.9 % | 12.5 % |
| 32 px | 40.8 % | 10.9 % | 19.0 % (195 px) | 13.8 % | 15.4 % |
| 48 px | 42.5 % | 8.3 % | 19.4 % (448 px) | 10.9 % | 18.8 % |
| 128 px | 45.9 % | 10.9 % | 20.7 % (3388 px) | 3.4 % | 19.2 % |

The brand green is still the dominant single colour (so the toolbar identity is unchanged), but it
covers less than half of every canvas: **the icons are artwork, not placeholders.** The small-size
"other" share (28.9 % at 16 px) is the expected anti-aliasing cost of a 1 px rim plus a diagonal bar
on a 16×16 canvas.

**Negative control (the check can fail).** The pre-change blobs were extracted with
`git show HEAD:icons/icon{16,48,128}.png > .verify/old_icons/…` and decoded with the same code:

| HEAD icon | Bytes | Unique colours | Dominant colour | Share | Guard |
|---|---|---|---|---|---|
| `icon16.png` | 82 | 1 | `#1b5e20` | 256/256 = 100.0 % | **FAIL** |
| `icon48.png` | 126 | 1 | `#1b5e20` | 2304/2304 = 100.0 % | **FAIL** |
| `icon128.png` | 300 | 1 | `#1b5e20` | 16384/16384 = 100.0 % | **FAIL** |

`icons/icon32.png` has no `HEAD` entry at all (`git cat-file -e HEAD:icons/icon32.png` → *exists on
disk, but not in HEAD*). So the three old flat files were **replaced** (same paths, new bytes,
new sizes) and the 32 px file is genuinely new — the set was not supplemented with a fourth blob
beside the old ones.

### 4. ASCII previews and legibility at 16 px

`python3 .verify/qa_icons.py .`, preview drawn from the decoded pixels (`@` = white block mark,
`#` = brand green, `+` = dark rim `#0f3d14`, `.` = transparent).

```
  icon16.png (16x16)                    icon32.png (32x32)
  .++++++++++++++.                      ...++++++++++++++++++++++++++...
  +##############+                      ..++########################++..
  +##############+                      .++##########################++.
  +####@@@@@#####+                      .+############################+.
  +###@@@@@######+                      .+############################+.
  +###@@@@###@###+                      .+##########@@@@@@@@##########+.
  +###@@@###@@###+                      .+########@@@@@@@@@@@#########+.
  +###@@###@@@###+                      .+#######@@@@@@@@@@@##########+.
  +###@###@@@@###+                      .+######@@@@@@@@@@@###########+.
  +######@@@@@###+                      .+######@@@@@@@@@@############+.
  .+####@@@@@###+.                      .+#####@@@@@@@@@@######@@#####+.
  ..############..                      .+#####@@@@@@@@@######@@@#####+.
  ...+########+...                      .+#####@@@@@@@@######@@@@#####+.
  ....+######+....                      .+#####@@@@@@@######@@@@@#####+.
  .....+####+.....                      .+#####@@@@@@######@@@@@@#####+.
  .......++.......                      .+#####@@@@@######@@@@@@@#####+.
                                        .+#####@@@@######@@@@@@@@#####+.
                                        .+#####@@@######@@@@@@@@@#####+.
                                        .+######@######@@@@@@@@@######+.
                                        .+############@@@@@@@@@@######+.
                                        .++##########@@@@@@@@@@######++.
                                        ..++########@@@@@@@@@@######++..
                                        ...+########@@@@@@@@########+...
                                        ....+######################+....
                                        .....++##################++.....
                                        ......++################++......
                                        .......++##############++.......
                                        .........+############+.........
                                        ..........++########++..........
                                        ...........++######++...........
                                        .............++##++.............
                                        ..............++++..............
```

**Judgement, stated explicitly:**

* **Shield silhouette — legible at 16 px.** Yes. Rounded shoulders, full-width body for the upper
  two thirds, an even taper to a single-pixel tip on the last row, and a darker rim (`#0f3d14`,
  0.035 of the canvas — sub-pixel at 16 px, so it reads as the outermost pixel ring) that separates
  it from a light or dark toolbar. The shape is unmistakable at 16×16 and matches the 128 px render
  (normalised ink box 0.02–0.98 wide at 48/128 px, full-bleed at 16/32 px).
* **White block mark — legible at 16 px.** Yes, with a caveat worth recording rather than filing:
  the mark reads as a white disc split by a diagonal slash (the "no entry" idiom). At 16 px the
  mark's bounding box is 8×8 px (half the canvas) and the green slash through it is 3 px wide, so the
  two white lobes are only ~4–5 px each; at 32 px the box is 18×18 px and the slash 6 px. It is
  recognisable as a blocked/prohibited mark at 100 % zoom, but it is coarse — the small-size
  reading is "white mark on a green shield" more than a crisp icon glyph.
  That is a normal 16 px trade-off, not a defect, and it is decisively no longer a plain green square.
* **Design consistency across sizes.** The white mark's normalised centre is identical at all four
  sizes — (0.500, 0.438) — and the mark box grows only slightly with resolution
  (0.500 / 0.562 / 0.583 / 0.594 of the canvas at 16/32/48/128). One design, four renders.

### 5. `manifest.json`

`python3 -m json.tool manifest.json` → **exit 0** (66 pretty-printed lines, empty stderr).
`python3 .verify/qa_manifest.py .` → **exit 0**, 0 failures.

`git diff manifest.json` — the complete change (one hunk, +8/−1; `git diff --stat` prints 9 as the total changed lines):

```diff
@@ -35,13 +35,20 @@
     }
   ],
   "action": {
-    "default_popup": "popup/popup.html"
+    "default_popup": "popup/popup.html",
+    "default_icon": {
+      "16": "icons/icon16.png",
+      "32": "icons/icon32.png",
+      "48": "icons/icon48.png",
+      "128": "icons/icon128.png"
+    }
   },
   "options_ui": {
     "page": "options/options.html"
   },
   "icons": {
     "16": "icons/icon16.png",
+    "32": "icons/icon32.png",
     "48": "icons/icon48.png",
     "128": "icons/icon128.png"
   },
```

Structural comparison of the flattened objects (not just the textual diff):

* **added (5):** `action.default_icon.16`, `.32`, `.48`, `.128`, `icons.32`.
* **removed (0), changed values (0).**
* **Protected sections identical to HEAD** (key-order-normalised structural compare, not text):
  `manifest_version`, `name`, `version`,
  `description`, `declarative_net_request` (both rulesets, ids, `enabled` flags, paths),
  `content_scripts` (YouTube-only entry, js list, `document_idle`), `options_ui`,
  `browser_specific_settings`, `action.default_popup`.
* **Permissions:** `["declarativeNetRequest", "storage"]` — unchanged, still exactly two; no
  `host_permissions` key was introduced.

Path resolution — 8/8 manifest icon references exist on disk:

| Key | Path | Resolves |
|---|---|---|
| `action.default_icon.16` / `icons.16` | `icons/icon16.png` | yes |
| `action.default_icon.32` / `icons.32` | `icons/icon32.png` | yes |
| `action.default_icon.48` / `icons.48` | `icons/icon48.png` | yes |
| `action.default_icon.128` / `icons.128` | `icons/icon128.png` | yes |

`popup/` and `options/` were walked for `url(...)` and `src=`/`href=` references: 10 local references
(`popup.css`, `options.css`, `../lib/compat.js`, `../lib/settings.js`, `../lib/rules.js`,
`popup.js`, `options.js`) all resolve, and **no** popup/options asset hard-codes an `icons/` path, so
the manifest is the single source of truth for icon wiring.

Negative control for the manifest checker: a copy of the tree in `tmp/neg/` with
`action.default_icon.32` pointed at `icons/icon32-missing.png` produced
`FAIL: action.default_icon[32] -> icons/icon32-missing.png does not resolve` and **exit 1** — the
path-resolution check is live, not vacuous. (Note the honest limitation: a value changed *inside a
key that did not exist at HEAD* cannot be caught by the HEAD structural diff — it shows up as
"added"; the path-resolution check is what guards those values.)

### 6. `tools/make_icons.py`

* **Imports** (`grep -nE '^\s*(import|from)\s' tools/make_icons.py`): `math`, `os`, `struct`, `zlib`.
  Checked against `sys.stdlib_module_names`: all four stdlib, **non-stdlib imports: none**. No
  `subprocess`, `socket`, `urllib`, `eval`, `exec`, `os.system` or network reference appears in the
  file.
* **Byte-for-byte reproduction into a temp directory** (the shipped `icons/` was not touched; mtimes
  stayed at 19:06 and the hashes after the run still match §2):

```
rm -rf tmp/qa_icons_repro && mkdir -p tmp/qa_icons_repro/tools
cp tools/make_icons.py tmp/qa_icons_repro/tools/
cd tmp/qa_icons_repro && python3 tools/make_icons.py
# wrote icons/icon16.png (326 bytes) / icon32.png (557) / icon48.png (781) / icon128.png (1988)
```

| Icon | Shipped sha256 | Reproduced sha256 | Match |
|---|---|---|---|
| `icon16.png` | `4571aa83…4234` | `4571aa83…4234` | identical |
| `icon32.png` | `c41a2491…2319` | `c41a2491…2319` | identical |
| `icon48.png` | `6c3eff88…b592` | `6c3eff88…b592` | identical |
| `icon128.png` | `eae0ed30…eadd` | `eae0ed30…eadd` | identical |

* **Determinism:** a second run in the same temp dir reproduced the same four hashes
  (`diff tmp/repro_run1.sha tmp/repro_run2.sha` → no output). The generator is deterministic, so the
  committed PNGs can be regenerated by anyone without producing spurious diffs.

### 7. Scope

`git status --porcelain`:

```
 M README.md
 M icons/icon128.png
 M icons/icon16.png
 M icons/icon48.png
 M manifest.json
?? icons/icon32.png
?? tools/
```

`git diff --stat`: 5 tracked files, `9 insertions(+), 2 deletions(-)` (`README.md` +1/−1 in the file
map, the three PNGs binary, `manifest.json` +8/−1). The one `README.md` hunk updates the file map to
`icon16.png, icon32.png, icon48.png, icon128.png; tools/make_icons.py regenerates them` — accurate.
`git diff --name-only -- content lib popup options rules` → **empty**: no runtime source changed.
`icons/` holds exactly the four PNGs; `tools/` holds exactly `make_icons.py`.

**Stale packaged artifacts — expected-pending, not a new defect.** `safeblock-extension.zip`
(12,579 B, sha256 `5094a04305201020857dadc1f2a6deee9adcbc5cc400c085e49bd85fdb92ede8`) and
`safeblock-main.bundle` (53,537 B, sha256 `7d7e5ed15b29fca4d5f39c86298b55e0310674fcbcd74db75a62aef998c604ac`)
both date from 2026-11-22 12:59 and are gitignored by design. The zip still carries the **old flat
icons** (82/126/300 B, matching the `HEAD` blobs), has **no** `icons/icon32.png`, and its
`manifest.json` has `action = {"default_popup": …}` with no `default_icon`. This is exactly the
work already queued for the Release Engineer in `tkt_9dc31de9` — no defect is filed here, but the
release rebuild must:
(1) add `icons/icon32.png` to the archive (16 → 17 entries) **and** ship the new 16/48/128 renders;
(2) **exclude** `tools/make_icons.py` (build tooling, not extension runtime) as it already excludes
`.verify/`, `tmp/` and the workspace documents.

### 8. QA-added files

All are inside the gitignored `.verify/` and `tmp/` scratch paths (`.gitignore`: `.verify/`, `/tmp/`), so
the source tree under review is untouched by QA — the only QA edit to a tracked file is this
`QA_REPORT.md` addendum:

| Path | Purpose |
|---|---|
| `.verify/qa_icons.py` | Independent PNG decoder + non-flat guard + previews (§2–§4) |
| `.verify/qa_manifest.py` | Manifest structure/path/permission checks vs HEAD (§5) |
| `.verify/decode_one.py` | Small helper used to decode the `HEAD` blobs for the negative control |
| `.verify/qa_icons.out`, `.verify/qa_manifest.out` | Captured output of the two runs above |
| `.verify/old_icons/icon{16,48,128}.png` | `git show HEAD:…` blobs, negative-control input |
| `tmp/qa_icons_repro/`, `tmp/out/` | Temp reproduction output (regenerated from a copy of the script) and node harness logs; the `tmp/neg/` manifest negative-control copy was deleted after the run |

### 9. Broader checks re-run after the change

The four existing `.verify` harnesses were re-run against the new manifest; all still pass and print
`all checks passed`:

| Harness | Exit |
|---|---|
| `node .verify/check_amo_manifest.js` | 0 |
| `node .verify/check_scope.js` | 0 |
| `node .verify/check_resource_types.js` | 0 |
| `node .verify/check_youtube_feed.js` | 0 |

### 10. Residual risks / not verified

* **No browser in this environment** (carried over from O4). Actual toolbar rendering — Firefox's
  pick of the 16/32 px asset when pinned, Chrome's HiDPI 32 px selection, and appearance against a
  light vs dark theme — is verified **statically only**. The manifest wiring is correct on paper and
  every referenced file exists in the tree; only a UI smoke test can confirm the pinned icon no
  longer looks like a green square.
* The packaged artifacts still contain the old icons until `tkt_9dc31de9` rebuilds them, so
  *installed-from-zip* users would still see the flat square in the meantime.
* `tools/make_icons.py` writes to `<repo>/icons` unconditionally (no `--out` flag). Running it in
  place is proven idempotent (identical sha256), so it cannot silently drift the committed PNGs, but
  it is a build step a contributor can trigger unintentionally.
* Legibility at 16 px is a judgement call recorded in §4: shield yes, block mark yes-but-coarse. If
  the mark were judged too small for store artwork, the design change would be a product decision,
  not a QA defect.

### 11. QA self-review

* **Diff reviewed:** `manifest.json` (one hunk, +8/−1), `README.md` (one line), three replaced PNGs
  (binary) and two new files (`icons/icon32.png`, `tools/make_icons.py`). Nothing else in the tree
  changed; no runtime source, rules, popup, options or lib file was touched.
* **No secrets, no debug output, no network code** in `make_icons.py`; the only output is the
  four `wrote …` progress lines on stdout.
* **No test was weakened:** the `HEAD` icon set still *fails* the flat-fill guard under the same
  code (§3), and the manifest checker was shown to fail on a bad path (§5).
* **Commands re-run after the last edit:** `python3 .verify/qa_icons.py .`,
  `python3 .verify/qa_manifest.py .`, the four `node .verify/check_*.js` harnesses, and the
  temp-dir reproduction; all recorded above with exit codes.

### 12. O5 status

**O5 — CLOSED (2026-11-24).** The placeholder flat `#1b5e20` set has been replaced by generated
shield artwork with a white block mark, at 16/32/48/128 px, wired through both `action.default_icon`
and top-level `icons`. No defect filed. The only open follow-up is the Release Engineer's artifact
rebuild (`tkt_9dc31de9`), which must add `icons/icon32.png` to the zip and exclude `tools/`.

---

## Addendum — 2026-11-24 — Whole-tile sponsored ad hiding (QA verification)

Ticket: `tkt_2f539c62-89ef-4849-a278-4e5c370d9231` (QA verification of whole-tile sponsored ad hiding)
Change under test: `tkt_51cb2776-2eb2-4f13-80bd-b7b598cdbf5a` (Developer, "Hide whole YouTube sponsored feed
tiles"), committed as `2a48baf Block sponsored tiles in youtube` (SafeBlock Release Engineer,
2026-11-24 19:19). The ticket assumed the change was an uncommitted working-tree edit; it is committed,
so `HEAD` **is** the post-change tree and the pre-change script is `HEAD~1`, not `HEAD` (see §2.2).
Environment: Linux, Node v22.23.5, Python 3.12.3, workspace `/home/agentroost/safeblock`.
Method: QA-owned harnesses in `.verify/` (gitignored). They boot the real
`lib/compat.js` + `lib/settings.js` + `content/youtube.js` chain in `node:vm` against a stub YouTube
tree, then **evaluate the injected stylesheet by real selector matching** (tag / `#id` / `.class` /
descendant), never by substring. The matcher *throws* on `:has(`, `>`, `+`, `~` and attribute selectors
instead of faking a match. **No browser is available in this environment, so nothing below is a
live-YouTube result.**

**Verdict: PASS on every check the ticket lists (1–7). FAIL on one extra probe the ticket does not
cover: the wrapper pass can hide first-party search results and shelves (DEF-1, High).**
The primary home-feed defect is genuinely fixed — the ad.jpg-shaped tile is now hidden at the outer
`ytd-rich-item-renderer`, so no empty grid cell is left — but the wrapper list also targets
container-level tags, and that can blank far more than one ad. See §3.

### 1. PASS/FAIL table

| # | Check (ticket item) | Command actually run | Observed output | Verdict |
|---|---|---|---|---|
| 1 | Stub tree models the required ad surfaces + negatives (home-feed ad tile, rich-section ad tile, watch `#secondary` promoted card, search promoted unit; normal video card, merch shelf, organic rich-section shelf, plain `#content` video) | `node .verify/qa_tiles_dom.js` | `PASS stub tree models the ticket's ad tiles and negative controls`; four `INFO … tile:` chain dumps (§2.1) | **PASS** |
| 2 | Stylesheet selectors matched for real (tag/id/class/descendant), not substrings; every expected ad rule present | `node .verify/qa_tiles_dom.js` | `PASS selector engine does real matching, not substring matching`; `INFO stylesheet rules: 17`; `PASS adBlocking=true injects one stylesheet that parses and covers every ad rule` | **PASS** |
| 3 | ad.jpg tile hidden **including its outer wrapper** (no leftover empty grid cell) | `node .verify/qa_tiles_dom.js` | `INFO ad-cell wrapper: marker=true hidden_by=".safeblock-hidden-tile"`; `PASS ad.jpg-shaped tile is hidden at the OUTER ytd-rich-item-renderer (no empty cell)` | **PASS** |
| 4 | `ytd-rich-section-renderer` ad tile hidden at the section level | `node .verify/qa_tiles_dom.js` | `INFO rich-section ad tile: marker=true hidden_by=".safeblock-hidden-tile"`; `PASS ytd-rich-section-renderer ad tile is hidden at the section level` | **PASS** |
| 5 | Watch `#secondary` + search promoted units hidden | `node .verify/qa_tiles_dom.js` | `INFO watch sidebar ad hidden_by="ytd-compact-promoted-video-renderer"`, `INFO search text ad hidden_by="ytd-promoted-sparkles-text-search-renderer"`; `PASS watch-page and search promoted units are hidden by their own rules` | **PASS** |
| 6 | Negative controls explicitly NOT hidden and not marked (normal video card, merch shelf, organic rich-section shelf, plain `#content` video, real `ytd-rich-grid-media` card) | `node .verify/qa_tiles_dom.js` | nine `INFO control …: hidden_by=null marker=false` lines + eight structural sweeps; `PASS negative controls are NOT hidden and carry no marker class` | **PASS** |
| 7 | Negative control **with teeth**: same harness against the pre-change script must fail | `node .verify/qa_tiles_dom.js --script .verify/old_youtube.js` | exit **1**, `8 check(s) failed`, incl. `outer ytd-rich-item-renderer (#ad-cell) has no safeblock-hidden-tile marker` (§2.2) | **PASS** (control fails as required) |
| 8 | Gating: `adBlocking=false` at boot → no style element, no `safeblock-hidden-tile` class | `node .verify/qa_tiles_dom.js` | `INFO off-boot: style=false markers=0 observers=0 timers=0 docListeners=0 windowListeners=0 storageListeners=1`; `PASS gating: adBlocking=false at boot …` | **PASS** |
| 9 | Gating: runtime toggle-off removes the style **and** strips the marker class from every wrapper | `node .verify/qa_tiles_dom.js` | `INFO toggle-off: pendingTimersBefore=1 pendingTimersAfter=0 style=false markers=0 observers connected=0 …`; `PASS gating: toggle off …` | **PASS** |
| 10 | Gating: toggle-on re-applies style + markers | `node .verify/qa_tiles_dom.js` | `INFO toggle-on: style=true markers=<ytd-rich-item-renderer id=ad-cell>,<ytd-rich-section-renderer id=rich-section-ad>,<ytd-item-section-renderer id=search-ad-section> …`; both toggle-on checks `PASS` | **PASS** |
| 11 | Hygiene: no new timers/polling vs HEAD; MutationObserver behaviour unchanged; `stop()` leaves no marker | `node .verify/qa_tiles_static.js`; `node .verify/qa_tiles_dom.js` | `setTimeout: new=1 pre-change=1`, `setInterval: new=0 pre-change=0`, `requestAnimationFrame: new=0 pre-change=0`; `PASS MutationObserver wiring is byte-identical…`; marker count 0 after `stop()` (§2.3, §2.1) | **PASS** |
| 12 | Static review: only `content/youtube.js` changed; no `eval`/`new Function`/remote fetch; no page-data logging; no first-party content selector in `HIDE_SELECTORS`; no `:has(` | `node .verify/qa_tiles_static.js` | `changed paths: ["content/youtube.js"]`; `eval/new Function: 0`, `fetch/…: 0`, `console.*: 0`; `PASS HIDE_SELECTORS contains no first-party content selector`; `PASS no :has( …` | **PASS** |
| 13 | **Extra probe (QA-added):** container-level wrapper tags must not hide first-party content that shares the container | `node .verify/qa_tiles_section_probe.js` | exit **1**; `FAIL P1 search … organic result is hidden (section marked: true)`; `FAIL P2 rich section … shelf … is hidden` (§2.4) | **FAIL — DEF-1 (High)** |
| 14 | Packaging state: zip / bundle vs post-change source | `python3 .verify/qa_tiles_artifacts.py` (exit 0 — the script compares and reports, it does not assert) | `RESULT: STALE -> zip content/youtube.js is stale; bundle refs/heads/main 331517e predates the change` (§2.5) | **FAIL — DEF-2 (Medium), DEF-3 (Low)** |
| 15 | Broader checks re-run after the change | `node .verify/check_scope.js`; `node .verify/check_resource_types.js`; `node .verify/check_amo_manifest.js`; `node .verify/check_youtube_feed.js`; `python3 -m json.tool` ×3; `node --check` ×10 | 8 / 12 / 6 / 8 PASS, all exit 0; JSON 3/3 exit 0; `node --check` 10/10 exit 0 (§2.6) | **PASS** |

### 2. Commands and verbatim output

#### 2.1 Main harness — `node .verify/qa_tiles_dom.js` (exit 0, 14 checks passed)

```
$ node .verify/qa_tiles_dom.js
script under test: content/youtube.js
INFO engine sanity: exact tag/#id/class/descendant match; lookalike tag, id text and class text do not
PASS selector engine does real matching, not substring matching
INFO ad.jpg tile: <html> > <body> > <ytd-app> > <ytd-page-manager> > <ytd-browse> > <ytd-two-column-browse-results-renderer> > <div id=primary> > <ytd-rich-grid-renderer> > <div id=contents> > <ytd-rich-item-renderer id=ad-cell>
INFO rich-section ad tile: <html> > <body> > <ytd-app> > <ytd-page-manager> > <ytd-browse> > <ytd-two-column-browse-results-renderer> > <div id=primary> > <ytd-rich-grid-renderer> > <div id=contents> > <ytd-rich-section-renderer id=rich-section-ad>
INFO watch sidebar ad: <html> > <body> > <ytd-app> > <ytd-page-manager> > <ytd-browse> > <ytd-two-column-browse-results-renderer> > <div id=secondary> > <ytd-compact-promoted-video-renderer id=watch-sidebar-ad>
INFO search text ad: <html> > <body> > <ytd-app> > <ytd-page-manager> > <ytd-search> > <div id=container> > <ytd-two-column-search-results-renderer> > <div id=primary> > <ytd-section-list-renderer> > <div id=contents> > <ytd-item-section-renderer id=search-ad-section> > <div id=contents> > <ytd-promoted-sparkles-text-search-renderer id=search-text-ad>
INFO control normal video card: <html> > <body> > <ytd-app> > <ytd-page-manager> > <ytd-browse> > <ytd-two-column-browse-results-renderer> > <div id=primary> > <ytd-rich-grid-renderer> > <div id=contents> > <ytd-rich-item-renderer id=fp-video-1> > <div id=content> > <ytd-video-renderer id=fp-video-renderer>
INFO control merch shelf: <html> > <body> > <ytd-app> > <div id=below> > <ytd-watch-metadata> > <div id=merch-shelf> > <ytd-merch-shelf-renderer id=merch-shelf-renderer>
INFO control ordinary rich-section shelf: <html> > <body> > <ytd-app> > <ytd-page-manager> > <ytd-browse> > <ytd-two-column-browse-results-renderer> > <div id=primary> > <ytd-rich-grid-renderer> > <div id=contents> > <ytd-rich-section-renderer id=rich-section-organic> > <div id=content> > <ytd-shelf-renderer id=organic-shelf>
INFO control plain #content video: <html> > <body> > <ytd-app> > <ytd-page-manager> > <ytd-search> > <div id=container> > <ytd-two-column-search-results-renderer> > <div id=primary> > <ytd-section-list-renderer> > <div id=contents> > <ytd-item-section-renderer id=search-organic-section> > <div id=contents> > <ytd-video-renderer id=search-organic-1>
PASS stub tree models the ticket's ad tiles and negative controls
INFO stylesheet rules: 17
PASS adBlocking=true injects one stylesheet that parses and covers every ad rule
INFO ad-cell wrapper: marker=true hidden_by=".safeblock-hidden-tile"
INFO ad-cell inner: ad-slot hidden_by="ytd-ad-slot-renderer" in-feed hidden_by="ytd-in-feed-ad-layout-renderer" sparkles hidden_by="ytd-promoted-sparkles-web-renderer" img hidden_by="ytd-promoted-sparkles-web-renderer"
PASS ad.jpg-shaped tile is hidden at the OUTER ytd-rich-item-renderer (no empty cell)
INFO rich-section ad tile: marker=true hidden_by=".safeblock-hidden-tile"
PASS ytd-rich-section-renderer ad tile is hidden at the section level
INFO watch sidebar ad hidden_by="ytd-compact-promoted-video-renderer"
INFO search text ad hidden_by="ytd-promoted-sparkles-text-search-renderer"
INFO masthead ad hidden_by="#masthead-ad"
INFO player-ads hidden_by="#player-ads"
PASS watch-page and search promoted units are hidden by their own rules
INFO control ordinary grid video card (ytd-rich-item-renderer): hidden_by=null marker=false
INFO control ordinary video renderer: hidden_by=null marker=false
INFO control real grid card (ytd-rich-item-renderer > #content > ytd-rich-grid-media): hidden_by=null marker=false
INFO control merch shelf: hidden_by=null marker=false
INFO control rich-section holding an ordinary shelf: hidden_by=null marker=false
INFO control ordinary shelf: hidden_by=null marker=false
INFO control shelf's own grid cell: hidden_by=null marker=false
INFO control plain ytd-video-renderer in a #content: hidden_by=null marker=false
INFO control second plain video: hidden_by=null marker=false
INFO control watch page related video: hidden_by=null marker=false
INFO sweep <ytd-video-renderer>: 3 element(s), none matched by a rule
INFO sweep <ytd-merch-shelf-renderer>: 1 element(s), none matched by a rule
INFO sweep <ytd-rich-grid-media>: 1 element(s), none matched by a rule
INFO sweep <ytd-shelf-renderer>: 1 element(s), none matched by a rule
INFO sweep <ytd-compact-video-renderer>: 1 element(s), none matched by a rule
INFO sweep <ytd-rich-grid-renderer>: 1 element(s), none matched by a rule
INFO sweep #content: 5 element(s), none matched by a rule
INFO sweep #primary: 2 element(s), none matched by a rule
INFO sweep #related: 1 element(s), none matched by a rule
INFO sweep #items: 1 element(s), none matched by a rule
INFO marker set: ["<ytd-rich-item-renderer id=ad-cell>","<ytd-rich-section-renderer id=rich-section-ad>","<ytd-item-section-renderer id=search-ad-section>"]
PASS negative controls are NOT hidden and carry no marker class
INFO observer target=<div id=movie_player> options={"childList":true,"subtree":true,"attributes":true,"attributeFilter":["class"]}
PASS observer behaviour: one observer on #movie_player, childList+subtree+attributes[class]
INFO console calls during coverage scenario: 0
PASS no console output anywhere during the run (no page-data logging)
INFO marker class writes during boot pass: 3
INFO flush #1 deliveries=1 timers created=1 delay=250
INFO class writes after the debounced pass: 3 (boot 3)
INFO flush #2 deliveries=0 timers created=1
PASS feedback loop settles: a mutation pass converges and creates no further timers
INFO off-boot: style=false markers=0 observers=0 timers=0 docListeners=0 windowListeners=0 storageListeners=1
INFO toggle-on: style=true markers=<ytd-rich-item-renderer id=ad-cell>,<ytd-rich-section-renderer id=rich-section-ad>,<ytd-item-section-renderer id=search-ad-section> observers=1 docListeners=1 windowListeners=1
PASS gating: toggle on -> style + markers + observer + nav listeners return
INFO toggle-off: pendingTimersBefore=1 pendingTimersAfter=0 style=false markers=0 observers connected=0 docListeners=0 windowListeners=0
PASS gating: toggle off -> style removed AND marker class stripped from every wrapper
INFO toggle-on#2: style=true markers=<ytd-rich-item-renderer id=ad-cell>,<ytd-rich-section-renderer id=rich-section-ad>,<ytd-item-section-renderer id=search-ad-section>
PASS gating: toggle on again -> style and markers restored
PASS gating: adBlocking=false at boot -> no style, no marker, no observer, no timer

14 checks passed
[exit code: 0]
```

What this proves, check by check:

* **Outer wrapper, not just the inner renderer.** `#ad-cell` (`ytd-rich-item-renderer`) carries the
  marker and is itself matched by `.safeblock-hidden-tile { display: none !important; }`, so the grid
  cell collapses and no empty tile is left. The inner `ytd-ad-slot-renderer`,
  `ytd-in-feed-ad-layout-renderer`, `ytd-promoted-sparkles-web-renderer` and the `img` inside it are all
  hidden as well, so the card cannot paint either way.
* **Rich-section tile.** `#rich-section-ad` (`ytd-rich-section-renderer`) is marked and hidden.
  The marker set is exactly three ad-only wrappers: `#ad-cell`, `#rich-section-ad`, and the search text
  ad's own ad-only `ytd-item-section-renderer` (`#search-ad-section`). Nothing else in the tree is
  marked.
* **Negative controls.** Nine controls (ordinary grid cell + `ytd-video-renderer` card, a real
  `ytd-rich-grid-media` card, merch shelf, organic rich-section + shelf, shelf's own cell, both search
  organic results, watch-page related video) report `hidden_by=null marker=false`. Structural sweeps
  over `<ytd-video-renderer>` (3), `<ytd-merch-shelf-renderer>` (1), `<ytd-rich-grid-media>` (1),
  `<ytd-shelf-renderer>` (1), `<ytd-compact-video-renderer>` (1), `<ytd-rich-grid-renderer>` (1) and the
  ids `#content` (4), `#primary` (2), `#related`, `#items` confirm **no injected rule matches any of
  them** — this is a tree sweep, not a re-statement of the selector list.
* **Idempotent marking.** Boot writes the marker class exactly 3 times, one per ad wrapper; the
  debounced pass that follows the marking mutations writes **zero** further classes, and a second
  mutation flush after settling delivers 0 records and creates 0 timers. The observer feedback loop
  dies out instead of spinning.
* **Gating.** Off at boot: no style, no marker, no observer, no timer, no nav listener, one passive
  `storage.onChanged` listener (by design). Toggle on: style + three markers + observer + both nav
  listeners return. Toggle off: style gone (`<head>` emptied), **0** elements still carrying
  `safeblock-hidden-tile`, observer disconnected, both nav listeners detached, pending 250 ms debounce
  timer cleared.

#### 2.2 Negative control with teeth — `node .verify/qa_tiles_dom.js --script .verify/old_youtube.js` (exit 1; excerpt — the trailing summary repeats the failures)

The pre-change script had to be taken from `HEAD~1`: the ticket's literal
`git show HEAD:content/youtube.js` now returns the **post-change** file because the change is committed.

```
$ git show HEAD:content/youtube.js | sha256sum; sha256sum content/youtube.js
44008004ff5d2cc9b4c516bd57c9811de2ffbde20462ffc141b1217aefb71fb3  -
44008004ff5d2cc9b4c516bd57c9811de2ffbde20462ffc141b1217aefb71fb3  content/youtube.js

$ git show HEAD~1:content/youtube.js > .verify/old_youtube.js   # 322 lines, 678242a5…
$ node .verify/qa_tiles_dom.js --script .verify/old_youtube.js
FAIL adBlocking=true injects one stylesheet that parses and covers every ad rule - stylesheet is missing ad rules: ytd-compact-promoted-video-renderer, ytd-promoted-sparkles-text-search-renderer, ytd-search-pyv-renderer
FAIL ad.jpg-shaped tile is hidden at the OUTER ytd-rich-item-renderer (no empty cell) - outer ytd-rich-item-renderer (#ad-cell) has no safeblock-hidden-tile marker
FAIL ytd-rich-section-renderer ad tile is hidden at the section level - outer ytd-rich-section-renderer (#rich-section-ad) has no marker
FAIL watch-page and search promoted units are hidden by their own rules - ytd-compact-promoted-video-renderer is not hidden
FAIL negative controls are NOT hidden and carry no marker class - #ad-cell (feed ad tile) missing from marker set
FAIL feedback loop settles: a mutation pass converges and creates no further timers - marked tiles produced no observable mutation - the flush is vacuous
FAIL gating: toggle on -> style + markers + observer + nav listeners return - expected 3 marked ad-only wrappers after toggle-on, got 0
FAIL gating: toggle on again -> style and markers restored - expected 3 marked ad-only wrappers after second toggle-on, got 0
8 check(s) failed
[exit code: 1]
```

Key evidence that the old script leaves the outer tile visible:

```
INFO stylesheet rules: 13
INFO ad-cell wrapper: marker=false hidden_by=null
INFO rich-section ad tile: marker=false hidden_by=null
INFO marker set: []
```

The same harness therefore distinguishes the two scripts: green (exit 0) on `HEAD`, red (exit 1, 8
failures) on `HEAD~1`. The negative control is not vacuous, and the old script reproduces the reported
bug (outer wrapper visible ⇒ blank grid cell).

#### 2.3 Static review — `node .verify/qa_tiles_static.js` (exit 0, 10 checks passed)

```
HIDE_SELECTORS (16): ["#player-ads",".ytp-ad-overlay-container","ytd-display-ad-renderer",".ytp-ad-module","ytd-ad-slot-renderer","ytd-in-feed-ad-layout-renderer","ytd-promoted-sparkles-web-renderer","ytd-promoted-video-renderer","ytd-compact-promoted-video-renderer","ytd-promoted-sparkles-text-search-renderer","ytd-search-pyv-renderer","ytd-companion-slot-renderer","ytd-banner-promo-renderer","ytd-statement-banner-renderer","ytd-brand-video-shelf-renderer","#masthead-ad"]
TILE_WRAPPER_TAGS (4): ["ytd-rich-item-renderer","ytd-rich-section-renderer","ytd-rich-grid-media","ytd-item-section-renderer"]
INFO changed paths: ["content/youtube.js"]
INFO diffstat: content/youtube.js | 153 +++++++++++++++++++++++++++++++++++++++++++++++++++--
 1 file changed, 150 insertions(+), 3 deletions(-)
PASS only content/youtube.js changed between HEAD~1 and HEAD
INFO eval/new Function occurrences: 0
PASS no eval / new Function / dynamic code in content/youtube.js
INFO fetch/XMLHttpRequest/WebSocket/importScripts/sendBeacon occurrences: 0
PASS no remote fetch or network API in content/youtube.js
INFO console.* occurrences: 0
PASS no console logging of page data
INFO forbidden selectors ["ytd-video-renderer","ytd-merch-shelf-renderer","ytd-rich-grid-media","*"] absent from HIDE_SELECTORS
PASS HIDE_SELECTORS contains no first-party content selector
INFO :has( occurrences: 0; 4 wrapper tags are collapsed in JS instead
PASS no :has( parent selector anywhere in the file
INFO setTimeout: new=1 pre-change=1
INFO setInterval: new=0 pre-change=0
INFO requestAnimationFrame: new=0 pre-change=0
INFO clearTimeout: new=1 pre-change=1
INFO clearInterval: new=0 pre-change=0
INFO DEBOUNCE_MS: 250
PASS no new timers or polling versus the pre-change script
INFO addEventListener(: new=0 pre-change=0
INFO removeEventListener(: new=0 pre-change=0
INFO document/window[method]( registration site: new=2 pre-change=2
INFO yt-navigate-finish listener: new=1 pre-change=1
INFO popstate listener: new=1 pre-change=1
INFO storage.onChanged.addListener: new=2 pre-change=2
PASS no new event listeners versus the pre-change script
INFO observe options: childList: true, subtree: true, attributes: true, attributeFilter: ["class"]
PASS MutationObserver wiring is byte-identical to the pre-change script
INFO node --check content/youtube.js: exit 0
PASS content/youtube.js still parses (node --check)

10 static checks passed
[exit code: 0]
```

Diff shape: 150 insertions, 3 deletions in one file — marker plumbing (`hasTileMarker`/`addTileMarker`/
`removeTileMarker`/`isTileWrapper`/`nearestTileWrapper`/`containsAdRenderer`/`hideAdTiles`/
`stripTileMarkers`), the `TILE_*` constants, three added `HIDE_SELECTORS` entries, the `STYLE_SELECTORS`
rule list, one `hideAdTiles()` call in `runChecks()`, `stripTileMarkers()` in `stop()`, and comments.
No dead code, no debug output, no unrelated refactor, no new timer, interval, `requestAnimationFrame`,
listener or observer option.

#### 2.4 Extra probe — `node .verify/qa_tiles_section_probe.js` (exit 1; excerpt — the trailing summary repeats the two failures)

```
INFO section: <html> > <body> > <ytd-app> > <ytd-page-manager> > <ytd-search> > <div id=container> > <ytd-two-column-search-results-renderer> > <div id=primary> > <ytd-section-list-renderer> > <div id=contents> > <ytd-item-section-renderer id=search-mixed-section>
INFO ad hidden_by="ytd-promoted-sparkles-text-search-renderer"
INFO organic result <ytd-video-renderer id=search-organic-1>: hidden_by=".safeblock-hidden-tile" marker_on_section=true
INFO organic result <ytd-video-renderer id=search-organic-2>: hidden_by=".safeblock-hidden-tile" marker_on_section=true
FAIL P1 search: promoted ad hidden without hiding the organic results in the same section - first-party organic result <ytd-video-renderer id=search-organic-1> is hidden (section marked: true)
INFO section: <html> > <body> > <ytd-app> > <ytd-page-manager> > <ytd-browse> > <ytd-two-column-browse-results-renderer> > <div id=primary> > <ytd-rich-grid-renderer> > <div id=contents> > <ytd-rich-section-renderer id=rich-section-ad>
INFO organic shelf hidden_by=".safeblock-hidden-tile" section marker=true
FAIL P2 rich section: ad tile hidden without hiding an organic shelf in the same section - first-party shelf in the same rich section is hidden (section marked: true)
INFO P3 ad anchor nested inside ytd-rich-grid-media:
INFO   marker on ytd-rich-grid-media=true
INFO   outer ytd-rich-item-renderer hidden_by=null
DEMONSTRATED P3: the walk stops at ytd-rich-grid-media, so the outer grid cell is left visible (blank cell)

2 probe case(s) failed
[exit code: 1]
```

#### 2.5 Packaging state — `python3 .verify/qa_tiles_artifacts.py` (exit 0, reported STALE)

```
source content/youtube.js: bytes=13934 sha256=44008004ff5d2cc9b4c516bd57c9811de2ffbde20462ffc141b1217aefb71fb3
source has hideAdTiles(): True | has safeblock-hidden-tile: True
zip content/youtube.js: bytes=8713 sha256=678242a5df6ddaddbabeb7be9d4e8c2c9a2604b4fb10525b7a60f3000625f61d
zip has hideAdTiles(): False | has safeblock-hidden-tile: False
zip matches source: False
zip other entries: compared=17 mismatching=['content/youtube.js', 'manifest.json']
bundle heads: 331517e8bf98fd30009d0f2d24e88c617952ff85 refs/heads/main
bundle refs/heads/main: 331517e8bf98fd30009d0f2d24e88c617952ff85
bundle main:content/youtube.js: bytes=8713 sha256=678242a5df6ddaddbabeb7be9d4e8c2c9a2604b4fb10525b7a60f3000625f61d
bundle has hideAdTiles(): False
bundle matches source: False

RESULT: STALE -> zip content/youtube.js is stale; bundle refs/heads/main 331517e predates the change
[exit code: 0]
```

The zip entry and the bundle's `main` are byte-identical to the **pre-change** script
(`678242a5…`, 8713 bytes = `HEAD~1`'s file), i.e. the whole-tile fix is absent from both. The zip also
predates the change (19:11 vs. source 19:19) and the bundle's `refs/heads/main` is two commits behind
`HEAD` (`331517e` = `HEAD~2`).

#### 2.6 Broader checks re-run after the change

```
$ node .verify/check_scope.js            -> exit 0 (8 PASS lines)
$ node .verify/check_resource_types.js   -> exit 0 (12 PASS lines)
$ node .verify/check_amo_manifest.js     -> exit 0 (6 PASS lines)
$ node .verify/check_youtube_feed.js     -> exit 0 (8 PASS lines)
$ python3 -m json.tool manifest.json rules/ads_trackers.json rules/adult_filter.json  -> 3/3 exit 0
$ node --check content/youtube.js lib/compat.js lib/settings.js lib/rules.js popup/popup.js \
    options/options.js .verify/qa_tiles_lib.js .verify/qa_tiles_dom.js \
    .verify/qa_tiles_static.js .verify/qa_tiles_section_probe.js   -> 10/10 exit 0
```

(The Developer's `.verify/dev_youtube_tile.js` was **not** used as evidence; it is not part of the
results above.)

### 3. Defects

Numbered within this addendum.

| ID | Severity | File:line | Problem | Evidence | Fix |
|---|---|---|---|---|---|
| **DEF-1** | **High** (browser-unverified) | `content/youtube.js:54-59` (`TILE_WRAPPER_TAGS`), `:255-266`, `:268-277`, `:282-293` | The wrapper walk stops at the *nearest* tag in `TILE_WRAPPER_TAGS`, which includes two **container** tags: `ytd-item-section-renderer` (search-results list) and `ytd-rich-section-renderer`. `containsAdRenderer()` keeps the marker whenever the container holds any ad renderer, so a container that holds an ad **and** first-party items is hidden in full. | `node .verify/qa_tiles_section_probe.js` → `FAIL P1` (organic search results hidden) and `FAIL P2` (organic shelf hidden), exit 1 | Drop the container tags, or only mark a container when it contains no first-party content (`ytd-video-renderer`, `ytd-rich-grid-media`, `ytd-compact-video-renderer`, `ytd-shelf-renderer`). Filed as `tkt_582388e8-6c7d-404a-8120-3de46005d079` (Developer, High). |
| **DEF-2** | Medium | `safeblock-extension.zip` → `content/youtube.js:26-70` | Distributable zip still ships the pre-change `content/youtube.js`: no `hideAdTiles()`, no `TILE_MARKER_CLASS`, no marker rule, three missing ad selectors. Installers get no whole-tile fix at all. | §2.5 (`zip matches source: False`, sha `678242a5…` = `HEAD~1`) | Rebuild the zip from the post-change tree and verify the entry sha256 equals `44008004…`. Covered by `tkt_a4e5d20e-c281-417d-b734-b511c3869804` (Release Engineer). |
| **DEF-3** | Low | `safeblock-main.bundle` → `refs/heads/main 331517e` | Git bundle points at `HEAD~2` and carries the old 8713-byte script. It becomes correct as soon as a bundle is rebuilt from the post-change history. | §2.5 (`bundle main:content/youtube.js sha256: 678242a5…`) | Rebuild the bundle from `main` after the change; verify `git show refs/heads/main:content/youtube.js` sha256 is `44008004…`. Same ticket as DEF-2. |

Not a defect, but recorded because the artifact check surfaced it: the zip's `manifest.json` is
`"version": "0.1.0"` while the working tree now says `0.1.1`. The working tree change
(`M manifest.json`, one line, unstaged, mtime 19:25) appeared **during** this verification and was
**not** made by QA — see §7. It is outside the change under test and does not affect any verdict here.

### 4. Firefox-113 reasoning for avoiding `:has(` — I agree

`manifest.json` declares `browser_specific_settings.gecko.strict_min_version = "113.0"` (verified with
`node -e 'const m=require("./manifest.json"); …'`), and `:has()` only shipped in Firefox 121. On
Firefox 113–120 the whole rule containing `:has(...)` is dropped by the CSS parser, so a
`:has()`-based collapse would not degrade to "hides the inner card but leaves the cell" — it would
not hide anything at all on those versions. The JS walk plus a class-based rule has no such cliff, and
the cost is bounded (`MAX_WRAPPER_DEPTH = 16`, one anchor query per selector, measured 3 class writes at
boot and 0 on the following pass). The comment at `content/youtube.js:186-193` is accurate.

The trade-off I would flag is not Firefox support but *which* tags the walk may stop at — that is DEF-1.

### 5. Residual risks / not verified

1. **No browser, no live YouTube.** Every statement above comes from a stub tree modeled on the
   renderer names in the ticket and in `content/youtube.js`. Shadow DOM, renamed tags, attribute-level
   selectors and real ad markup variants were not exercised. A Chrome + Firefox smoke test on the home
   feed, a watch page and `youtube.com/results` is still required.
2. **DEF-1's real-world trigger is unverified.** The stub shows the mechanism (a container with an ad
   plus first-party items is hidden wholesale). Whether live YouTube really puts the search promoted
   unit in the same `ytd-item-section-renderer` as the organic results needs a live check; if it does,
   the symptom is "all search results disappear", which is worse than the ad it fixes.
3. **`ytd-rich-grid-media` in `TILE_WRAPPER_TAGS`** (probe P3): if an ad anchor is ever nested inside a
   real grid card, the walk stops at the card and the outer `ytd-rich-item-renderer` cell stays
   visible — the exact blank-cell symptom this change fixes. Low severity (markup-dependent), included
   in DEF-1's ticket.
4. **Marker pruning depends on a pass being scheduled.** A recycled `ytd-rich-item-renderer` is
   un-marked by the next `hideAdTiles()` pass, and the observer watches `#movie_player` when it exists
   (else `<body>`), so on a page with a player, feed mutations are not what triggers the pass. Verified
   only in the stub; a stale marker would show as a hidden first-party tile.
5. **`ytd-banner-promo-renderer` / `ytd-statement-banner-renderer` / `ytd-brand-video-shelf-renderer`**
   can carry YouTube's own (non-paid) promos. That predates this change and matches the earlier
   ticket's requested list; still a product trade-off.
6. **One passive `storage.onChanged` listener** stays registered while ad blocking is off, by design.
   Everything else is detached by `stop()` (verified in §2.1).
7. **Artifacts** (DEF-2/DEF-3) are stale; QA did not rebuild them.

### 6. Acceptance criteria mapping

1. Dated addendum with one PASS/FAIL row per check and the exact command — **met** (§1, 15 rows).
2. Stub evidence that the ad.jpg tile is hidden at the outer `ytd-rich-item-renderer` and that the
   `ytd-rich-section-renderer` ad tile is likewise — **met** (§2.1: `marker=true
   hidden_by=".safeblock-hidden-tile"` for both, plus inner-renderer proof).
3. Negative controls explicitly shown NOT hidden — **met** (§2.1: nine `hidden_by=null marker=false`
   controls and eight structural sweeps).
4. Negative-control run against the pre-change script fails — **met** (§2.2: exit 1, 8 failures, outer
   wrapper visible in the old script). Note the command uses `HEAD~1`, not `HEAD`, and §2.2 shows why.
5. Gating rows (off at boot; toggle off strips style **and** markers; toggle on restores both) —
   **met** (§2.1, rows 8–10).
6. Artifact staleness stated as a defect with severity, and the recommendation distinguishes source
   from artifacts — **met** (§3 DEF-2/DEF-3; §8).
7. Every quoted command was actually run with its exit code; nothing unrun is marked PASS — **met**;
   the browser smoke test is listed as *not verified* (§5.1) rather than as a pass.

### 7. QA self-review

* **Tracked files changed by QA:** `QA_REPORT.md` only (this addendum). `content/youtube.js`,
  `manifest.json`, `rules/*`, `popup/*`, `options/*` were **not** touched by QA.
* **Out-of-scope working-tree change present during this run:** `git status --porcelain` shows
  ` M manifest.json` — a one-line unstaged `"version": "0.1.0"` → `"0.1.1"` bump with mtime 19:25,
  which appeared while this verification was running and was not authored by QA. It is left untouched
  and is unrelated to the change under test (`git diff HEAD~1 HEAD` still contains only
  `content/youtube.js`). Whoever owns it must fold it into the Release Engineer rebuild, or the
  artifact version will not match the manifest.
* **QA-added files (all gitignored scratch):** `.verify/qa_tiles_lib.js` (stub DOM + real selector
  matcher + tree fixtures), `.verify/qa_tiles_dom.js` (main harness), `.verify/qa_tiles_static.js`
  (static review), `.verify/qa_tiles_section_probe.js` (DEF-1 probe), `.verify/qa_tiles_artifacts.py`
  (artifact comparison), plus `.verify/old_youtube.js`, `.verify/zip_manifest.json` and the
  `out_*.txt` captures.
* **Reproduction, in order:**
  `node .verify/qa_tiles_dom.js` (expect exit 0);
  `git show HEAD~1:content/youtube.js > .verify/old_youtube.js && node .verify/qa_tiles_dom.js --script .verify/old_youtube.js`
  (expect exit 1);
  `node .verify/qa_tiles_static.js` (expect exit 0);
  `node .verify/qa_tiles_section_probe.js` (expect exit 1 — DEF-1);
  `python3 .verify/qa_tiles_artifacts.py` (expect `RESULT: STALE`).
* **Self-review of my own harness:** the matcher refuses `:has(`/`>` instead of faking a match; the
  flush is proven non-vacuous (`assert(deliveries >= 1, …)`, which is exactly the assertion that fails
  on the old script); the negative-control run is green on `HEAD` and red on `HEAD~1`; the
  `ytd-item-section-renderer` sweep entry was removed from the *first-party* list only because that tag
  is an intentional wrapper target (its behaviour is covered by DEF-1 instead). One harness bug was
  found and fixed during this run: `content/youtube.js` was being evaluated twice per env, which
  double-counted observers and listeners; after the fix the counts are 1 observer / 1 storage listener.

### 8. Recommendation

* **Source change (`content/youtube.js` @ `2a48baf`): PASS on the requested behaviour, but DO NOT SHIP
  as-is.** The whole-tile fix works for the ad.jpg home-feed case and for the rich-section ad tile; all
  seven requested checks pass and the negative control fails on the old script as required. However
  DEF-1 (High) means the same pass can hide first-party search results and shelves. It is a small,
  local fix (`tkt_582388e8-6c7d-404a-8120-3de46005d079`) — do it before this reaches users.
* **Packaged artifacts: DO NOT SHIP.** `safeblock-extension.zip` (DEF-2, Medium) and
  `safeblock-main.bundle` (DEF-3, Low) still contain the pre-change 8713-byte script; the whole-tile fix
  is simply not in them. Rebuild after DEF-1 is fixed, under
  `tkt_a4e5d20e-c281-417d-b734-b511c3869804`, and re-run
  `python3 .verify/qa_tiles_artifacts.py` until it prints `RESULT: MATCH`.
* **Not a ship gate, but required before release:** the manual Chrome + Firefox smoke test on the home
  feed, a watch page and `youtube.com/results` (this environment cannot run it).
