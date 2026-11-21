# SafeBlock — Security & privacy review

Ticket: `tkt_e015c4c3-59c4-4327-998e-63f56c8550c7` (security review)
Reviewer: Security Reviewer (rampart) · Date: 2026-11-21 · Workspace: `/home/agentroost/safeblock`
Scope: the finished tree at the workspace root — `manifest.json`, `lib/`, `content/`, `popup/`, `options/`, `rules/`, `icons/`.
Method: **read-only static review**. No shell commands were executed by the reviewer and no file in the tree was
modified. Evidence is quoted from the files as they exist in the tree; every claim that would need a browser to
prove is labelled **unverified**.

## Verdict

**CHANGES REQUIRED** — one high-severity least-privilege finding (H1) that must be fixed before release, plus one
medium and three low findings. **No data-exfiltration path, no remote code, and no credential or secret exposure was
found**; the extension makes no outbound network requests of its own.

Counts by severity: **critical 0 · high 1 · medium 1 · low 3 · info 6**

| Severity | Finding | Status |
|---|---|---|
| High | H1 — `<all_urls>` content script gives effective read/modify access to every site for a no-op script | new ticket `tkt_2dd3aad3` |
| Medium | M1 — `lib/settings.js` injected twice on YouTube → uncaught `SyntaxError` per page load | already tracked (`tkt_6d3b1c06`) |
| Low | L1 — DNR `resourceTypes` omit `ping`/`object`/`other`, so `sendBeacon` tracking is not blocked | new ticket `tkt_ebe084c1` |
| Low | L2 — over-broad filter `||facebook.com/tr` blocks legitimate Facebook navigation | already tracked (`tkt_41e32719`) |
| Low | L3 — adult filter blocks whole domains with no per-site bypass; mixed-use domains are false positives | recommendation (below) |

## 1. Entry points reviewed

| Entry point | Location | Trust boundary |
|---|---|---|
| Manifest permission/registration surface | `manifest.json` | install-time privilege, store review |
| Content script (YouTube) | `content/youtube.js` (registered `manifest.json:24-36`) | untrusted page DOM |
| Content script (`<all_urls>`) | `content/adult.js` (registered `manifest.json:37-47`) | untrusted page DOM, **every site** |
| Popup UI | `popup/popup.html`, `popup/popup.js` | extension context, local input only |
| Options UI | `options/options.html`, `options/options.js` | extension context, local input only |
| Shared settings store | `lib/settings.js` (`browser.storage.local`) | extension-private storage |
| Ruleset control | `lib/rules.js` (`updateEnabledRulesets`) | extension context |
| Static DNR rulesets | `rules/ads_trackers.json` (109 rules), `rules/adult_filter.json` (181 rules) | network layer |

There is **no** background page/service worker, no native messaging, no `externally_connectable`, no
`web_accessible_resources`, and no filesystem or shell access anywhere in the extension.

## 2. Checklist results

| # | Check | Result |
|---|---|---|
| 1 | Permissions minimal | **PASS for `permissions[]` / FAIL for effective access** — see H1 |
| 2 | No remote code (eval / `new Function` / remote scripts / inline handlers) | **PASS** |
| 3 | Injection safety (no untrusted selectors/HTML; `innerHTML` absent) | **PASS** |
| 4 | Data handling / privacy (no network, no telemetry, no logging, boolean-only settings) | **PASS**, with I1/I4 notes |
| 5 | Content script hygiene (matches, API guards, no page-reachable globals) | **PASS**, with M1 and H1 |
| 6 | Supply chain / build (no bundles, no node_modules, static lists) | **PASS** |
| 7 | DNR correctness/risk (unique ids, no over-broad filters, no first-party blocking) | **PASS with 1 defect (L2)**, plus L1 |
| 8 | Adult filter gating (ships disabled, opt-in only, needs a settings write) | **PASS** |

## 3. Findings

### Critical

None.

### High

#### H1 — The `<all_urls>` content script grants effective read/modify access to every website for a script that does nothing

* **Evidence:** `manifest.json:37-47` registers a second `content_scripts` entry with `"matches": ["<all_urls>"]`
  loading `lib/compat.js`, `lib/settings.js`, `content/adult.js` at `document_idle`. The referenced script performs
  no DOM work at all: after the settings read it short-circuits on `settings.adultFilter !== true`
  (`content/adult.js:31-33`) and the "filter is on" branch is a comment with no statements
  (`content/adult.js:34-36`). Blocking is done entirely at the network layer by `rules/adult_filter.json`, which
  needs **no** content script.
