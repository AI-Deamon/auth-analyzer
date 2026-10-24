# Auth Analyzer engine (rules version 2026-10-22.1)

The engine answers four separate questions. They are never merged into one number.

| Dimension | Question | Values |
|---|---|---|
| Access sensitivity | What could this access expose or allow? | low, medium, high, unknown (and "at least X" when evidence is incomplete) |
| Purpose compatibility | Is the access consistent with what the **user says** the app does? | consistent, broader, conflicting, unknown |
| Evidence confidence | How reliable is the data behind this analysis? | verified, described, partial, insufficient |
| Recommended action | What is a sensible next step? | no_action_indicated, review_access, verify_needed, investigate_mismatch, consider_revoking |

Sensitivity is about potential impact. It never means an app is malicious, and low sensitivity never means an app is trustworthy.
Confidence is about the data, not about the app's safety.

## Pipeline (each stage is a separate module in `core/`)

1. **Extraction** (`extension/background.js`): reads structure from the page: headings and items, flagged as button/link/text. No interpretation. Layout assumptions live in the `SELECTORS` blocks.
2. **Normalisation** (`parse.js`): finds the access section, separates buttons/dates (ignored, counted) from permission text, keeps anything unrecognised inside the access section as `unrecognised` (never dropped). Assumptions: `EXTRACTION_CONFIG`.
3. **Capability mapping** (`registry.js`, `describe.js`): verified OAuth scope IDs map through `SCOPE_REGISTRY`. Page descriptions are interpreted compositionally (resource + verbs + breadth). Scope IDs are never invented from text, and unknown IDs are never guessed from their names.
4. **Sensitivity** (`sensitivity.js`): ordered rules S01 to S19, first match wins, each with a written rationale. No match means `unknown`, never `low`. Overall = highest known capability.
5. **Purpose** (`purpose.js`): compares capabilities with what a user-stated kind of app is expected to use. Not stated or "other" means `unknown`. Incomplete evidence means `unknown` (`insufficient_evidence`). "Read-only" wording alongside write/send/delete means `conflicting`.
6. **Confidence** (`confidence.js`) and **recommendation** (`recommend.js`).
7. **Explanation** (`explain.js`): plain-language text built only from capabilities present in the result.

## Real page layout (from an exported report, Oct 2026)

The detail page has three headings, which the parser uses as section boundaries (validated on 103 real records):
`Keep track of your Google Account data` (page chrome, all records), `How Google helps you sign in to <App>` (sign-in section, 99 records) and `<App> has some access to your Google Account` (access section, 10 records).
The explainer sentences (`When you use Sign in with Google ...`, `To use some <App> features, you gave <App> some access ...`) and the footer `See something suspicious?` are a fallback if the headings change.
Icon-font text (`account_circle`, `pentagon`), buttons and links are ignored as chrome. Apps with only the sign-in section list only profile info.
**Collapsed lists:** an access section can end with a link such as `+1 more` or `+4 more` (5 of 10 real access records). That text is evidence that permissions exist that were not read, so the record is "Partly understood" and the next step says to expand it. The extractor clicks in-page expanders (no href) before reading; anything still collapsed is reported, never assumed empty. An access section that lists nothing is also treated as incomplete.
These patterns live in `EXTRACTION_CONFIG`. If neither marker is found the layout is treated as unrecognised: status `partial`, and a missing permission list is NOT trusted (sensitivity stays `unknown`, never `low`).

Parsing safety rules learned from real data: the app name is removed before matching (so "Claude for Gmail" is not Gmail access); a verb that is not in the text is never assumed (verb-less wording becomes `unspecified` and rates `unknown`); multi-clause lines are split so no clause is dropped; "Connect itself to your Google Drive" is app-install, not file access.

## Fail-safe behaviour

- Missing, malformed or failed extraction gives sensitivity `unknown` and confidence `insufficient`, and the action is `review_access`, never `no_action_indicated`.
- Unrecognised access text, ambiguous wording or unknown permission IDs make the result partial and the sensitivity a lower bound ("At least Low").
- "Manage ..." wording is flagged ambiguous: it is treated as a change and never assumed to include more. Wording with no verb becomes `unspecified` and is rated `unknown`; viewing is never assumed.
- Unspecified breadth is treated conservatively (as not narrowed) but described without the word "all".

## Recommendation precedence

1. `consider_revoking`: only if the user says they no longer need the app. Sensitivity alone never leads here.
2. `investigate_mismatch`: purpose is `broader` or `conflicting`.
3. `verify_needed`: user reports 6+ months unused (and has not said they still need it) and the access is not minor or is incomplete.
4. `review_access`: sensitivity above low, or evidence incomplete.
5. `no_action_indicated`: low sensitivity, evidence understood, nothing else flagged.

## Identity and duplicates

Records are identified by the id in `.../linkedapps/overview/<id>`. Display names are never used to merge. Same name with a different id stays separate and is flagged. The same id seen twice with identical evidence is collapsed (and counted); with different evidence both are kept and flagged.

## Privacy and retention

- No network calls, analytics or external AI anywhere (a test scans the source for this).
- The extension stores only: app name, link, and the structured extraction of that app's page (headings and items). When a page has no headings, a capped copy (120 lines) of the main region is kept for diagnosis. It does not store the whole page.
- Your answers (purpose, last used, still needed) are stored locally. "Delete saved scan" on the results page removes everything.
- Analysis is recomputed from stored extractions, so rule improvements apply without rescanning.

## Known limitations

