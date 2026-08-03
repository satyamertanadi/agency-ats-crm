/* The add-client drawer and the client edit form both asked for `industry` as free text, so the same
 * sector arrives as "F&B", "Food and Beverage", "food/bev" and "Restaurants" across four consultants
 * -- unfilterable, unreportable, and the first thing a bulk migration multiplies by a thousand.
 *
 * Deliberately the sectors an Indonesian agency desk actually bills against -- Bali/Lombok hospitality
 * and property, Jakarta corporate, and the resource and industrial economy behind both -- not GICS or
 * ISIC. A taxonomy nobody can hold in their head gets picked from the top of the list and the data is
 * worse than free text was. Anything genuinely missing goes in through the "Other…" row on
 * OptionSelect, stays selectable forever via `industryOptions(current)`, and tells us what to add next.
 *
 * companies.industry has NO check constraint, deliberately: "Other" must be storable. Same precedent
 * as jobs.priority and companies.business_development_stage. The control, not the database, is what
 * makes the common case one click.
 *
 * The invariant the rest of the design rests on: every key equals `normalize(label)`. That is what
 * lets label -> key resolution work with no lookup table, lets the CSV importer carry only the key
 * set, and lets search_workspace normalise both sides of its match without a copy of this vocabulary
 * in SQL. industries.test.ts asserts it for every row.
 *
 * The Deno edge runtime cannot import from src/, so supabase/functions/_shared/industries.ts carries a
 * copy of the keys and aliases. industries.test.ts asserts the two stay in step. */
import {normalizeOptionValue} from './optionSet'

export interface IndustryOption{key:string;label:string}
export interface SelectOption{value:string;label:string}

/* Ordered by how often this desk sees them, not alphabetically -- the same relevance-ordering choice
 * COMMON_CURRENCIES makes by putting IDR first. */
export const INDUSTRIES:readonly IndustryOption[]=[
  {key:'hospitality',label:'Hospitality'},
  {key:'food_beverage',label:'Food & beverage'},
  {key:'tourism_travel',label:'Tourism & travel'},
  {key:'real_estate',label:'Real estate'},
  {key:'construction',label:'Construction'},
  {key:'mining',label:'Mining'},
  {key:'oil_gas',label:'Oil & gas'},
  {key:'energy_utilities',label:'Energy & utilities'},
  {key:'agriculture',label:'Agriculture'},
  {key:'maritime',label:'Maritime'},
  {key:'logistics',label:'Logistics'},
  {key:'manufacturing',label:'Manufacturing'},
  {key:'automotive',label:'Automotive'},
  {key:'retail',label:'Retail'},
  {key:'consumer_goods',label:'Consumer goods'},
  {key:'e_commerce',label:'E-commerce'},
  {key:'technology',label:'Technology'},
  {key:'fintech',label:'Fintech'},
  {key:'financial_services',label:'Financial services'},
  {key:'insurance',label:'Insurance'},
  {key:'telecommunications',label:'Telecommunications'},
  {key:'healthcare',label:'Healthcare'},
  {key:'education',label:'Education'},
  {key:'professional_services',label:'Professional services'},
  {key:'media_creative',label:'Media & creative'},
  {key:'ngo_nonprofit',label:'NGO & nonprofit'},
  {key:'government',label:'Government'},
]

/* No exported union of the keys, deliberately. INDUSTRIES is typed `readonly IndustryOption[]`, so a
 * derived type would collapse to `string` and read as a guarantee it does not make -- and the column
 * genuinely is open, because "Other" writes arbitrary text. Same reasoning as domain.ts keeping
 * Company.industry as `string | null`. */
const KEYS=new Set(INDUSTRIES.map((industry)=>industry.key))

/* Only spellings that do NOT already collapse onto their key under `normalize`: abbreviations ("F&B"
 * -> f_b) and synonyms ("Property"). Anything that does collapse -- "Food & Beverage", "REAL ESTATE",
 * "e-commerce" -- is handled by normalize alone and must not be listed, which industries.test.ts
 * enforces by asserting no alias key is also an INDUSTRIES key.
 *
 * This table is informed guesswork about what legacy exports contain. Before a real bulk migration,
 * run `select industry,count(*) from public.companies group by 1 order by 2 desc` against the source
 * and rewrite it from the actual strings: a surplus alias costs nothing, a missing one misfiles an
 * account. Values a human typed and we do not recognise are left alone rather than guessed at. */