* **Why it matters:** match patterns in `content_scripts` give the extension the run-time ability to read and modify
  the DOM of *every* top-level page (`http`, `https`, and `file` where the user allows file access) and drive the
  broadest install/update host-access warning in both Chrome and Firefox. That is strictly more privilege than the
  product design states ("content/youtube.js content script on YouTube"; adult filter as an opt-in DNR ruleset). It
  also means the extension runs in the isolated world of banking, health and webmail pages, one storage read per page
  load, for zero feature value. A future change to this file silently inherits access to every site — the
  least-privilege failure is permanent, not incidental.
* **Reachability:** every top-level page load, for every user, on both browsers.
* **Impact today:** privilege scope and user-visible permission warnings, not data theft — no code path in the tree
  reads page content, and there is no network primitive to send it anywhere. Recorded as high because it is a release
  gate ("permissions minimal") and a store-review trust issue, not because an exploit exists.
* **Remediation (preferred, smallest):** delete the whole second entry (`manifest.json:37-47`) and delete
  `content/adult.js`. This also removes M1 (see below) and the per-page storage read. If a page-level guard is
  genuinely wanted later, ship it as an explicit opt-in: declare no static match patterns, request
  `optional_host_permissions`, and register the script with `chrome.scripting.registerContentScripts` only after the
  user confirms — so the extension has no access to any site until the user asks for it.
* **Proof to run after the fix:** reload unpacked in Chrome → extension details should show no "read and change all
  your data on websites you visit" warning, and `chrome://extensions` should list a single content script for
  `youtube.com`; on Firefox, `about:addons` → Permissions should list no host access. Then confirm adult blocking still
  works by enabling the toggle and loading a domain from `rules/adult_filter.json`.

### Medium

#### M1 — Shared library injected twice on YouTube throws an uncaught `SyntaxError` on every page load

* **Evidence:** both `content_scripts` entries list `lib/compat.js` and `lib/settings.js` (`manifest.json:30-34` and
  `manifest.json:41-45`). `lib/settings.js:3` declares a top-level `const DEFAULT_SETTINGS`, so the second evaluation
  in the same isolated world aborts with `SyntaxError: Identifier 'DEFAULT_SETTINGS' has already been declared`.
  `content/youtube.js:298-300` then silently no-ops if `getSettings` is not a function, and `content/adult.js:17-19`
  does the same.
* **Impact:** functionality survives only because the first evaluation's `getSettings` remains in scope — i.e. the two
  content scripts work by accident of injection order. This is a reliability defect with a security edge: the failure
  is silent (no logging by design), so a broken guard looks identical to a working one.
* **Status:** already tracked as D1 in `QA_REPORT.md` and filed as
  `tkt_6d3b1c06-6701-407b-9d3e-bee582f4c280` (Developer, Backlog). **No duplicate ticket filed.** Removing the
  `<all_urls>` entry per H1 fixes it; the alternative is making `lib/compat.js` and `lib/settings.js` re-entrant
  (assign `self.getSettings` / `self.setSettings` only when undefined) or merging the entries.

### Low

#### L1 — DNR `resourceTypes` omit `ping`, `object`, `other`: beacon tracking bypasses the ruleset

* **Evidence:** every rule uses the same five types — `main_frame`, `sub_frame`, `script`, `image`, `xmlhttprequest` —
  e.g. `rules/ads_trackers.json:9-18` and `rules/adult_filter.json:9-18` (109 + 181 rules).
  `navigator.sendBeacon()` and `<a ping>` are typed `ping` by Chromium's DNR resource classification, and
  `<object>`/`<embed>` loads are typed `object`; neither is covered, so a tracker that beacons rather than issues XHR
  is not blocked even when its domain is in the list.
* **Reachability:** any third-party script on any page that uses `sendBeacon` to a listed tracker domain.
* **Impact:** advertising/tracking coverage gap; no privilege escalation.
* **Remediation:** add `"ping"`, `"object"` and `"other"` to the `resourceTypes` array of every rule in both files
  (mechanically safe: the filters are domain-anchored, so the extra types only apply to those domains). Consider also
  `"media"`, `"font"` and `"stylesheet"`. Then verify both engines accept the added types — **unverified**: needs a
  browser run.
