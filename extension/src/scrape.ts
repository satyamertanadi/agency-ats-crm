import type {CapturePayload,EducationItem,EmploymentItem,LanguageItem} from './messages'
import {txt,txtOf,waitFor} from './dom'
import {canonicalCompanyUrl,looksLikeFollowerCount,parseCompanySize} from './company'
export {canonicalCompanyUrl,isCompanyPage,looksLikeFollowerCount,parseCompanySize} from './company'

// LinkedIn's DOM is obfuscated and changes without notice. Every selector here is best-effort with
// fallbacks, and everything scraped lands in an EDITABLE form the user confirms -- a broken selector
// degrades to an empty field, never a wrong save. See extension/README.md.

// Each profile-card row puts its fields in the same three typographic slots. Reading by class is far
// more stable than the positional span indexing this used to do, which silently mis-assigned title and
// company whenever LinkedIn added a span (verified badges, "· Full-time", promoted markers).
const BOLD='.t-bold span[aria-hidden="true"]'
const NORMAL='span.t-14.t-normal:not(.t-black--light) span[aria-hidden="true"]'
const LIGHT='span.t-14.t-normal.t-black--light span[aria-hidden="true"]'
const ROW='li.artdeco-list__item'

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

// Read a field from THIS row's own header, never from a nested sub-role. A node belongs to `root` only
// if the nearest enclosing row is root itself -- that one check is what keeps grouped roles (several
// positions under one employer) from bleeding into each other.
function readField(root:Element,selector:string,accept?:(value:string)=>boolean):string{
  for(const node of Array.from(root.querySelectorAll(selector))){
    if(node.closest(ROW)!==root)continue
    const value=txtOf(node)
    if(value&&(!accept||accept(value)))return value
  }
  return ''
}

const CURRENT_RE=/present|sekarang|saat ini/i
const DATE_RE=new RegExp(`(19|20)\\d{2}|${CURRENT_RE.source}`,'i')
const MONTHS:Record<string,number>={
  jan:1,januari:1,january:1,feb:2,februari:2,february:2,mar:3,maret:3,march:3,apr:4,april:4,
  may:5,mei:5,jun:6,juni:6,june:6,jul:7,juli:7,july:7,aug:8,agu:8,agustus:8,august:8,
  sep:9,sept:9,september:9,oct:10,okt:10,oktober:10,october:10,nov:11,november:11,dec:12,des:12,desember:12,december:12,
}

// "Jan 2020 - Present · 3 yrs 2 mos" -> {started_on:'2020-01-01',ended_on:null,is_current:true}.
// Month-only dates become the first of that month and year-only dates become January 1, matching the
// convention the AI parser is instructed to use so both sources agree.
function parseDateRange(text:string):{started_on?:string;ended_on?:string|null;is_current:boolean}{
  const range=text.split('·')[0].trim()
  const [rawStart='',rawEnd='']=range.split(/\s+[-–—]\s+|\s+to\s+/i)
  const is_current=CURRENT_RE.test(rawEnd)||CURRENT_RE.test(range)
  const out:{started_on?:string;ended_on?:string|null;is_current:boolean}={is_current}
  const start=parseDate(rawStart)
  if(start)out.started_on=start
  if(is_current)out.ended_on=null
  else{const end=parseDate(rawEnd);if(end)out.ended_on=end}
  return out
}

function parseDate(part:string):string|undefined{
  const match=part.trim().match(/^([A-Za-z]+)?\s*((?:19|20)\d{2})$/)
  if(!match)return undefined
  const month=match[1]?MONTHS[match[1].toLowerCase()]:undefined
  return `${match[2]}-${String(month||1).padStart(2,'0')}-01`
}

// Only the outermost rows: a grouped employer renders its positions as rows nested inside its own row,
// and treating those as top-level is what produced duplicate/garbled entries.
function topLevelRows(section:Element|null|undefined):Element[]{
  if(!section)return []
  return Array.from(section.querySelectorAll(ROW)).filter((li)=>!li.parentElement?.closest(ROW))
}