const ALIASES:Readonly<Record<string,string>>={
  f_b:'food_beverage',food_and_beverage:'food_beverage',restaurants:'food_beverage',restaurant:'food_beverage',catering:'food_beverage',
  hotel:'hospitality',hotels:'hospitality',hotels_resorts:'hospitality',resorts:'hospitality',accommodation:'hospitality',spa:'hospitality',
  travel:'tourism_travel',tourism:'tourism_travel',tour_operator:'tourism_travel',leisure:'tourism_travel',
  property:'real_estate',property_development:'real_estate',property_management:'real_estate',realty:'real_estate',
  contractor:'construction',contracting:'construction',
  mining_metals:'mining',metals:'mining',coal:'mining',minerals:'mining',
  oil_and_gas:'oil_gas',petroleum:'oil_gas',
  energy:'energy_utilities',power:'energy_utilities',utilities:'energy_utilities',renewables:'energy_utilities',renewable_energy:'energy_utilities',
  plantation:'agriculture',plantations:'agriculture',palm_oil:'agriculture',agribusiness:'agriculture',fisheries:'agriculture',aquaculture:'agriculture',
  shipping:'maritime',marine:'maritime',
  transportation:'logistics',transport:'logistics',supply_chain:'logistics',freight:'logistics',warehousing:'logistics',
  industrial:'manufacturing',factory:'manufacturing',textile:'manufacturing',garment:'manufacturing',
  fmcg:'consumer_goods',cpg:'consumer_goods',
  ecommerce:'e_commerce',online_retail:'e_commerce',marketplace:'e_commerce',
  it:'technology',ict:'technology',information_technology:'technology',software:'technology',saas:'technology',tech:'technology',
  banking:'financial_services',banking_finance:'financial_services',banking_and_finance:'financial_services',finance:'financial_services',investment:'financial_services',
  insurtech:'insurance',
  telco:'telecommunications',telecom:'telecommunications',telecommunication:'telecommunications',
  health_care:'healthcare',hospitals:'healthcare',clinics:'healthcare',pharmaceuticals:'healthcare',pharma:'healthcare',medical:'healthcare',
  education_training:'education',training:'education',schools:'education',university:'education',edtech:'education',
  consulting:'professional_services',legal:'professional_services',law_firm:'professional_services',accounting:'professional_services',
  recruitment:'professional_services',staffing:'professional_services',architecture:'professional_services',engineering:'professional_services',
  media:'media_creative',creative:'media_creative',advertising:'media_creative',marketing:'media_creative',design:'media_creative',
  publishing:'media_creative',entertainment:'media_creative',
  ngo:'ngo_nonprofit',nonprofit:'ngo_nonprofit',non_profit:'ngo_nonprofit',charity:'ngo_nonprofit',foundation:'ngo_nonprofit',
  public_sector:'government',government_agency:'government',
}

/* Shared with every other curated dropdown via optionSet.ts, and reimplemented in SQL by the
 * search_workspace migration -- the rule is deliberately simple enough to hold in three places. This
 * module keeps its own hand-written accessors rather than calling optionSet(): it carries the extra
 * {key,label} shape the Deno mirror's parity test reads, and the invariant that every key equals
 * normalize(its own label), which the generic factory does not require of its callers. */
const normalize=normalizeOptionValue

/* Best-effort raw text -> canonical key. Returns the input UNTOUCHED when nothing recognises it:
 * "Other" is arbitrary text by design, and minting a key-shaped value for something a human typed
 * freehand would make junk look canonical. */
export function industryKey(value?:string|null):string{
  const raw=(value??'').trim()
  if(!raw)return ''
  const normalized=normalize(raw)
  if(KEYS.has(normalized))return normalized
  return ALIASES[normalized]??raw
}

/* The list to render, with an unrecognised current value prepended so editing a client never silently
 * discards what a colleague (or an import) already recorded -- the same guarantee currencyOptions()
 * gives the workspace base currency. Emits {value,label} because that is what OptionSelect consumes;
 * INDUSTRIES stays {key,label} as the vocabulary.
 *
 * Pair it with `industryKey(stored)` as the control's value, not the raw column: that way a legacy
 * "Food & Beverage" opens on the Food & beverage option rather than in the Other box, and the next
 * save quietly writes the key. */
export function industryOptions(current?:string|null):SelectOption[]{
  const listed=INDUSTRIES.map((industry)=>({value:industry.key,label:industry.label}))
  const value=industryKey(current)
  if(!value||KEYS.has(value))return listed
  return [{value,label:industryLabel(value)},...listed]
}

/* Display. A stored key renders as its curated label. Anything else is legacy or "Other" free text a
 * human already wrote and read, so it comes back as typed rather than title-cased into something they
 * did not write -- except key-shaped leftovers (a key this build does not know yet), which get
 * de-keyed exactly as status.ts lookup() does. Returns '' for empty so call sites keep their own
 * "Industry not recorded" wording. */
export function industryLabel(value?:string|null):string{
  const raw=(value??'').trim()
  if(!raw)return ''
  const known=INDUSTRIES.find((industry)=>industry.key===industryKey(raw))
  if(known)return known.label
  if(!/^[a-z0-9_]+$/.test(raw))return raw
  const spaced=raw.replaceAll('_',' ')
  return spaced.charAt(0).toUpperCase()+spaced.slice(1)
}