* **Proof to run after the fix:** load a test page that calls
  `navigator.sendBeacon("https://www.google-analytics.com/collect", "x")` with the ruleset enabled; the Network panel
  should show the request blocked (`net::ERR_BLOCKED_BY_CLIENT`). Repeat on the old types to confirm the bypass first.

#### L2 — Over-broad filter `||facebook.com/tr` blocks unrelated Facebook pages by default

* **Evidence:** `rules/ads_trackers.json:1846` (rule id 109) — `"urlFilter": "||facebook.com/tr"` with no terminating
  `^`. All other 289 filters are `||domain^`, which matches the domain and its subdomains only. The substring form also
  matches `/travel`, `/trending`, `/transparency`, any path containing `/tr`, and the rule applies to `main_frame` —
  i.e. first-party navigation is blocked for every user with ad blocking on (the default).
* **Impact:** denial of legitimate browsing on a major site; users will read it as breakage and may disable the feature
  entirely.
* **Status:** tracked as D2 in `QA_REPORT.md`, filed with D3 under
  `tkt_41e32719-14bd-4556-ba35-eb98b3ac8df2` (Developer, Backlog). **No duplicate ticket filed.** Acceptance:
  `||facebook.com/tr^`, id 109 unchanged.

#### L3 — Adult filter blocks whole domains with no bypass: false positives are user-visible and irreversible per site

* **Evidence:** `rules/adult_filter.json` is 181 whole-domain `main_frame` blocks, e.g. `||sex.com^` (:2067),
  `||men.com^` (:1251), `||vixen.com^` (:2424), `||nifty.org^` (:1387). `nifty.org` in particular hosts a large
  non-adult text archive alongside adult content, and brand-name domains (`men.com`, `vixen.com`) can collide with
  unrelated businesses. There is no per-site allowlist, no `allow` rule, and no way to reload with the filter bypassed
  short of disabling the whole ruleset.
* **Impact:** over-blocking of legitimate pages once a user opts in; the failure is silent (a blocked `main_frame`
  looks like a network error).
* **Remediation:** (a) document the provenance and review date of the domain list in `README.md`; (b) drop
  `main_frame` from the resource types for mixed-use domains, or move those hosts to `sub_frame`/`image`/
  `xmlhttprequest` only; (c) consider an explicit `allow` rule (higher priority, `requestDomains` for a user-chosen
  host stored in `browser.storage.local`) so a false positive can be bypassed per site without disabling the filter.
  This finding is a quality/false-positive risk, not a vulnerability; it is the main residual risk to carry into the
  release notes.
* **No ticket filed** — this is a product/UX decision for the Project Manager; the acceptance criterion for this
  review is that the risk is recorded and mitigated (see §5).

### Info

* **I1 — Settings merge is unvalidated.** `lib/settings.js:9-11` returns
  `Object.assign({}, DEFAULT_SETTINGS, stored)`, so any key/type present in `browser.storage.local` flows through.
  Consumers use strict comparisons (`settings.adultFilter === true`, `lib/rules.js:52-53`; `settings.adBlocking`
  truthiness, `content/youtube.js:268`), so behaviour is safe today and storage is extension-private. Optional
  hardening: coerce both keys to booleans in `getSettings()` so the "booleans only" contract is enforced at the
  boundary rather than at each consumer.
* **I2 — No Firefox `strict_min_version`.** `manifest.json:60-64` declares a gecko id but no minimum version;
  Firefox 109–112 would install and silently block nothing. Tracked as D3 under `tkt_41e32719`.
* **I3 — Placeholder Gecko id / missing data-collection declaration.** `manifest.json:62` uses
  `safeblock@example.com`; AMO signing needs a real id, and current AMO submissions require
  `browser_specific_settings.gecko.data_collection_permissions` (the extension collects nothing, so
  `"required": ["none"]` is the accurate declaration). Release-time compliance item, not a code risk.
* **I4 — Unawaited storage write.** `popup/popup.js:23` and `options/options.js:23` call `setSettings()` without
  awaiting or handling rejection, then immediately call `applyRuleState()`. A failed write leaves the ruleset enabled
  while storage says otherwise; the next popup load self-corrects by re-deriving state from storage. Not a security
  issue (no untrusted input, no logging), noted for completeness.
* **I5 — Git state for packaging.** `git_status` shows branch `master`, **zero commits, all files untracked**.
  `tkt_900cdd95` describes the workspace as "NOT a git repository", which is inaccurate; either way, packaging must
  copy files (no `git archive`, no `git clean`), and nothing is at risk of being lost by a destructive git command
  today. Flagged for the Release Engineer.
