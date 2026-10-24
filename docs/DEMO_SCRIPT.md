# Demo video script (target 2:45, hard limit 3:00)

**Before recording**

- Record from a **test or secondary Google account**, or only show screens after clicking **Export (names hidden)**. Never show your real email or app list on camera.
- Close other tabs and notifications. Zoom the browser to 110%. Record at 1080p.
- Have ready: the extension loaded, the web demo open in a second tab, and one finished scan.
- If you want a safe, repeatable demo, use the web demo's **Load example** for the second half.

| Time | On screen | Say |
|---|---|---|
| 0:00-0:15 | Title slide, then Google's "Third-party apps & services" page | "Everyone has apps connected to their Google Account. On my account there were 105. Which ones can read my email or delete my files? Google's page doesn't tell you." |
| 0:15-0:35 | The long list scrolling | "It's a flat list in technical wording, with no export and no API. So people ignore it, or revoke blindly." |
| 0:35-1:00 | Click the extension, **Find my Google accounts**, tick an account, **Scan** | "Auth Analyzer is a local-first extension. I choose which Google account to scan, and it reads the page in my own browser. Nothing is uploaded." |
| 1:00-1:30 | Results page, top card (high sensitivity) | "It sorts the most sensitive first. Each app gets four short facts: what it can access, why that matters, one next step, and how well we understood it. Here an app can read and change Gmail and send email as me." |
| 1:30-1:55 | Open **Evidence and technical details** | "Nothing is hidden: the original Google wording, the rule that fired, and the exact lines we couldn't read are all here." |
| 1:55-2:20 | A "Partly understood" card with "+4 more" | "Here's what makes it trustworthy. This app has four permissions collapsed behind a link. We don't pretend it's fine. It says Partly understood and tells me exactly what to open." |
| 2:20-2:40 | Web demo: paste `gmail.readonly`, then `gmail.send` | "The engine is deterministic and rule-based, with no AI. Read-only Gmail never says 'send'. Evidence decides the explanation." |
| 2:40-3:00 | Terminal: `npm test` passing, then the closing slide | "98 automated tests, built from real exported data, which caught defects that fake data missed. Sensitivity is not suspicion: we explain what access could expose, and leave the decision to you. Thank you." |

**Tips**

- Say "could expose", not "dangerous".
- Show the passing test run for 3-4 seconds; judges like evidence.
- Keep the cursor still while you talk, and trim silence in the editor.
- Upload to YouTube as *unlisted* (or Google Drive with link sharing on) and test the link in a private window.
