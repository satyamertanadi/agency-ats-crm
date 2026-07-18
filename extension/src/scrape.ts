import type {CapturePayload,EmploymentItem} from './messages'

// LinkedIn's DOM is obfuscated and changes without notice. Every selector here is best-effort with
// fallbacks, and everything scraped lands in an EDITABLE form the user confirms -- a broken selector
// degrades to an empty field, never a wrong save. See extension/README.md.
const txtOf=(node:Element|null|undefined)=>(node?.textContent||'').replace(/\s+/g,' ').trim()
const txt=(sel:string,root:ParentNode=document)=>txtOf(root.querySelector(sel))

export function canonicalProfileUrl(href:string=location.href):string{
  const match=new URL(href,location.origin).pathname.match(/\/in\/([^/]+)/)
  return match?`https://www.linkedin.com/in/${match[1]}/`:href.split('?')[0]
}

// "Position at Company" / "Position @ Company" headline split, used as a fallback when the structured
// experience block isn't readable.
function splitHeadline(headline:string):{position:string;company:string}{
  const parts=headline.split(/\s+(?:at|@)\s+/i)
  if(parts.length>=2)return {position:parts[0].trim(),company:parts.slice(1).join(' at ').trim()}
  return {position:headline,company:''}
}

// Scrape the Experience section into structured rows. LinkedIn renders each role as a list item whose
// first two bold spans are title and company; we read those defensively and skip anything unreadable.
function scrapeExperience():EmploymentItem[]{
  const out:EmploymentItem[]=[]
  const section=document.querySelector('#experience')?.closest('section')||document.querySelector('section[data-view-name="profile-card"] #experience')?.closest('section')
  const items=section?section.querySelectorAll('li.artdeco-list__item'):[]
  let order=0
  items.forEach((li)=>{
    const bold=Array.from(li.querySelectorAll('span[aria-hidden="true"]')).map(txtOf).filter(Boolean)
    const title=bold[0]||''
    // Company often appears as "Company · Full-time"; strip the employment-type suffix.
    const company=(bold[1]||'').split('·')[0].trim()
    if(title.length<2||company.length<2)return
    out.push({title,company_name:company,is_current:/present|sekarang|saat ini/i.test(txtOf(li)),sort_order:order++})
  })
  return out.slice(0,15)
}

function scrapeSkills():{name:string}[]{
  const section=document.querySelector('#skills')?.closest('section')
  if(!section)return []
  const names=new Set<string>()
  section.querySelectorAll('span[aria-hidden="true"]').forEach((span)=>{
    const name=txtOf(span)
    if(name&&name.length<=60&&!/endorsement|·|see more|show all/i.test(name))names.add(name)
  })
  return Array.from(names).slice(0,30).map((name)=>({name}))
}

export interface ScrapedProfile extends CapturePayload{about:string;headline:string}

export function scrapeProfile():ScrapedProfile{
  const full_name=txt('main h1')||txt('h1')
  const headline=txt('main .text-body-medium.break-words')||txt('.pv-text-details__left-panel .text-body-medium')||txt('[data-generated-suggestion-target]')
  const location=txt('main .text-body-small.inline.t-black--light.break-words')||txt('.pv-text-details__left-panel .text-body-small.inline')
  const about=txt('#about')?txtOf(document.querySelector('#about')?.closest('section')?.querySelector('.display-flex.full-width span[aria-hidden="true"]')):''
  const employment=scrapeExperience()
  const skills=scrapeSkills()
  const fromHeadline=splitHeadline(headline)
  const current=employment[0]
  return {
    full_name,headline,about,
    current_position:current?.title||fromHeadline.position,
    current_company:current?.company_name||fromHeadline.company,
    location,linkedin_url:canonicalProfileUrl(),source:'LinkedIn',
    employment,skills,
  }
}

// Open LinkedIn's "Contact info" overlay, read email/phone, and close it. Returns what it found.
// Purely reactive to a user click; never auto-runs. Most profiles won't expose email.
export async function readContactInfo():Promise<{email?:string;phone?:string;website?:string}>{
  const link=document.querySelector<HTMLAnchorElement>('a[href*="overlay/contact-info"], #top-card-text-details-contact-info')
  if(!link)return {}
  link.click()
  const modal=await waitFor(()=>document.querySelector('.artdeco-modal, [role="dialog"]'),3000)
  const result:{email?:string;phone?:string;website?:string}={}
  if(modal){
    const emailLink=modal.querySelector<HTMLAnchorElement>('a[href^="mailto:"]')
    if(emailLink)result.email=emailLink.href.replace(/^mailto:/,'').trim()
    const phoneNode=Array.from(modal.querySelectorAll('span')).map(txtOf).find((t)=>/^[+()\d][\d()\s-]{6,}$/.test(t))
    if(phoneNode)result.phone=phoneNode
    const site=modal.querySelector<HTMLAnchorElement>('a[href^="http"]:not([href*="linkedin.com"])')
    if(site)result.website=site.href
    // Close the overlay so the page is left as we found it.
    modal.querySelector<HTMLButtonElement>('button[aria-label*="Dismiss"], button.artdeco-modal__dismiss')?.click()
  }
  return result
}

function waitFor<T>(get:()=>T|null,timeoutMs:number):Promise<T|null>{
  return new Promise((resolve)=>{
    const start=Date.now()
    const tick=()=>{const v=get();if(v)return resolve(v);if(Date.now()-start>timeoutMs)return resolve(null);setTimeout(tick,120)}
    tick()
  })
}

// Everything visible in the profile main column, for the AI parser. Clipped by the background before send.
export function profileText():string{return txtOf(document.querySelector('main'))}
