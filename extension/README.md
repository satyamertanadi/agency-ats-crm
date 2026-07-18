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
- **Dedup:** re-capturing the same person updates the existing record (matched by email, then by
  LinkedIn URL) instead of creating a duplicate. The panel tells you which happened.

## Build

Config is read at build time from the repo's `../.env.local` (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`) plus the ATS app origin. Set the origin (and optionally override Supabase)
in `extension/.env`:

```
EXT_APP_ORIGIN=https://your-ats.example.com
# EXT_SUPABASE_URL=...        # defaults to VITE_SUPABASE_URL from ../.env.local
# EXT_SUPABASE_ANON_KEY=...   # defaults to VITE_SUPABASE_ANON_KEY (public anon key)
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
- The unpacked extension ID is stable per install path. No Web Store listing or key pinning is needed
  because the extension talks to Supabase's REST/RPC endpoints (permissive CORS), not the ATS's own
  edge functions.
