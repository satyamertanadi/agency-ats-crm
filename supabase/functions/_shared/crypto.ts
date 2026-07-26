const encoder=new TextEncoder();const decoder=new TextDecoder()

export async function sha256(value:string){
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(value))
  return [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,'0')).join('')
}

export function randomToken(bytes=32){
  const value=crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')
}

// Calendar refresh tokens are encrypted at rest. Rotating CALENDAR_TOKEN_ENCRYPTION_KEY used to
// permanently destroy every stored token: the wire format (iv.ciphertext) carried no identifier for
// which key encrypted it, so decryptSecret always derived the key from whatever
// CALENDAR_TOKEN_ENCRYPTION_KEY currently held -- the moment it changed, every existing row became
// undecryptable with no recovery path short of re-running Google OAuth for every connected user.
//
// The format now carries a version label (version.iv.ciphertext). CALENDAR_TOKEN_ENCRYPTION_KEY_VERSION
// names the label new writes are stamped with, defaulting to '1' so a deployment that has never
// rotated needs no new configuration at all. The label must not contain a literal '.' (it is
// operator-set configuration, not user input, so this is a documented constraint rather than a
// validated one). To rotate the key:
//   1. Set CALENDAR_TOKEN_ENCRYPTION_KEY_PREVIOUS and CALENDAR_TOKEN_ENCRYPTION_KEY_PREVIOUS_VERSION
//      to the OLD key and the label it was stamped with.
//   2. Set CALENDAR_TOKEN_ENCRYPTION_KEY to the NEW key and CALENDAR_TOKEN_ENCRYPTION_KEY_VERSION to
//      a NEW label, distinct from every label used before.
// New writes use the new key immediately. Existing rows keep decrypting via the previous key until
// they are naturally rewritten (every calendar-sync token refresh calls encryptSecret again) or
// explicitly re-encrypted; once nothing references the previous label, the _PREVIOUS* variables can
// be removed. Legacy two-part values (no version label at all, predating this change) are treated as
// belonging to the CURRENT label -- every such value was encrypted under whatever key
// CALENDAR_TOKEN_ENCRYPTION_KEY holds today, since no rotation has ever happened before now.
const CURRENT_KEY_VERSION=Deno.env.get('CALENDAR_TOKEN_ENCRYPTION_KEY_VERSION')?.trim()||'1'

async function importEncryptionKey(source:string|undefined,version:string){
  if(!source||source.length<32)throw new Error(`Calendar encryption key is unavailable for key version ${version}.`)
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(source))
  return crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['encrypt','decrypt'])
}

async function encryptionKeyFor(version:string){
  if(version===CURRENT_KEY_VERSION)return importEncryptionKey(Deno.env.get('CALENDAR_TOKEN_ENCRYPTION_KEY'),version)
  const previousVersion=Deno.env.get('CALENDAR_TOKEN_ENCRYPTION_KEY_PREVIOUS_VERSION')?.trim()
  if(previousVersion&&version===previousVersion)return importEncryptionKey(Deno.env.get('CALENDAR_TOKEN_ENCRYPTION_KEY_PREVIOUS'),version)
  throw new Error(`Stored Calendar credential uses an unrecognized key version (${version}).`)
}

export async function encryptSecret(value:string){
  const iv=crypto.getRandomValues(new Uint8Array(12));const key=await encryptionKeyFor(CURRENT_KEY_VERSION)
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(value))
  return `${CURRENT_KEY_VERSION}.${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(encrypted)))}`
}

export async function decryptSecret(value:string){
  const parts=value.split('.')
  // Legacy two-part values predate key versioning; see the block comment above for why they map to
  // the current label rather than any other one.
  const [version,ivPart,dataPart]=parts.length===3?parts:parts.length===2?[CURRENT_KEY_VERSION,parts[0],parts[1]]:[]
  if(!version||!ivPart||!dataPart)throw new Error('Stored Calendar credential is invalid.')
  const iv=Uint8Array.from(atob(ivPart),(character)=>character.charCodeAt(0));const data=Uint8Array.from(atob(dataPart),(character)=>character.charCodeAt(0))
  const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv},await encryptionKeyFor(version),data)
  return decoder.decode(decrypted)
}
