// wa.me requires digits-only, country-code-prefixed numbers with no leading 0/+. Local Indonesian
// numbers are stored as entered (e.g. "0857-0833-1426"), so a leading 0 is rewritten to the
// country code (62) -- the workspace's default market -- rather than left to fail silently inside
// WhatsApp. A number already given with a '+' is trusted as already having its real country code.
export function normalizeWhatsAppPhone(phone: string): string | null {
  const trimmed = phone.trim()
  if (!trimmed) return null
  const hadPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null
  if (hadPlus) return digits
  if (digits.startsWith('0')) return `62${digits.slice(1)}`
  return digits
}

// Opens a chat with the message pre-filled in the input box -- nothing sends until the recruiter
// hits send inside WhatsApp itself, so building this link is not itself an outbound contact.
export function whatsAppLink(phone: string, message: string): string | null {
  const normalized = normalizeWhatsAppPhone(phone)
  if (!normalized) return null
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`
}
