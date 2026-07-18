// Build the MV3 extension into extension/dist. Uses the repo's own esbuild (resolved from the root
// node_modules -- the extension has no separate install step). Config (Supabase URL + anon key + the
// ATS app origin) is read from env or the root .env.local at build time and injected via `define`, so
// no secrets are hardcoded in source. The anon key is a public client key (the same one shipped in the
// SPA bundle), so embedding it in dist is expected, not a leak.
import * as esbuild from 'esbuild'
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'

const here=dirname(fileURLToPath(import.meta.url))
const dist=join(here,'dist')

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

const SUPABASE_URL=pick('EXT_SUPABASE_URL','VITE_SUPABASE_URL')
const SUPABASE_ANON_KEY=pick('EXT_SUPABASE_ANON_KEY','VITE_SUPABASE_ANON_KEY')
const APP_ORIGIN=pick('EXT_APP_ORIGIN')||'http://localhost:5173'
if(!SUPABASE_URL||!SUPABASE_ANON_KEY){
  console.error('Missing Supabase config. Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in ../.env.local, or EXT_* in extension/.env')
  process.exit(1)
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
const define={
  __SUPABASE_URL__:JSON.stringify(SUPABASE_URL),
  __SUPABASE_ANON_KEY__:JSON.stringify(SUPABASE_ANON_KEY),
  __APP_ORIGIN__:JSON.stringify(APP_ORIGIN),
}

// Service worker: ESM (MV3 allows "type":"module"), bundles @supabase/supabase-js.
await esbuild.build({entryPoints:[join(here,'src/background.ts')],outfile:join(dist,'background.js'),bundle:true,format:'esm',target:'chrome110',define,logLevel:'info'})
// Content scripts must be classic scripts -> IIFE.
await esbuild.build({entryPoints:[join(here,'src/linkedin.ts')],outfile:join(dist,'linkedin.js'),bundle:true,format:'iife',target:'chrome110',define,logLevel:'info'})
await esbuild.build({entryPoints:[join(here,'src/list-people.ts')],outfile:join(dist,'list-people.js'),bundle:true,format:'iife',target:'chrome110',define,logLevel:'info'})
await esbuild.build({entryPoints:[join(here,'src/handoff.ts')],outfile:join(dist,'handoff.js'),bundle:true,format:'iife',target:'chrome110',define,logLevel:'info'})

copyFileSync(join(here,'src/panel.css'),join(dist,'panel.css'))

const manifest={
  manifest_version:3,
  name:'Agency ATS — LinkedIn Sourcing',
  version:'0.1.0',
  description:'Capture LinkedIn profiles into your Agency ATS as candidates or contacts.',
  permissions:['storage','tabs'],
  host_permissions:['https://*.linkedin.com/*',`${APP_ORIGIN}/*`,`${supabaseOrigin}/*`],
  background:{service_worker:'background.js',type:'module'},
  content_scripts:[
    {matches:['https://*.linkedin.com/in/*'],js:['linkedin.js'],css:['panel.css'],run_at:'document_idle'},
    {matches:['https://*.linkedin.com/search/results/people/*','https://*.linkedin.com/company/*/people/*','https://*.linkedin.com/feed/*','https://*.linkedin.com/posts/*'],js:['list-people.js'],css:['panel.css'],run_at:'document_idle'},
    {matches:[`${APP_ORIGIN}/*`],js:['handoff.js'],run_at:'document_idle'},
  ],
  action:{default_title:'Agency ATS Sourcing'},
}
writeFileSync(join(dist,'manifest.json'),JSON.stringify(manifest,null,2))
console.log(`\nBuilt extension -> ${dist}\n  app origin:  ${APP_ORIGIN}\n  supabase:    ${supabaseOrigin}\nLoad it: chrome://extensions -> Developer mode -> Load unpacked -> select extension/dist`)
