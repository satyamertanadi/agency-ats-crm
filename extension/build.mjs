// Build the MV3 extension into extension/dist. Uses the repo's own esbuild (resolved from the root
// node_modules -- the extension has no separate install step). Config (Supabase URL + anon key + the
// ATS app origin) is read from env or the root .env.local at build time and injected via `define`, so
// no secrets are hardcoded in source. The anon key is a public client key (the same one shipped in the
// SPA bundle), so embedding it in dist is expected, not a leak.
import * as esbuild from 'esbuild'
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,cpSync,existsSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'

const here=dirname(fileURLToPath(import.meta.url))

function parseEnv(path){
  if(!existsSync(path))return {}
  const out={}
  for(const line of readFileSync(path,'utf8').split('\n')){
    const match=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if(match)out[match[1]]=match[2].replace(/^["']|["']$/g,'')
  }
  return out
}

const rootEnv=parseEnv(join(here,'..','.env.local'))
const extEnv=parseEnv(join(here,'.env'))
const pick=(...keys)=>{for(const k of keys){const v=process.env[k]||extEnv[k]||rootEnv[k];if(v)return v}return ''}

// Where to write the loadable extension. Defaults to extension/dist, but that path lives inside OneDrive
// here -- Files-On-Demand can dehydrate a synced file back to a placeholder at any time, and Chrome's
// unpacked loader reading a dehydrated file fails in vague ways. Set EXT_OUT_DIR to a plain local path
// to keep the artifact out of sync's reach; the source tree stays where it is.
const dist=pick('EXT_OUT_DIR')||join(here,'dist')

const SUPABASE_URL=pick('EXT_SUPABASE_URL','VITE_SUPABASE_URL')
const SUPABASE_ANON_KEY=pick('EXT_SUPABASE_ANON_KEY','VITE_SUPABASE_ANON_KEY')
const APP_ORIGIN=pick('EXT_APP_ORIGIN')||'http://localhost:5173'
if(!SUPABASE_URL||!SUPABASE_ANON_KEY){
  console.error('Missing Supabase config. Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in ../.env.local, or EXT_* in extension/.env')
  process.exit(1)
}

// The values baked in here ARE the extension's identity: APP_ORIGIN decides which tab `connect` opens
// and which origin handoff.ts is allowed to run on. A placeholder produces an extension that installs
// and looks fine but can never reach a session -- exactly the failure that shipped once already, when
// CI's EXT_* vars were exported in a local shell and won the `pick` precedence above. CI builds dummies
// on purpose as a smoke test and opts out via EXT_ALLOW_PLACEHOLDERS; a local build never should.
const PLACEHOLDER_HOST=/(^|\.)example\.(com|org|net)$|placeholder/i
if(!pick('EXT_ALLOW_PLACEHOLDERS')){
  for(const [name,value] of [['EXT_APP_ORIGIN',APP_ORIGIN],['EXT_SUPABASE_URL',SUPABASE_URL]]){
    let host
    try{host=new URL(value).hostname}catch{
      console.error(`\n❌ Refusing to build: ${name} is not a valid URL (${value}).\n`)
      process.exit(1)
    }
    if(!PLACEHOLDER_HOST.test(host))continue
    console.error(`\n❌ Refusing to build: ${name} is a placeholder (${value}).\n   An extension built with this loads but is dead -- "Connect" opens a domain that does not resolve\n   and the session handoff can never run.\n   Most likely an exported ${name} in this shell is shadowing extension/.env (process.env wins).\n   Fix: unset ${name}, or set the real value in extension/.env, then rebuild.\n   Building placeholders on purpose (CI)? Set EXT_ALLOW_PLACEHOLDERS=1.\n`)
    process.exit(1)
  }
}
// Falling back to the root .env.local's VITE_SUPABASE_URL is a real footgun: that file tracks
// whatever project the SPA is being dev-tested against (often staging), which silently diverges from
// wherever EXT_APP_ORIGIN actually points once that's a real deployment. A session handed off from
// EXT_APP_ORIGIN is signed by ITS project's keys -- pointing the extension's client at a different
// project makes every setSession() fail with an opaque "unrecognized JWT kid" error. Set EXT_* explicitly.
if(!extEnv.EXT_SUPABASE_URL&&!process.env.EXT_SUPABASE_URL){
  console.warn(`\n⚠️  EXT_SUPABASE_URL is not set -- falling back to ../.env.local's VITE_SUPABASE_URL (${SUPABASE_URL}).\n   If that is not the SAME Supabase project your EXT_APP_ORIGIN (${APP_ORIGIN}) actually uses, the\n   session handoff will fail with "unrecognized JWT kid". Set EXT_SUPABASE_URL / EXT_SUPABASE_ANON_KEY\n   explicitly in extension/.env to the project EXT_APP_ORIGIN itself points at.\n`)
}
const supabaseOrigin=new URL(SUPABASE_URL).origin

mkdirSync(dist,{recursive:true})
const DEBUG=/^(1|true)$/i.test(pick('EXT_DEBUG'))
const define={
  __SUPABASE_URL__:JSON.stringify(SUPABASE_URL),
  __SUPABASE_ANON_KEY__:JSON.stringify(SUPABASE_ANON_KEY),
  __APP_ORIGIN__:JSON.stringify(APP_ORIGIN),
  __DEBUG__:JSON.stringify(DEBUG),
}

// Service worker: ESM (MV3 allows "type":"module"), bundles @supabase/supabase-js.
await esbuild.build({entryPoints:[join(here,'src/background.ts')],outfile:join(dist,'background.js'),bundle:true,format:'esm',target:'chrome110',define,logLevel:'info'})
// Content scripts must be classic scripts -> IIFE.
await esbuild.build({entryPoints:[join(here,'src/linkedin.ts')],outfile:join(dist,'linkedin.js'),bundle:true,format:'iife',target:'chrome110',define,logLevel:'info'})
await esbuild.build({entryPoints:[join(here,'src/list-people.ts')],outfile:join(dist,'list-people.js'),bundle:true,format:'iife',target:'chrome110',define,logLevel:'info'})
await esbuild.build({entryPoints:[join(here,'src/handoff.ts')],outfile:join(dist,'handoff.js'),bundle:true,format:'iife',target:'chrome110',define,logLevel:'info'})
// The toolbar popup is an extension page, not a content script, but extension pages forbid inline
// script -- so it ships as its own bundle too.
await esbuild.build({entryPoints:[join(here,'src/popup.ts')],outfile:join(dist,'popup.js'),bundle:true,format:'iife',target:'chrome110',define,logLevel:'info'})

copyFileSync(join(here,'src/panel.css'),join(dist,'panel.css'))
copyFileSync(join(here,'src/popup.html'),join(dist,'popup.html'))
// Generated by scripts/make-icons.mjs and committed, since dist/ is gitignored.
cpSync(join(here,'icons'),join(dist,'icons'),{recursive:true})

const manifest={
  manifest_version:3,
  name:'Agency ATS — LinkedIn Sourcing',
  version:'0.1.0',
  description:'Capture LinkedIn profiles into your Agency ATS as candidates or contacts.',
  permissions:['storage','tabs'],
  icons:{16:'icons/icon-16.png',32:'icons/icon-32.png',48:'icons/icon-48.png',128:'icons/icon-128.png'},
  host_permissions:['https://*.linkedin.com/*',`${APP_ORIGIN}/*`,`${supabaseOrigin}/*`],
  background:{service_worker:'background.js',type:'module'},
  // Both LinkedIn scripts match the whole site, not just their own routes. Chrome injects content
  // scripts on full page loads ONLY, so a narrow match pattern means a client-side nav from /feed into
  // /in/<slug> leaves the page with no panel at all. Each script gates itself on location.pathname
  // (isProfilePage / isListPage in src/dom.ts) and re-evaluates on every route change.
  content_scripts:[
    {matches:['https://*.linkedin.com/*'],js:['linkedin.js'],css:['panel.css'],run_at:'document_idle'},
    {matches:['https://*.linkedin.com/*'],js:['list-people.js'],css:['panel.css'],run_at:'document_idle'},
    {matches:[`${APP_ORIGIN}/*`],js:['handoff.js'],run_at:'document_idle'},
  ],
  // The toolbar button is the session console: its popup starts, re-aims and ends a sourcing session,
  // and the worker swaps the icon teal/grey and badges it with the capture count.
  action:{
    default_title:'Agency ATS Sourcing',
    default_popup:'popup.html',
    default_icon:{16:'icons/icon-16-idle.png',32:'icons/icon-32-idle.png'},
  },
  commands:{'toggle-panel':{suggested_key:{default:'Alt+Shift+A'},description:'Start or end a sourcing session'}},
}
writeFileSync(join(dist,'manifest.json'),JSON.stringify(manifest,null,2))
console.log(`\nBuilt extension -> ${dist}\n  app origin:  ${APP_ORIGIN}\n  supabase:    ${supabaseOrigin}\nLoad it: chrome://extensions -> Developer mode -> Load unpacked -> select ${dist}`)
