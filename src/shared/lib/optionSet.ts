/* The machinery behind every curated dropdown, factored out once so the twelve categorical columns
 * being retrofitted cannot each invent their own resolution rule.
 *
 * A set gives you three things, and all three exist because the columns are being retrofitted onto
 * live free text rather than designed clean:
 *   key(value)     -- best-effort raw text -> canonical value, so a legacy "F&B" or "Final hiring
 *                     decision" groups with what a consultant picks today instead of sitting in its
 *                     own bucket forever.
 *   options(cur)   -- the list to render, with an unrecognised current value PREPENDED so editing a
 *                     record can never silently discard what a colleague or an import already wrote.
 *                     currencyOptions() has done this for the workspace base currency since the
 *                     salary-currency fix; it is the guarantee that makes a dropdown safe to impose.
 *   label(value)   -- display, de-keying values the list does not know rather than showing raw snake.
 *
 * Resolution indexes the normalised form of BOTH the value and the label, so a set does not have to
 * choose keys that happen to normalise from their own labels: "201-500" and "1,000+" can coexist.
 * Aliases cover only what neither form catches -- abbreviations ("F&B") and synonyms ("Property").
 *
 * Unrecognised input is returned UNTOUCHED, never key-shaped. These columns have no CHECK constraint
 * precisely so "Other" can hold arbitrary text; minting a key-looking value for something a human
 * typed freehand would make junk indistinguishable from vocabulary. */
export interface LabeledOption{value:string;label:string}

export interface OptionSet{
  all:readonly LabeledOption[]
  key(value?:string|null):string
  options(current?:string|null):LabeledOption[]
  label(value?:string|null):string
}

/* Case and punctuation folded away, runs collapsed to one underscore. Also doubles as LIKE escaping
 * wherever a normalised value reaches SQL: `%` and `_` are non-alphanumeric, so a normalised string
 * can never carry a wildcard. industries.ts shares this rule -- and search_workspace reimplements it
 * in SQL -- so changing it here is a three-place change. */
export const normalizeOptionValue=(value:string)=>value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')

export function optionSet(all:readonly LabeledOption[],aliases:Readonly<Record<string,string>>={}):OptionSet{
  const known=new Set(all.map((option)=>option.value))
  const index=new Map<string,string>()
  for(const option of all){index.set(normalizeOptionValue(option.value),option.value);index.set(normalizeOptionValue(option.label),option.value)}
  // Aliases last so a deliberate mapping wins over an accidental label collision between two sets.
  for(const [alias,target] of Object.entries(aliases))index.set(normalizeOptionValue(alias),target)

  const key=(value?:string|null)=>{const raw=(value??'').trim();if(!raw)return '';return index.get(normalizeOptionValue(raw))??raw}
  const label=(value?:string|null)=>{
    const raw=(value??'').trim()
    if(!raw)return ''
    const match=all.find((option)=>option.value===key(raw))
    if(match)return match.label
    // Free text a human wrote comes back as they wrote it; only key-shaped leftovers get de-keyed,
    // exactly as status.ts lookup() does for a status the union has not caught up with.
    if(!/^[a-z0-9_]+$/.test(raw))return raw
    const spaced=raw.replaceAll('_',' ')
    return spaced.charAt(0).toUpperCase()+spaced.slice(1)
  }
  const options=(current?:string|null)=>{
    const value=key(current)
    if(!value||known.has(value))return [...all]
    return [{value,label:label(value)},...all]
  }
  return {all,key,options,label}
}
