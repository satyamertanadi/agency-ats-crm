/* wa.me requires digits-only, country-code-prefixed numbers with no leading 0 or +. Numbers are stored
 * as entered ("0857-0833-1426"), so a leading 0 has to be rewritten to a country code before the link
 * will resolve.
 *
 * Which country code was hardcoded to 62. That was right for the workspace it was written for and
 * silently wrong for every other one: an agency elsewhere got Indonesian numbers with no error --
 * WhatsApp simply reports the contact does not exist, which reads as the candidate's number being bad
 * rather than the product's assumption being bad. It is a workspace setting now, still defaulting to
 * 62 so nothing changes for the workspace that relied on it.
 *
 * A number already given with '+' is trusted as carrying its real country code. */
export const DEFAULT_COUNTRY_CODE='62'

export function normalizeWhatsAppPhone(phone:string,countryCode:string=DEFAULT_COUNTRY_CODE):string|null {
  const trimmed=phone.trim()
  if(!trimmed)return null
  const hadPlus=trimmed.startsWith('+')
  const digits=trimmed.replace(/\D/g,'')
  if(!digits)return null
  if(hadPlus)return digits
  // A malformed setting must not produce a malformed link: fall back rather than build a dead number.
  const cleaned=countryCode.replace(/\D/g,'')
  const prefix=/^\d{1,4}$/.test(cleaned)?cleaned:DEFAULT_COUNTRY_CODE
  if(digits.startsWith('0'))return `${prefix}${digits.slice(1)}`
  return digits
}

/* The opening message.
 *
 * It was an English sentence baked into the candidate page, in a product whose primary market writes
 * to candidates in Indonesian. A recruiter's first line to a candidate is not a detail the tool should
 * be choosing, so it is a template the workspace owns, with placeholders for the three things the app
 * can fill in.
 *
 * Placeholders are substituted, never evaluated: this string comes from a settings field, and the
 * whole point is that an agency can write anything in it. */
export const DEFAULT_WHATSAPP_TEMPLATE='Hi {first_name}, this is {consultant} from {agency}. Do you have a moment to chat?'
export const WHATSAPP_PLACEHOLDERS=['first_name','consultant','agency'] as const

export function renderWhatsAppMessage(template:string|null|undefined,values:{first_name:string;consultant:string;agency:string}):string {
  const source=(template||'').trim()||DEFAULT_WHATSAPP_TEMPLATE
  return source.replace(/\{(first_name|consultant|agency)\}/g,(_match,key:keyof typeof values)=>values[key])
}

// Opens a chat with the message pre-filled in the input box -- nothing sends until the recruiter
// hits send inside WhatsApp itself, so building this link is not itself an outbound contact.
export function whatsAppLink(phone:string,message:string,countryCode?:string):string|null {
  const normalized=normalizeWhatsAppPhone(phone,countryCode)
  if(!normalized)return null
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`
}