* **I6 — Redundant match pattern.** `manifest.json:28` `*://m.youtube.com/*` is already covered by
  `*://*.youtube.com/*` (`*.domain` matches the bare domain and subdomains). Harmless; can be dropped when H1 is
  fixed.

## 4. No findings in (confirmed clean)

Each item below was checked directly against the tree; the evidence given is what was observed.

1. **No remote code.** No `eval`, `new Function`, `Function(`, dynamic `import()`, `importScripts`,
   `document.write`, `<script src>` pointing off-extension, or inline event handlers anywhere in `lib/`, `content/`,
   `popup/`, `options/`. Both HTML pages load only relative local scripts (`popup/popup.html:21-24`,
   `options/options.html:26-29`); both CSS files contain no `url()`, `@import` or remote font. `content/youtube.js` —
   called out for special attention — builds its injected stylesheet with `style.textContent` from the constant
   `HIDE_SELECTORS` array (`content/youtube.js:126-131`) and contains no string-to-code path.
2. **No outbound network requests initiated by extension code.** No `fetch`, `XMLHttpRequest`, `WebSocket`,
   `EventSource`, `sendBeacon`, `navigator.*` network call, or `<img>`/`<link>` beacon in any shipped file; rule lists
   are static JSON loaded by the browser, never fetched. The only timer is the 250 ms debounce at
   `content/youtube.js:189`; there is no `setInterval`, no polling and no remote list refresh.
3. **No secrets or personal data in source.** No API key, token, password, cookie, credential, private key or user path
   in the tree (including `QA_REPORT.md`); no `.env`, no key files. Storage holds only the two booleans `adBlocking` /
   `adultFilter` (`lib/settings.js:3-6`, written from `popup/popup.js:19-22` and `options/options.js:19-22`); no page
   content, URL, title or history is ever read or stored.
4. **No logging or disk writes.** No `console.*`, no downloads API, no `FileWriter`, no `indexedDB`, no
   `localStorage`/`sessionStorage`, no filesystem access. Failures are swallowed deliberately
   (`content/youtube.js:50-52,79-81,107-110`, `lib/rules.js:34-45`), consistent with the no-logging requirement.
5. **Injection safety.** No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or
   `createElement("script")` anywhere. No selector is built from page data: every selector in `content/youtube.js` is a
   constant (`:19-31`), and `each()` uses `document.querySelectorAll(selector)` with a try/catch (`:43-61`). The only
   DOM text written is the constant style rule text (`content/youtube.js:128-130`).
6. **Content script hygiene (YouTube script).** Matches only `*://*.youtube.com/*` (`manifest.json:26-29`), wrapped in
   an IIFE with no globals assigned (`content/youtube.js:18,310`), and every browser API is feature-guarded before use
   (`typeof document`, `typeof MutationObserver`, `typeof video.currentTime`,
   `typeof browser.storage.onChanged.addListener`). It exposes no `window`-reachable entry point the page could call:
   the page can at most dispatch `yt-navigate-finish`/`popstate`, which only schedules a debounced pass.
   `lib/compat.js:17` assigns `window.browser = chrome`, which in a content script stays in the isolated world and is
   **not** visible to the page; in extension pages it is the normal shim.
7. **Manifest surface.** `permissions` is exactly `["declarativeNetRequest","storage"]` (`manifest.json:6-9`); no
   `host_permissions`, `optional_permissions`, `web_accessible_resources`, `externally_connectable`,
   `content_security_policy` override, `background` or `service_worker` key; no default MV3 CSP weakening, and no
   extension resource exposed to web pages.
8. **Supply chain / build.** 17 shipped files, no `node_modules`, no `package.json`/lockfile, no minified or bundled
   third-party code, no CI workflow (so no token-bearing workflow to harden), no build step — the tree is loadable
   unpacked as-is. Rule ids are unique: `rules/ads_trackers.json` ids `1–109` (`:4` … `:1840`) and
   `rules/adult_filter.json` ids `1000–1180` (`:4` … `:3064`), sequential, no duplicates, no cross-file collision; all
   290 actions are `block`, none are `redirect`/`modifyHeaders`/`allowAllRequests`, so nothing can rewrite a request to
   attacker-controlled content.
9. **No over-broad DNR filters besides L2.** No bare `"*"`, no single-letter filter, no filter shorter than
   `||x.com^`; the only filter not matching the anchored `||domain^` shape is `||facebook.com/tr`
   (`rules/ads_trackers.json:1846`, L2). No first-party navigation is blocked on the enabled ruleset except through
   that rule.
