# Deployment and run guide

Auth Analyzer has two deliverables. Neither needs a server, database or API key.

| Deliverable | What it is | How it runs |
|---|---|---|
| **Chrome/Edge extension** (`extension/`) | The real product: scans your Google Account page | Loaded into the browser |
| **Web demo** (`index.html`, `core/`, `ui/`) | Paste permission IDs and see the explanation | Any static web host |

## 1. Prerequisites

- Node.js 22 or newer (tested on 24). Only used to run tests and copy files; there are no npm dependencies.
- Chrome or Edge (Manifest V3).

## 2. Verify the code

```bash
npm test
```

All tests should pass. The tests use Node's built-in runner, so there is nothing to install.

## 3. Run the extension locally

```bash
npm run build      # required: generates extension/core and extension/ui (not committed), repeat after any change to core/ or ui/
```

1. Open `chrome://extensions` (Edge: `edge://extensions`) and enable **Developer mode**.
2. **Load unpacked**, choose the `extension` folder.
3. Click the toolbar icon:
   - **Find my Google accounts** opens a tab per signed-in account index and reads the email shown on the page.
   - Tick the accounts to scan.
   - **Scan selected accounts** reads each connected app (a few seconds per app; keep the browser open).
   - If a scan is interrupted, reopen the popup and use **Resume interrupted scan**.
4. The results page opens automatically. **Export report** saves a JSON file for debugging; **Export (names hidden)** replaces app names and emails with `App N` / `Account N`. **Do not publish an un-redacted export**: it contains your account email and app list.

Troubleshooting:

| Symptom | Fix |
|---|---|
| "Please sign in to Google" | Sign in in the tab the extension opened, then press the button again |
| Account is skipped as "could not be verified" | The page did not show that account's email; sign in again and refresh the account list |
| Popup shows "running" after a crash | Reload the extension; the popup unlocks itself and offers Resume |
| Nothing found / diagnostics page | Google may have changed its layout; the diagnostics list the elements seen |

## 4. Run the web demo locally

ES modules do not load from `file://`, so serve the folder over http:

```bash
npx serve .
# or
python -m http.server 8000
```

Open the printed address. Click **Load example**, or paste scope IDs (one per line or space separated) or a Google sign-in URL containing `scope=`.

## 5. Deploy the web demo (static hosting)

There is no build step. Publish the repository root (the demo needs `index.html`, `core/` and `ui/`).

**GitHub Pages:** Settings, Pages, deploy from the `main` branch, folder `/ (root)`. The demo is served at `https://<user>.github.io/<repo>/`.

**Vercel:** `vercel --prod` from the repository root. Framework preset: Other. Build command: none. Output directory: `.`

**Netlify:** drag the folder into Netlify Drop, or set publish directory to `.` with no build command.

The demo makes no network requests and stores nothing.

## 6. Package the extension (optional, for the Chrome Web Store)

1. Bump `version` in `extension/manifest.json`.
2. `npm run build`
3. Zip the **contents** of the `extension` folder (the zip root must contain `manifest.json`).
4. Upload at the Chrome Web Store developer dashboard.

Notes for the store listing: the only host permission is `https://myaccount.google.com/*`; `tabs` and `scripting` are used to open and read the Google Account page; `storage` keeps results locally. No data leaves the browser, which should be stated in the privacy policy.

## 7. Continuous integration

`.github/workflows/test.yml` runs `npm test` on every push and pull request.
