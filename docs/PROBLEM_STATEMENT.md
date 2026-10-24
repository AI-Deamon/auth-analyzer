# Problem statement

## Who has the problem

Anyone with a Google Account, which is billions of people, and especially people who try many new apps and developer tools. Each "Sign in with Google" or "Allow access" click adds a connection that usually stays for years.

## What goes wrong

1. **Access is granted in one click and forgotten.** Many apps need only your name and email. A few can read your email, change or delete your Drive files, share your calendar, or manage cloud resources. The consent screen looked the same for both.
2. **Google's page is a flat list in technical wording.** It does not say which connections matter. There is no export, and ordinary users have no API to list their connected apps.
3. **People then do one of two bad things.** They ignore the page, so powerful access stays forever, or they revoke blindly, breaking tools they use.

**Evidence from a real account:** 105 apps were connected. Only 10 had access to account data, and 8 of those held high-sensitivity access (for example Gmail, Drive or Calendar with change and delete rights). The other 95 only used "Sign in with Google". The apps that matter are about 1 in 10, and nothing on the page tells you which ones.

## Why it matters

Unused or forgotten access with broad rights is risk with no benefit: if an app's developer is breached, sold or abandoned, that access is what is exposed. Reducing it is cheap, but only if people can see it clearly.

## What we built

A local-first extension that reads the connected-apps page in your own browser and explains, per app: what it can do, why that matters, what to do next, and how sure we are. It is deliberately **not** a verdict machine:

- It rates *what access could expose*, never whether an app is malicious.
- It says plainly what it could not read (collapsed lists, unknown wording) instead of guessing.
- It recommends removal only when the user says they no longer need the app.
- Nothing leaves the browser.

## Success criteria

- A non-expert can tell in seconds which apps hold powerful access.
- No unreadable access is ever shown as safe (verified by tests and by replaying a real 105-app export).
- The same evidence always gives the same result, independent of the app's name.
- Users keep full control: they choose which accounts to scan and can delete everything.

## Out of scope

Judging an app's intent or reputation, revoking access automatically, and anything that sends data to a server.
