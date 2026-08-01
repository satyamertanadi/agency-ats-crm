# Agency ATS — LinkedIn sourcing extension (Chrome MV3)

Capture a LinkedIn profile straight into your ATS as a **candidate** or **contact**, optionally
dropping the candidate into an open job's pipeline. Private / load-unpacked — no Chrome Web Store.

## How it works

- **Auth (session handoff):** the extension borrows your existing ATS web session. When you click
  **Connect**, it opens the ATS; a content script reads the logged-in Supabase session from the app
  origin and hands it to the extension's background worker, which keeps it refreshed on its own. You
  only reconnect if you fully sign out of the ATS. No password is ever entered into the extension.
- **Capture:** on a `linkedin.com/in/…` profile, an **ATS** button (bottom-right) opens a panel
  pre-filled from the visible profile. Edit anything, pick candidate/contact + workspace (+ job or
  company), and **Save**. Saving calls the `capture_prospect` RPC directly over Supabase's REST
  endpoint using your session — dedup, merge, and permissions are enforced server-side.
- **Enrichment:** the panel scrapes the profile itself (role history with dates, education, skills,
  languages) and pulls the contact-info overlay automatically. The `parse-linkedin-profile` edge
  function is only invoked when that scrape comes up short, and it fills blanks rather than overwriting
  — a cleanly-read profile costs no AI tokens. The **✨ AI clean-up** button forces a full re-parse.
- **Dedup:** re-capturing the same person updates the existing record (matched by email, then by
  LinkedIn URL) instead of creating a duplicate. The panel tells you which happened. The launcher
  button itself shows a green dot when the profile is already in your ATS, before you open anything.
- **Routing:** both LinkedIn content scripts match all of `linkedin.com` and gate themselves on the
  current path (`isProfilePage` / `isListPage` in `src/dom.ts`). Chrome injects content scripts on full
  page loads only, so narrower match patterns break as soon as you navigate within LinkedIn's SPA.

## Build

Config is read at build time from the repo's `../.env.local` (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`) plus the ATS app origin. Set the origin (and optionally override Supabase)
in `extension/.env`:

```
EXT_APP_ORIGIN=https://your-ats.example.com
# EXT_SUPABASE_URL=...        # defaults to VITE_SUPABASE_URL from ../.env.local
# EXT_SUPABASE_ANON_KEY=...   # defaults to VITE_SUPABASE_ANON_KEY (public anon key)
# EXT_DEBUG=1                 # console tracing in the background worker + handoff (off by default)
```

Then:

```
cd extension
node build.mjs      # or: npm run build
```

It bundles into `extension/dist` (uses the repo's own esbuild — no separate install).

## Load it

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select `extension/dist`.
3. Open any `linkedin.com/in/…` profile → click the **ATS** button → **Connect** once → capture.

## Known limitations

- **LinkedIn scraping is brittle and against LinkedIn's Terms of Service.** LinkedIn's DOM is
  obfuscated and changes without notice, so field detection is best-effort — that's why every field is
  editable before saving. When a selector breaks, the field is simply empty; it never saves wrong data.
- Email/phone are rarely exposed on LinkedIn, so candidate dedup leans on the profile URL.
- The unpacked extension ID is stable per install path. No Web Store listing or key pinning is needed:
  Supabase's REST/RPC endpoints have permissive CORS, and the one edge function the extension calls
  (`parse-linkedin-profile`) is reached through `host_permissions` rather than a CORS allowance.
- Workspace, job, owner and tag lists are cached in the background worker for 60s, so a saved record
  made elsewhere may take up to a minute to show up in the panel's dropdowns.
- There are no automated tests for the extension, and it is excluded from lint and CI. Selector rot is
  the most likely silent failure; see the "How it works" note on why every field stays editable.