// Company often appears as "Company · Full-time"; strip the employment-type suffix.
const cleanCompany=(value:string)=>value.split('·')[0].trim()

function sectionFor(anchorId:string):Element|null{
  return document.querySelector(`#${anchorId}`)?.closest('section')
    ||document.querySelector(`section[data-view-name="profile-card"] #${anchorId}`)?.closest('section')
    ||null
}

function scrapeExperience():EmploymentItem[]{
  const out:EmploymentItem[]=[]
  let order=0
  for(const row of topLevelRows(sectionFor('experience'))){
    const nested=Array.from(row.querySelectorAll(ROW)).filter((li)=>li.parentElement?.closest(ROW)===row)
    if(nested.length){
      // Grouped employer: the outer row's bold slot holds the COMPANY, each nested row holds a title.
      const company=cleanCompany(readField(row,BOLD))
      for(const sub of nested){
        const title=readField(sub,BOLD)
        if(title.length<2||company.length<2)continue
        const dates=parseDateRange(readField(sub,LIGHT,(v)=>DATE_RE.test(v)))
        out.push({title,company_name:company,location:readField(sub,LIGHT,(v)=>!DATE_RE.test(v))||undefined,...dates,sort_order:order++})
      }
      continue
    }
    const title=readField(row,BOLD)
    const company=cleanCompany(readField(row,NORMAL))||cleanCompany(readField(row,BOLD))
    if(title.length<2||company.length<2)continue
    const dateText=readField(row,LIGHT,(v)=>DATE_RE.test(v))
    const dates=dateText?parseDateRange(dateText):{is_current:CURRENT_RE.test(txtOf(row))}
    out.push({title,company_name:company,location:readField(row,LIGHT,(v)=>!DATE_RE.test(v))||undefined,...dates,sort_order:order++})
  }
  if(out.length)return out.slice(0,15)
  return legacyExperience()
}

// The pre-existing positional read, kept as a last resort for layouts where none of the typographic
// classes above match. Wrong-but-empty beats wrong-and-populated, so it only runs when we got nothing.
function legacyExperience():EmploymentItem[]{
  const out:EmploymentItem[]=[]
  let order=0
  for(const li of topLevelRows(sectionFor('experience'))){
    const bold=Array.from(li.querySelectorAll('span[aria-hidden="true"]')).map(txtOf).filter(Boolean)
    const title=bold[0]||''
    const company=cleanCompany(bold[1]||'')
    if(title.length<2||company.length<2)continue
    out.push({title,company_name:company,is_current:CURRENT_RE.test(txtOf(li)),sort_order:order++})
  }
  return out.slice(0,15)
}

function scrapeEducation():EducationItem[]{
  const out:EducationItem[]=[]
  let order=0
  for(const row of topLevelRows(sectionFor('education'))){
    const institution=readField(row,BOLD)
    if(institution.length<2)continue
    // "LL.M., Law" -> degree "LL.M.", field "Law".
    const study=readField(row,NORMAL)
    const comma=study.indexOf(',')
    const degree=comma>0?study.slice(0,comma).trim():study
    const field=comma>0?study.slice(comma+1).trim():''
    const dates=parseDateRange(readField(row,LIGHT,(v)=>DATE_RE.test(v)))
    out.push({institution,degree:degree||undefined,field_of_study:field||undefined,started_on:dates.started_on,ended_on:dates.ended_on,sort_order:order++})
  }
  return out.slice(0,10)
}

function scrapeLanguages():LanguageItem[]{
  const out:LanguageItem[]=[]
  for(const row of topLevelRows(sectionFor('languages'))){
    const language=readField(row,BOLD)
    if(language.length<2)continue
    out.push({language,proficiency:readField(row,LIGHT)||undefined})
  }
  return out.slice(0,10)
}