10. **Adult filter gating.** Ships disabled (`manifest.json:18-20` `"enabled": false`), defaults to `false`
    (`lib/settings.js:5`), and `applyRuleState` only puts it in `enableRulesetIds` when
    `settings.adultFilter === true` (`lib/rules.js:52-53,65-68`). The only writers of that key are the popup and options
    pages, both of which require an explicit `confirm()` before persisting (`popup/popup.js:29-35`,
    `options/options.js:29-35`); no shipped code path can enable it without a settings write. On a fresh install the
    effective state is "adult blocking off".

## 5. Residual risk and mitigation

| Risk | Severity | Mitigation |
|---|---|---|
| Adult domain list false positives (whole-domain `main_frame` blocks, mixed-use hosts such as `nifty.org`, brand-collision domains) — a legitimate site becomes unreachable with no per-site bypass (L3) | Medium, opt-in only | Document list provenance and review date in `README.md`; add a per-site `allow` rule or narrow mixed-use hosts to subframe/subresource types; the filter is off by default and the toggle is reversible from the popup |
| Tracker coverage gaps: `sendBeacon`/`<a ping>` (`ping`) and `object` requests bypass the ruleset (L1) | Low | Add the missing resource types; verify with the DNR smoke test |
| Over-blocking on the default ruleset breaks first-party navigation (`||facebook.com/tr`, L2) | Low | Anchor to `||facebook.com/tr^` (tracked) |
| Privilege is broader than the feature needs (`<all_urls>` content script, H1) | High until fixed | Remove the entry; if a DOM guard is ever needed, use `optional_host_permissions` + `scripting.registerContentScripts` after explicit opt-in |
| A future edit to the shared libraries makes them non-re-entrant (M1 shows the failure mode already) | Medium | Fix M1 by re-entrancy or by removing the second entry; add a smoke test that no console error appears on `www.youtube.com` |
| Unsigned/placeholder identity for AMO and the upcoming data-collection declaration (I3) | Low | Real Gecko id + `data_collection_permissions: {required: ["none"]}` before submission |

## 6. Out of scope / not verifiable statically

* Actual DNR enforcement on either engine, and whether Firefox needs host permissions for the `main_frame` resource
  type used by all 290 rules (the manifest declares none by design).
* That the YouTube selectors still match the current YouTube DOM, and that the skip/seek behaviour is correct in a live
  player; a wrong class match there could seek a main video (`content/youtube.js:94-112`).
* That Firefox injects both `content_scripts` entries into the same isolated world exactly as emulated for M1 (the M1
  analysis is Chromium semantics; Firefox is expected to behave the same but is **unverified**).
* Binary review of `icons/*.png` beyond "valid PNG at declared sizes" (QA verified decode; no metadata inspection was
  performed here), and browser-level rendering of the popup/options pages.
* `chrome.storage` promise support on the oldest supported Chrome, and the `browser`-namespace shim in Chrome MV3
  popup/options contexts.

## 7. Tickets

* **New — `tkt_2dd3aad3` (High, Developer):** remove the `<all_urls>` content script / `content/adult.js` (H1). This
  ticket also closes M1 if the entry is removed.
* **New — `tkt_ebe084c1` (Low, Developer):** add `ping`/`object`/`other` to the DNR `resourceTypes` (L1).
* **Existing, no duplicate filed:** `tkt_6d3b1c06-6701-407b-9d3e-bee582f4c280` (M1/D1),
  `tkt_41e32719-14bd-4556-ba35-eb98b3ac8df2` (L2/D2 + I2/D3).
* **Not reopened:** `tkt_8c7f5ab7-c472-47de-ad28-19899233bcff` (adult filter) implements every stated requirement —
  default off, opt-in, DNR-only gating — and its full description was not available to this review to confirm whether
  the extra `<all_urls>` guard was in its brief. H1 is filed as a new ticket so the Project Manager can decide whether
  the entry is dropped or narrowed.

## 8. Release gate

Release is **blocked** on H1 (`security=changes_requested`). After H1 lands, the remaining prerequisites for an
approval verdict are: M1 verified fixed with no console error on `www.youtube.com`, L2 anchored, L1 accepted or
ticketed, and a browser smoke test of both engines per `QA_REPORT.md` O4. No finding in this review requires rotation
of a credential — nothing sensitive is present in the tree.
