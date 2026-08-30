# Agency ATS — LinkedIn sourcing extension (Chrome MV3)

Capture a LinkedIn profile straight into your ATS as a **candidate** or **contact**, optionally
dropping the candidate into an open job's pipeline. Private / load-unpacked — no Chrome Web Store.

## Sourcing sessions

**The extension does nothing until you tell it you are sourcing.** Outside a session it injects no
DOM into LinkedIn, adds no buttons or checkboxes, and — importantly — sends **no queries to your ATS**.
LinkedIn looks exactly as it would without the extension installed; the only trace is the toolbar
button sitting grey.

- **Start / stop:** click the toolbar button to open the session console, pick the workspace and the
  job you're filling, and hit **Start sourcing**. `Alt+Shift+A` toggles a session straight from the
  keyboard using your last target (rebindable at `chrome://extensions/shortcuts`).
- **The toolbar button is the status light:** teal with a running capture count while a session is
  live, grey and bare when it isn't.
- **A session is aimed at a job.** You choose it once, and both the profile drawer and the bulk bar
  arrive with that job pre-selected — in the same dropdown you'd use to change it. The target is never
  applied silently behind the form; mis-filing a candidate is expensive.
- Sessions live in memory and end when Chrome exits, so you can't come back tomorrow to a session you
  forgot was running.

While a session is active:

| Surface | What you get |
|---|---|
| `linkedin.com/in/…` | A **Save to ATS** button inside LinkedIn's own action row, and the capture drawer opening pre-filled |
| People search, company People tabs, feed/reactions | A checkbox and an **already-in-ATS** badge on every person row, plus a bulk bar |

## How it works

- **Auth (session handoff):** the extension borrows your existing ATS web session. When you click
  **Connect** in the session console, it opens the ATS; a content script reads the logged-in Supabase
  session from the app origin and hands only its short-lived access token to the extension's background
  worker. The token lives in browser-session memory, is never refreshed by the extension, and is
  cleared when Chrome exits. Reconnect when it expires. No password or refresh token enters extension
  storage.
- **Capture:** the drawer is pre-filled from the visible profile. Edit anything, pick
  candidate/contact + workspace (+ job or company), and **Save**. Saving calls the `capture_prospect`
  RPC directly over Supabase's REST endpoint using your session — dedup, merge, and permissions are
  enforced server-side.
- **Enrichment:** the drawer scrapes the profile itself (role history with dates, education, skills,
  languages) and pulls the contact-info overlay automatically. The `parse-linkedin-profile` edge
  function is only invoked when that scrape comes up short, and it fills blanks rather than overwriting
  — a cleanly-read profile costs no AI tokens. The **✨ AI clean-up** button forces a full re-parse.
- **Dedup:** re-capturing the same person updates the existing record (matched by email, then by
  LinkedIn URL) instead of creating a duplicate. The drawer tells you which happened. The capture
  button itself reads **✓ In ATS** when the person is already on file, before you open anything.
- **Auto-open, and how to stop it:** during a session the drawer opens by itself on each new profile.
  Closing it with **×** suppresses auto-open for *that* profile — the next person still opens normally,
  and the action-row button reopens the one you closed.
- **Routing:** both LinkedIn content scripts match all of `linkedin.com` and gate themselves on the
  current path (`isProfilePage` / `isListPage` in `src/dom.ts`). Chrome injects content scripts on full
  page loads only, so narrower match patterns break as soon as you navigate within LinkedIn's SPA.
- **Theme:** the injected UI follows LinkedIn's own dark/light setting (read from its DOM), falling
  back to `prefers-color-scheme`.

## Build

Config is read at build time from the repo's `../.env.local` (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`) plus the ATS app origin. Set the origin (and optionally override Supabase)
in `extension/.env`:

```
EXT_APP_ORIGIN=https://your-ats.example.com
# EXT_SUPABASE_URL=...        # defaults to VITE_SUPABASE_URL from ../.env.local
# EXT_SUPABASE_ANON_KEY=...   # defaults to VITE_SUPABASE_ANON_KEY (public anon key)
# EXT_OUT_DIR=C:/somewhere    # build output; defaults to extension/dist
# EXT_DEBUG=1                 # console tracing in the background worker + handoff (off by default)
```

Then:

```
cd extension
node build.mjs      # or: npm run build
```

It bundles into `EXT_OUT_DIR` (default `extension/dist`) using the repo's own esbuild — no separate
install. The build **refuses placeholder config**: if the app origin or Supabase URL resolves to an
`example.com`/`placeholder` host it exits non-zero rather than producing an extension that installs but
can never reach a session. CI builds deliberate dummies as a smoke test and opts out with
`EXT_ALLOW_PLACEHOLDERS=1`.

Note that `process.env` wins over `extension/.env`, so an exported `EXT_*` variable in your shell will
shadow the file — the guard above exists because exactly that once shipped a dead build.

### Icons

`node scripts/make-icons.mjs` regenerates `icons/` (teal active + grey idle, at 16/32/48/128) by
rendering them with the Playwright Chromium the repo already depends on. Run it only when the mark
changes; it is deliberately not part of `npm run build` so CI never downloads a browser. The generated
PNGs are committed, because the build output directory is gitignored.

## Load it

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the build output directory.
3. Click the toolbar button → pick a job → **Start sourcing**, then open any `linkedin.com/in/…`
   profile.

## Known limitations

- **LinkedIn scraping is brittle and against LinkedIn's Terms of Service.** LinkedIn's DOM is
  obfuscated and changes without notice, so field detection is best-effort — that's why every field is
  editable before saving. When a selector breaks, the field is simply empty; it never saves wrong data.
- The action-row button depends on that same DOM. It is anchored on the buttons' visible labels rather
  than on class names, with two class-based fallbacks and finally a floating pill, so the worst case is
  a button in a less convenient place — never no button.
- Email/phone are rarely exposed on LinkedIn, so candidate dedup leans on the profile URL.
- The unpacked extension ID is stable per install path. No Web Store listing or key pinning is needed:
  Supabase's REST/RPC endpoints have permissive CORS, and the one edge function the extension calls
  (`parse-linkedin-profile`) is reached through `host_permissions` rather than a CORS allowance.
- Workspace, job, owner and tag lists are cached in the background worker for 60s, so a saved record
  made elsewhere may take up to a minute to show up in the drawer's dropdowns.
- Session handoff has automated security regression tests, and extension lint, typecheck, tests, and
  build run in CI. LinkedIn selector rot remains a runtime risk; see the "How it works" note on why
  every scraped field stays editable before saving.