function scrapeSkills():{name:string}[]{
  const section=sectionFor('skills')
  if(!section)return []
  const names=new Set<string>()
  for(const row of topLevelRows(section)){
    const name=readField(row,BOLD)
    if(name&&name.length<=60)names.add(name)
  }
  // Fallback: the old text heuristic, for layouts that don't use the bold slot for skill names.
  if(!names.size){
    section.querySelectorAll('span[aria-hidden="true"]').forEach((span)=>{
      const name=txtOf(span)
      if(name&&name.length<=60&&!/endorsement|·|see more|show all/i.test(name))names.add(name)
    })
  }
  return Array.from(names).slice(0,30).map((name)=>({name}))
}

// The connection/follower counters share the location's class, and matching them first is why Location
// so often arrived as "342 connections".
const NOT_LOCATION=/\d+\s*(connections?|followers?|mutual)|contact info/i

function scrapeLocation():string{
  const card=document.querySelector('main h1')?.closest('section')
  if(card){
    for(const node of Array.from(card.querySelectorAll('.text-body-small'))){
      const value=txtOf(node)
      if(value&&!NOT_LOCATION.test(value))return value
    }
  }
  const legacy=txt('main .text-body-small.inline.t-black--light.break-words')||txt('.pv-text-details__left-panel .text-body-small.inline')
  return NOT_LOCATION.test(legacy)?'':legacy
}

function scrapeAbout():string{
  const section=sectionFor('about')
  if(!section)return ''
  return txtOf(section.querySelector('.display-flex.full-width span[aria-hidden="true"]'))
    ||txtOf(section.querySelector('.inline-show-more-text span[aria-hidden="true"]'))
}

// Expand in-page "…see more" toggles so About and role descriptions are scraped in full instead of
// truncated. Buttons only, deliberately: "Show all N experiences" is an ANCHOR that navigates away to
// /details/experience, which would yank the page out from under the user.
async function expandSections():Promise<void>{
  const scopes=[sectionFor('about'),sectionFor('experience')].filter(Boolean) as Element[]
  let clicked=false
  for(const scope of scopes){
    scope.querySelectorAll<HTMLButtonElement>('button.inline-show-more-text__button,button[aria-label^="see more" i],button[aria-label^="lihat selengkapnya" i]').forEach((button)=>{
      if(button.getAttribute('aria-expanded')==='true')return
      button.click();clicked=true
    })
  }
  if(clicked)await new Promise((resolve)=>setTimeout(resolve,120))
}

export interface ScrapedProfile extends CapturePayload{about:string;headline:string}

// Async because the old synchronous pass ran before LinkedIn had finished rendering, which is the
// single biggest cause of blank fields. Waits for the name, gives the experience card a short grace
// period (some profiles genuinely have none), expands truncated text, and only then reads.
export async function scrapeProfile():Promise<ScrapedProfile>{
  await waitFor(()=>txt('main h1')||null,3000)
  await waitFor(()=>sectionFor('experience'),1200)
  await expandSections()
  const full_name=txt('main h1')||txt('h1')
  const headline=txt('main .text-body-medium.break-words')||txt('.pv-text-details__left-panel .text-body-medium')||txt('[data-generated-suggestion-target]')
  const employment=scrapeExperience()
  const fromHeadline=splitHeadline(headline)
  // The experience list is not reliably current-first, so trust is_current before position in the list.
  const current=employment.find((role)=>role.is_current)||employment[0]
  return {
    full_name,headline,about:scrapeAbout(),
    current_position:current?.title||fromHeadline.position,
    current_company:current?.company_name||fromHeadline.company,
    location:scrapeLocation(),linkedin_url:canonicalProfileUrl(),source:'LinkedIn',
    employment,education:scrapeEducation(),skills:scrapeSkills(),languages:scrapeLanguages(),
  }
}

export const hasContactInfoLink=()=>Boolean(document.querySelector('a[href*="overlay/contact-info"], #top-card-text-details-contact-info'))

