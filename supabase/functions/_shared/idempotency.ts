// Keeps a pre-P0 browser bundle safe during a rolling Edge deployment. New UI
// bundles send their own stable UUID; older bundles get a deterministic key for
// one hour, which deduplicates retries without making an intentional future send
// reuse an expired delivery forever.
export async function compatibilityRequestKey(payload:unknown){
  const hour=Math.floor(Date.now()/3_600_000)
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({hour,payload})))
  const hex=[...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,'0')).join('').slice(0,32)
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`
}