- The headings, labels and wording were validated on one account (103 to 105 real records). Other accounts and Google layout changes may need rule updates (see `EXTRACTION_CONFIG`). The layout of the details page behind "+N more" has not been observed.
- Google's descriptions are summaries, so breadth and exact actions can be ambiguous; those cases are flagged, not guessed.
- Purpose expectations (`PURPOSES`) are coarse and should be reviewed.
- Last-used and "still need it" come from the user; the page has no reliable last-used date.

## Card summary

Each app shows four short facts: **Access**, **Why it matters** (one sentence), **Next step** (one step) and **Evidence status** (All visible access text understood, Known permission IDs, Partly understood, Unknown). Source text, rule IDs, limitations and extraction diagnostics are in the expandable details. No label claims the app's behaviour or exact OAuth scopes were verified.

## Export

`Export report` writes a local JSON file containing each raw extraction (the engine's input format) and its analysis. `Export (names hidden)` replaces app names with `App N` and account emails and names with `Account N`. Nothing is uploaded.

## What the tests do and do not establish

The tests establish that the rules behave as documented on the fixtures, that every real record from one exported report (103 records) is analysed, rendered and exported without loss, and that results do not depend on the app name. They do not establish that the rules match Google's real behaviour beyond the wording seen so far (about 10 distinct permission phrasings). Real-world validation still needs: more accounts with more apps, the contents behind `+N more` and `See details`, and confirmation of what Google's descriptions mean for each OAuth scope.

## Tests

`npm test` runs every file in `test/` (Node's built-in runner). `real-structure.test.js` replicates the real page line for line; `real-format.test.js` and `report-1.test.js` use wording from real exported reports. All names, emails and ids in tests are synthetic. Build the extension copies with `npm run build`.

## Evidence labels (updated)

| Label | Meaning | What it does NOT mean |
|---|---|---|
| All visible access text understood | Every access line on the page matched our wording rules. | It does not verify the app's behaviour or its exact OAuth scopes. Google's descriptions are summaries. |
| Known permission IDs | Permission IDs matched our reference list (web app input). | It does not show what the app does with them. |
| Partly understood | At least one access line was not understood, or the layout was only partly recognised. | There may be more access than shown. The unresolved line is quoted in the next step. |
| Unknown | No usable access information was found. | Never treated as low sensitivity. |

## Known page text vs unknown permissions

Explainer sentences and the sub-heading `<App> has some access to your Google Account` are recorded as known page text (kept in the technical details, not counted as permissions). The sub-heading only counts as known text when the prefix is exactly the app's own name, so permission-like text can never be swallowed by it. Any other unmatched line in the sign-in or access sections stays `unrecognised` and keeps the record "Partly understood".

## Next step wording

One step, chosen from the user's answers, completeness and sensitivity: incomplete records point at the missing access (quoting the first unresolved line); complete records get a proportionate step (low: nothing needed; medium: keep if still used; high: keep only if recognised and still used). Removal is suggested only when the user says they no longer need the app.

## Multiple Google accounts

The popup has **Find my Google accounts**, then a checkbox per account, then **Scan selected accounts**.

- **Discovery:** Google serves signed-in accounts by index (`?authuser=0,1,2...`). The extension opens `myaccount.google.com/?authuser=N` for N = 0, 1, ... (up to 8), reads the email from the page's avatar label, and stops at the sign-in page or when an email repeats. The list and your selection are stored locally.
- **Safeguard:** the index is not a stable identity, so before reading any app the page's email must match the selected account (`verifyAccount`). If the email cannot be read, or it differs, that account is skipped and listed on the results page. Apps are never filed under an account that was not proven.
- **Identity:** a record is identified by (account, app id). The same app id in two accounts is two records; the same name in different accounts is not flagged as confusing, but within one account it still is. Your answers (purpose, last used, still needed) are stored per account.
- **Results:** an account filter appears when more than one account was scanned, and each card shows its account.
- **Privacy:** account emails are stored in this browser only. "Export (names hidden)" replaces them with `Account N`.
- **Assumptions to validate on a real multi-account browser:** that `authuser` selects the account on `myaccount.google.com`, and that the avatar `aria-label` contains the email (`EXTRACTION` helpers `readAccountLabels` / `parseAccountLabel`).

## "+N more" details pages (2026-10-24)

In a real export, the `+N more` link is an anchor to `linkedapps/details/<id>` (5 of 10 access records), not an in-page expander, so the first fix (clicking expanders) never fired. The extractor now follows those links (read-only, `myaccount.google.com` only, same account, at most 2 per app, vetted by `findDetailsLinks`) and stores the page in `extraction.followed`.

The details page's layout has not been observed yet, so it is read conservatively: every unmatched line stays "unrecognised", and the hidden list is treated as resolved only if the page yields at least as many NEW permission lines as the link announced, with no unknown or nested collapsed text. Otherwise the record stays "Partly understood" with a specific reason. Permissions found there are always added to the access shown. The next export will show the real layout; tighten `absorbDetailPages` then.

Relative links such as `linkedapps/details/...` resolve against the site root, not the detail page (the page's own URL would produce `/linkedapps/overview/linkedapps/details/...`); the extractor records the browser-resolved URL.

## Scan reliability

Chrome stops idle extension workers and a scan of ~100 apps takes minutes. A keep-alive ping runs during scans, progress is saved every 3 apps (`partialScan`), a worker that starts with a stale "running" status marks it interrupted (unlocking the popup), and the popup offers **Resume interrupted scan**.
