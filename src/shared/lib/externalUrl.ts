/* Deciding whether a stored URL may be presented as a link.
 *
 * Imported client and candidate records carry whatever the previous system held in a "website" or
 * "LinkedIn" column, which in practice includes "N/A", "-", "ask Budi", a phone number, and a domain
 * with no scheme. Rendering all of those inside an <a href> produced links that resolve to a path on
 * the ATS itself ("/N/A"), which is the kind of thing a client notices in a screen share -- and it is
 * also how a `javascript:` value in an imported column would become a live link.
 *
 * Two rules shape this:
 *
 *   1. The stored value is never rewritten. This returns a DISPLAY decision, not a correction. The
 *      column keeps exactly what the previous system wrote until a person edits it, so nothing is
 *      silently "fixed" out from under an agency that may be mid-migration.
 *   2. A scheme-less hostname ("acme.co.id", "www.acme.co.id") is a real URL that a human wrote
 *      correctly, so it gets a link -- via an https:// href, while still DISPLAYING the stored text.
 *      Supplying a scheme the value implies is not the same as changing the record.
 *
 * Everything else is `valid:false`, which the UI renders as plain text with a correction flag rather
 * than as a link the reader might trust.
 */

export interface ExternalUrl {
  /** Exactly what is stored, for display. Never normalised. */
  readonly text: string
  /** Safe to put in an href, or null when the value is not a usable URL. */
  readonly href: string | null
  readonly valid: boolean
}

/* Allow-list, not a block-list. `javascript:`, `data:` and `vbscript:` are the ones that matter, but
 * enumerating hostile schemes means losing to the next one; naming the two that are legitimate for an
 * outbound link cannot. */
const LINKABLE_PROTOCOLS = new Set(['http:', 'https:'])

/* A hostname with at least one dot and a plausible TLD, optionally followed by a path/query. Kept
 * deliberately strict: this decides what gets a scheme added on the reader's behalf, so "ask Budi"
 * and "0812-3456-7890" must not match. The TLD floor of two letters is what excludes an IPv4-looking
 * string and a decimal number. */
const BARE_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i

export function externalUrl(raw: string | null | undefined): ExternalUrl | null {
  const text = raw?.trim() ?? ''
  if (!text) return null
  const invalid: ExternalUrl = { text, href: null, valid: false }
  // Whitespace inside a URL is never a URL, and is the shape most free-text junk arrives in.
  if (/\s/.test(text)) return invalid

  /* A dot is deliberately NOT allowed in the scheme here, though RFC 3986 permits one.
   *
   * Without that restriction "acme.co.id:8443/path" parses as a URL whose protocol is "acme.co.id:",
   * so a perfectly ordinary host-and-port was rejected while the form's `pattern` accepted it -- the
   * two halves of the same rule disagreeing, which is what the URL_INPUT_PATTERN test now pins. For
   * this field a dotted prefix before a colon is a hostname every time. Nothing is weakened by it:
   * every scheme that makes this dangerous (javascript, data, vbscript, file) is a single word, still
   * matches here, and is still refused by the allow-list below. */
  if (/^[a-z][a-z0-9+-]*:/i.test(text)) {
    // It declares a scheme, so it is judged on that scheme alone -- no guessing, no repair.
    let parsed: URL
    try { parsed = new URL(text) } catch { return invalid }
    return LINKABLE_PROTOCOLS.has(parsed.protocol) ? { text, href: parsed.href, valid: true } : invalid
  }

  if (!BARE_HOST.test(text)) return invalid
  try {
    // Round-tripped through URL so a value that only LOOKS like a host still has to parse.
    return { text, href: new URL(`https://${text}`).href, valid: true }
  } catch { return invalid }
}

/* For form validation. Empty is allowed -- these fields are all optional, and refusing to save a
 * record because its website is blank would be worse than the problem being solved. */
export const isEnterableUrl = (raw: string | null | undefined) => {
  const text = raw?.trim() ?? ''
  return text === '' || externalUrl(text)?.valid === true
}

export const URL_HINT = 'A full web address, for example https://acme.co.id'

/* The same rule as `externalUrl`, expressed for a native `pattern` attribute.
 *
 * It is deliberately a SECOND expression of the rule rather than a shared source, because HTML
 * patterns have no lookahead-free way to say "a scheme we allow, or no scheme at all" as compactly as
 * the function does, and a pattern that tried would be unreadable. externalUrl.test.ts pins the pair
 * against the same values, which is what keeps them honest.
 *
 * Why not `type="url"`: a native url input REJECTS "acme.co.id" -- the way most people write a website
 * -- and ACCEPTS "javascript:alert(1)", because it validates syntax rather than scheme. That is
 * exactly backwards for this field. */
/* String.raw, not a quoted string: written as '...\.' the backslashes are consumed by the STRING
 * literal, so the browser receives a pattern where every `.` matches any character -- which would
 * have quietly accepted "javascript:alert(1)x" and defeated the whole attribute. */
export const URL_INPUT_PATTERN = String.raw`(https?://)?[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}(:\d{1,5})?([/?#].*)?`
