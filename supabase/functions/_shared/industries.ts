// Deno cannot import from src/, so this mirrors the vocabulary in src/shared/lib/industries.ts. The
// key list and the alias table below must stay in step with that file; src/shared/lib/industries.test.ts
// reads this file from disk and asserts exactly that, because two copies drifting silently is the whole
// risk -- and the failure mode here is a five-thousand-row import landing half-keyed.
//
// Only the keys and the aliases are mirrored. Labels are a presentation concern and never reach the
// importer: `industryKey` resolves a CSV cell to a canonical key using the same normalise-then-look-up
// rule as the app, and returns anything it does not recognise untouched so an unfamiliar sector
// survives the import as typed rather than being dropped or guessed at.
export const INDUSTRY_KEYS:readonly string[]=[
  'hospitality','food_beverage','tourism_travel','real_estate','construction','mining','oil_gas',
  'energy_utilities','agriculture','maritime','logistics','manufacturing','automotive','retail',
  'consumer_goods','e_commerce','technology','fintech','financial_services','insurance',
  'telecommunications','healthcare','education','professional_services','media_creative',
  'ngo_nonprofit','government',
]

export const INDUSTRY_ALIASES:Readonly<Record<string,string>>={
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

const KEYS=new Set(INDUSTRY_KEYS)
const normalize=(value:string)=>value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')

export function industryKey(value:string|null|undefined):string{
  const raw=(value??'').trim()
  if(!raw)return ''
  const normalized=normalize(raw)
  if(KEYS.has(normalized))return normalized
  return INDUSTRY_ALIASES[normalized]??raw
}
