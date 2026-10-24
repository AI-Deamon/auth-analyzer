# Auth Analyzer

**See what the apps connected to your Google Account can actually do, in plain language, without sending your data anywhere.**

Auth Analyzer is a local-first Chrome/Edge extension (plus a small web demo) that reads the "Third-party apps & services" page of your Google Account, turns each app's access into one clear explanation, and tells you what to check next. It is deliberately honest about what it does *not* know.

> Built for ExaThon India 2026. Licence: [MIT](LICENSE).

---

## The problem

Most people have dozens of apps connected to their Google Account, often granted years ago with one click. Google shows the list, but:

- the wording is technical ("See, edit, share and permanently delete all the calendars that you can access"),
- there is no way to export it, and no API for ordinary users to list it,
- nothing says which connections matter, so people either ignore the page or revoke blindly.

On a real account we tested, **105 apps** were connected, and **only 10** had access to account data (Gmail, Drive, Calendar, Cloud). The other 95 only used "Sign in with Google". Finding the ones that matter by hand is exactly what people don't do.

See [docs/PROBLEM_STATEMENT.md](docs/PROBLEM_STATEMENT.md).

## What it does

For every connected app it shows four short facts:

| | |
|---|---|
| **Access** | What the app can do, e.g. "Read and change your Gmail messages and send email as you" |
| **Why it matters** | One sentence on practical impact |
| **Next step** | One proportionate action |
| **Evidence status** | *All visible access text understood*, *Partly understood* or *Unknown*, and what that does **not** prove |

Everything technical (original Google wording, rule IDs, extraction diagnostics) is in an expandable section.

Features: scan one or several Google accounts you choose, results sorted by sensitivity, per-account filter, resumable scans, an export for debugging with an option that hides names and emails, and a web demo where you can paste OAuth scope IDs.

## Why you can trust the analysis

The engine is **deterministic, rule-based and explainable**: no AI model, no external service, no opaque score.

- **Four separate questions**, never merged into one number: *Access sensitivity* (what could it expose?), *Purpose compatibility* (only if you tell us what the app does), *Evidence confidence* (how well did we understand the page?) and *Recommended action*.
- **Sensitivity is not suspicion.** "High" means the access could expose a lot. It never says an app is malicious, and removal is suggested only when *you* say you no longer need the app.
- **Fail-safe.** Missing, unrecognised or collapsed ("+4 more") access is never reported as low risk. It is shown as "Partly understood" with the exact line or reason.
- **No invented facts.** The app's name is never used as evidence (an app called "Claude for **Gmail**" does not get Gmail access added). Permissions are never assumed from vague wording.
- **Tested against reality.** The parser was built from real exported page data, which exposed defects synthetic tests missed (see [docs/ENGINE.md](docs/ENGINE.md)).

## Privacy

Everything runs in your browser. There are **no network calls, analytics or telemetry** in the code (a test scans the source for this). Scan results and your answers stay in the extension's local storage, and **Delete saved scan** removes them. The extension only requests access to `myaccount.google.com`.

## Quick start

**Requirements:** Node.js 22 or newer (tested on 24), and Chrome or Edge.

```bash
git clone <this repository>
cd auth-analyzer
npm test            # runs the automated tests
npm run build       # REQUIRED before loading the extension: generates extension/core and extension/ui
```

Install the extension:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension` folder.
3. Pin **Auth Analyzer**, click its icon, then **Find my Google accounts**.
4. Tick the accounts to scan and click **Scan selected accounts**. A tab opens and steps through your connected apps (a few seconds each). Keep the browser open.
5. A results tab opens when it finishes. Open **Evidence and technical details** on any app to see the original wording and rules.

Run the web demo (no Google account needed):

```bash
npx serve .          # or: python -m http.server 8000
```

Open the printed address, click **Load example**, or paste permission IDs such as `https://www.googleapis.com/auth/gmail.readonly`.

More detail, packaging and hosting: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## How it works

```
Google Account page (your browser)
        |  extension reads headings + lines (no interpretation)
        v
 parse.js     split into sign-in / access sections, keep every line, flag "+N more"
 describe.js  words -> capabilities (resource + read/write/send/delete/admin + breadth)
 sensitivity  documented rules S00-S19, first match wins, unknown stays unknown
 purpose      consistent / broader / conflicting / unknown (only from what YOU say)
 confidence   all understood / partly / insufficient
 recommend    no action / review / verify still needed / investigate / consider removing
        v
 explain.js   plain-language Access, Why it matters, Next step, Evidence status
```

Project layout:

```
core/        pure analysis engine (no browser or network code), fully unit-tested
ui/          shared card renderer
extension/   Chrome extension (Manifest V3); extension/core and extension/ui are generated by `npm run build` (not committed)
index.html   web demo
test/        automated tests (Node's built-in test runner, no dependencies)
docs/        engine documentation, problem statement, deployment guide, demo script
```

## Tests

```bash
npm test
```

The suite covers consistent classification of equivalent evidence, read vs write vs send vs delete, unknown and malformed input, duplicate names, multi-account identity, collapsed lists, scan resilience and privacy checks. Several tests use fixtures that replicate a real exported page line for line (names and ids are synthetic). Passing tests show the rules behave as documented; they do not prove the rules match every possible Google page. See "Known limitations".

## Known limitations

- **There is no official API** for a user's connected apps, so the extension reads the page. If Google changes its layout the parser may need updating. Unexpected layouts are reported as incomplete, never as safe.
- The rules were built from the wording seen on one account (about 10 distinct permission phrasings). More accounts are needed to widen coverage.
- **"+N more" details pages:** the extension follows these links, but that page's layout has not yet been observed, so it is read conservatively and may leave an app as "Partly understood".
- The "Access to" filter on Google's page could not be selected automatically, so every connected app is scanned (slower, same results).
- Google's descriptions are summaries. "All visible access text understood" does not verify an app's behaviour or its exact OAuth scopes.
- Desktop browsers only (mobile Chrome does not run extensions).

## Licence

[MIT](LICENSE)
