// Shared DOM helpers for the content scripts. Kept deliberately small: element building, text reading,
// and the two things LinkedIn's SPA forces on us -- waiting for lazily-rendered nodes, and noticing
// client-side navigation. Chrome only injects content scripts on a full page load, so without
// onUrlChange a route change from /feed into /in/<slug> leaves the page with no working panel.

export function el<K extends keyof HTMLElementTagNameMap>(tag:K,props:Partial<HTMLElementTagNameMap[K]>={},children:(Node|string)[]=[]):HTMLElementTagNameMap[K]{
  const node=document.createElement(tag);Object.assign(node,props);for(const c of children)node.append(c);return node
}

export const txtOf=(node:Element|null|undefined)=>(node?.textContent||'').replace(/\s+/g,' ').trim()
export const txt=(sel:string,root:ParentNode=document)=>txtOf(root.querySelector(sel))

// Resolve as soon as `get` returns something truthy. Driven by a MutationObserver so it fires on the
// same frame the node appears, with a slow poll as the safety net for changes an observer can't see
// (attribute-only reveals, same-node text swaps) and to enforce the timeout.
export function waitFor<T>(get:()=>T|null|undefined,timeoutMs:number):Promise<T|null>{
  const immediate=get()
  if(immediate)return Promise.resolve(immediate)
  return new Promise((resolve)=>{
    let done=false
    const finish=(value:T|null)=>{if(done)return;done=true;observer.disconnect();clearTimeout(timer);clearInterval(poll);resolve(value)}
    const check=()=>{const v=get();if(v)finish(v)}
    const observer=new MutationObserver(check)
    observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true})
    const poll=setInterval(check,150)
    const timer=setTimeout(()=>finish(null),timeoutMs)
    check()
  })
}

// Fire `cb` whenever the URL changes, however it changed.
//
// Worth being precise about why this is built the way it is: LinkedIn's router calls pushState from
// the PAGE's JS context, and a content script runs in an isolated world, so monkey-patching
// history.pushState here would never see it -- that trick only works for same-world callers. What
// actually catches a client-side nav is the DOM observer below (a route change always rewrites the
// page) with a slow interval as the backstop. popstate/hashchange do reach us, so they're wired up
// directly for the instant case.
const urlListeners=new Set<(url:string)=>void>()
let urlHooked=false
let lastUrl=location.href
let urlTimer:ReturnType<typeof setTimeout>|undefined

function announceUrl(){
  if(location.href===lastUrl)return
  lastUrl=location.href
  for(const listener of urlListeners)listener(lastUrl)
}

export function onUrlChange(cb:(url:string)=>void):void{
  urlListeners.add(cb)
  if(urlHooked)return
  urlHooked=true
  window.addEventListener('popstate',announceUrl)
  window.addEventListener('hashchange',announceUrl)
  const observer=new MutationObserver(()=>{
    if(urlTimer)return
    urlTimer=setTimeout(()=>{urlTimer=undefined;announceUrl()},100)
  })
  observer.observe(document.documentElement,{childList:true,subtree:true})
  setInterval(announceUrl,1000)
}

// Coalesced body observer, shared by every caller so we only ever attach one. Replaces the polling
// setIntervals the content scripts used to re-assert their injected UI.
let bodyHooked=false
const bodyListeners=new Set<()=>void>()
let bodyTimer:ReturnType<typeof setTimeout>|undefined

export function observeBody(cb:()=>void,debounceMs=200):void{
  bodyListeners.add(cb)
  if(bodyHooked)return
  bodyHooked=true
  const observer=new MutationObserver(()=>{
    if(bodyTimer)clearTimeout(bodyTimer)
    bodyTimer=setTimeout(()=>{for(const listener of bodyListeners)listener()},debounceMs)
  })
  observer.observe(document.documentElement,{childList:true,subtree:true})
}

// The profile's action row -- the strip holding Message / Connect / More. Anchored the way scrape.ts
// anchors everything: via `main h1` and the buttons' own visible labels, never via class names.
// LinkedIn's classes are obfuscated and rotate; the words on its buttons do not.
const ACTION_LABEL=/^(message|connect|follow|more|pending|invite|hubungi|sambungkan)/i
export function findProfileActionRow():HTMLElement|null{
  const card=document.querySelector('main h1')?.closest('section')
  if(card){
    for(const node of Array.from(card.querySelectorAll<HTMLElement>('button,a'))){
      const label=(txtOf(node)||node.getAttribute('aria-label')||'').trim()
      if(!ACTION_LABEL.test(label))continue
      const row=node.parentElement
      // Guard against matching a button mounted directly on the section: that would make the whole
      // top card the "row" and inject our button into the middle of the profile header.
      if(row&&row!==card&&row.childElementCount<=8)return row
    }
  }
  return document.querySelector<HTMLElement>('.pvs-profile-actions,.pv-top-card-v2-ctas')
}

// LinkedIn's dark mode is its own site setting and does not reliably track the OS, so read its DOM
// flag first and only fall back to the media query. Both content scripts theme their injected UI from
// this; the popup can't (it doesn't run inside LinkedIn) and uses the media query alone.
export function isDark():boolean{
  const root=document.documentElement
  const flag=root.getAttribute('data-theme')||root.getAttribute('data-color-mode')||root.className||''
  if(/dark/i.test(flag))return true
  if(/light/i.test(flag))return false
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches??false
}

export const isProfilePage=(href:string=location.href)=>/^\/in\/[^/]+/.test(new URL(href,location.origin).pathname)
export const isListPage=(href:string=location.href)=>{
  const path=new URL(href,location.origin).pathname
  return /^\/search\/results\/people/.test(path)||/^\/company\/[^/]+\/people/.test(path)||/^\/feed/.test(path)||/^\/posts\//.test(path)||/^\/mynetwork/.test(path)
}
