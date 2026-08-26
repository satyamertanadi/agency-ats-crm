/* Front-line detection of a value that is not a person's name.
 *
 * The production workspace contained a scraped sentence sitting where a candidate's name should be.
 * It reached the database because nothing between a paste and an INSERT ever looked at it, and once
 * there it rendered in every list, every shortlist and every client-facing profile.
 *
 * THIS FLAGS. IT NEVER REJECTS.
 *
 * That is the whole design constraint, and it is not squeamishness. Names are the single worst
 * category of data to apply rules to: "Maria del Carmen Fernandez de la Vega Sanz" is six words,
 * Indonesian names frequently have no surname at all, and a rule confident enough to refuse input
 * will eventually refuse a real person trying to be entered into a recruitment database by someone
 * who then has to work around the product. A prompt costs nothing when it is wrong.
 *
 * So every signal below is something that cannot appear in a name -- a digit, an at-sign, a URL --
 * or a length no name reaches, or lowercase English function words with spaces on both sides, which
 * is prose. The nobiliary particles that DO legitimately appear lowercase inside names (van, der,
 * de, la, bin, binti, al) are deliberately absent from that list.
 *
 * scripts/credibility-audit.sql applies the same rules to records already stored and is the
 * authority for auditing; this is the cheaper prompt at the point of entry. They are allowed to
 * differ in strictness -- one is a question asked of a person who can answer it, the other is a
 * report read later -- but neither may ever delete or refuse anything on its own.
 */

export type NameConcern='digits'|'email'|'url'|'too_long'|'too_many_words'|'reads_as_prose'

/** Words that make a string prose rather than a name. Deliberately excludes every particle that
 *  appears inside real names (van, der, den, de, del, la, le, bin, binti, al, ibn, dos, da). */
const PROSE_WORDS=/\s(is|was|are|were|has|have|the|and|with|for|that|which|his|her|their|this|from|about)\s/i

/* Nine, not six. "Maria del Carmen Fernandez de la Vega Sanz" is six words and entirely real; long
 * Indonesian and Arabic names run longer still. Nine is past anything a name reaches and short of
 * anything a sentence does not. */
const MAX_WORDS=9
const MAX_LENGTH=100

/** What is wrong with this as a name, or null when nothing is. Order is most-specific first, so the
 *  message names the clearest signal rather than the first one checked. */
export function nameConcern(raw:string|null|undefined):NameConcern|null{
  const value=(raw||'').trim()
  if(!value)return null
  if(/[0-9]/.test(value))return 'digits'
  if(value.includes('@'))return 'email'
  if(/(https?:\/\/|www\.)/i.test(value))return 'url'
  if(value.length>MAX_LENGTH)return 'too_long'
  if(value.split(/\s+/).length>MAX_WORDS)return 'too_many_words'
  if(PROSE_WORDS.test(value))return 'reads_as_prose'
  return null
}

/* Phrased as an observation and a question, never as a refusal. The consultant is the one who knows
 * whether this is a real name, and the copy has to leave them holding that decision -- an error
 * tone here would train people to fight the field. */
const CONCERN_COPY:Record<NameConcern,string>={
  digits:'This contains numbers. Check it is the person’s name and not a reference or a job title.',
  email:'This looks like an email address rather than a name.',
  url:'This looks like a web address rather than a name.',
  too_long:'This is longer than a name usually is. Check nothing extra was pasted in.',
  too_many_words:'This has more words than a name usually does. Check nothing extra was pasted in.',
  reads_as_prose:'This reads like a sentence rather than a name. Check what was pasted.',
}

/** The hint to show under a name field, or null to show nothing. */
export const nameConcernHint=(raw:string|null|undefined):string|null=>{
  const concern=nameConcern(raw)
  return concern?CONCERN_COPY[concern]:null
}