// Open LinkedIn's "Contact info" overlay, read email/phone, and close it. Returns what it found.
// Most profiles won't expose an email.
export async function readContactInfo():Promise<{email?:string;phone?:string;website?:string}>{
  const link=document.querySelector<HTMLAnchorElement>('a[href*="overlay/contact-info"], #top-card-text-details-contact-info')
  if(!link)return {}
  link.click()
  const modal=await waitFor(()=>document.querySelector('.artdeco-modal, [role="dialog"]'),3000)
  const result:{email?:string;phone?:string;website?:string}={}
  if(modal){
    // The overlay groups each detail in its own ci-* section. Reading those beats regex-scanning every
    // span in the modal, which used to pick up dates and connection counts as "phone numbers".
    const emailLink=modal.querySelector<HTMLAnchorElement>('.ci-email a[href^="mailto:"]')||modal.querySelector<HTMLAnchorElement>('a[href^="mailto:"]')
    if(emailLink)result.email=emailLink.href.replace(/^mailto:/,'').trim()
    const phoneScope=modal.querySelector('.ci-phone')||modal
    const phone=Array.from(phoneScope.querySelectorAll('span')).map(txtOf).find((t)=>/^[+()\d][\d()\s-]{6,}$/.test(t))
    if(phone)result.phone=phone
    const siteScope=modal.querySelector('.ci-websites')||modal
    const site=siteScope.querySelector<HTMLAnchorElement>('a[href^="http"]:not([href*="linkedin.com"])')
    if(site)result.website=site.href
    // Close the overlay so the page is left as we found it; Escape covers layouts without a dismiss button.
    const dismiss=modal.querySelector<HTMLButtonElement>('button[aria-label*="Dismiss" i], button.artdeco-modal__dismiss')
    if(dismiss)dismiss.click()
    else document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
  }
  return result
}

// Text for the AI parser. Assembled from the sections we actually care about rather than main's entire
// textContent: promo modules and "More profiles for you" used to eat into the server's 20k clip and
// push real profile content out of the prompt. Smaller prompt, faster and cheaper parse.
const AI_TEXT_LIMIT=12000

export function profileText():string{
  const parts:string[]=[]
  const card=document.querySelector('main h1')?.closest('section')
  if(card)parts.push(txtOf(card))
  for(const id of ['about','experience','education','skills','languages','certifications'] as const){
    const section=sectionFor(id)
    if(section)parts.push(txtOf(section))
  }
  const assembled=parts.filter(Boolean).join('\n\n')
  // If none of the anchors resolved we'd be sending almost nothing; fall back to the whole column.
  return (assembled.length>200?assembled:txtOf(document.querySelector('main'))).slice(0,AI_TEXT_LIMIT)
}

// ---------------------------------------------------------------------------------------------
// Client company capture
// ---------------------------------------------------------------------------------------------

export interface ScrapedCompany{
  name:string
  industry:string
  website:string
  location:string
  company_size:string
  linkedin_url:string
}

export async function scrapeCompany():Promise<ScrapedCompany>{
  await waitFor(()=>document.querySelector('main'),4000)

  const name=txt('h1')||txt('.org-top-card-summary__title')||''
  // The dimension list under the company name. Each <div> is one labelled fact.
  const facts=Array.from(document.querySelectorAll('.org-top-card-summary-info-list__info-item, .org-page-details__definition-text, dd'))
    .map((node)=>txtOf(node)).filter(Boolean)

  let industry=''
  let size=''
  let where=''
  for(const fact of facts){
    if(!size&&!looksLikeFollowerCount(fact)){
      const parsed=parseCompanySize(fact)
      if(parsed){size=parsed;continue}
    }
    if(looksLikeFollowerCount(fact))continue
    // A comma-separated place reads as a location; a single word beside it is usually the industry.
    if(!where&&/,/.test(fact)&&!/employees/i.test(fact)){where=fact;continue}
    if(!industry&&!/employees|,/i.test(fact))industry=fact
  }

  const websiteNode=document.querySelector<HTMLAnchorElement>('a[href^="http"][data-tracking-control-name*="website"], .org-top-card-primary-actions a[href^="http"]:not([href*="linkedin.com"])')
  const website=websiteNode?.href&&!websiteNode.href.includes('linkedin.com')?websiteNode.href:''

  return {
    name,
    industry,
    website,
    location:where,
    company_size:size,
    linkedin_url:canonicalCompanyUrl(location.href)??'',
  }
}
