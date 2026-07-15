const encoder=new TextEncoder();const decoder=new TextDecoder()

export async function sha256(value:string){
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(value))
  return [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,'0')).join('')
}

export function randomToken(bytes=32){
  const value=crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')
}

async function encryptionKey(){
  const source=Deno.env.get('CALENDAR_TOKEN_ENCRYPTION_KEY')
  if(!source||source.length<32)throw new Error('CALENDAR_TOKEN_ENCRYPTION_KEY must contain at least 32 characters.')
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(source))
  return crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['encrypt','decrypt'])
}

export async function encryptSecret(value:string){
  const iv=crypto.getRandomValues(new Uint8Array(12));const key=await encryptionKey()
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(value))
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(encrypted)))}`
}

export async function decryptSecret(value:string){
  const [ivPart,dataPart]=value.split('.');if(!ivPart||!dataPart)throw new Error('Stored Calendar credential is invalid.')
  const iv=Uint8Array.from(atob(ivPart),(character)=>character.charCodeAt(0));const data=Uint8Array.from(atob(dataPart),(character)=>character.charCodeAt(0))
  const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv},await encryptionKey(),data)
  return decoder.decode(decrypted)
}
