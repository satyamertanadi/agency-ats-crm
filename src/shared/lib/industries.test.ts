import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe,expect,it} from 'vitest'
import {INDUSTRIES,industryKey,industryLabel,industryOptions} from './industries'

/* The whole design rests on one invariant -- every key is `normalize(label)` -- so that is the first
 * thing asserted here. Break it and label->key resolution silently stops working in three places at
 * once: the CSV importer, the clients filter, and the search RPC's normalized match. */

describe('industry vocabulary',()=>{
  it('derives every key from its own label',()=>{
    for(const industry of INDUSTRIES)expect(industryKey(industry.label),`${industry.label} must normalize to ${industry.key}`).toBe(industry.key)
  })

  it('has unique keys',()=>{
    expect(new Set(INDUSTRIES.map((industry)=>industry.key)).size).toBe(INDUSTRIES.length)
  })
})

describe('industryKey',()=>{
  it('folds case and punctuation onto the canonical key',()=>{
    expect(industryKey('Food & Beverage')).toBe('food_beverage')
    expect(industryKey('FOOD&BEVERAGE')).toBe('food_beverage')
    expect(industryKey('food/beverage')).toBe('food_beverage')
    expect(industryKey('  Real Estate  ')).toBe('real_estate')
    expect(industryKey('E-Commerce')).toBe('e_commerce')
  })

  it('resolves the abbreviations and synonyms a legacy export carries',()=>{
    expect(industryKey('F&B')).toBe('food_beverage')
    expect(industryKey('FMCG')).toBe('consumer_goods')
    expect(industryKey('Hotels & Resorts')).toBe('hospitality')
    expect(industryKey('Property')).toBe('real_estate')
    expect(industryKey('Oil and Gas')).toBe('oil_gas')
    expect(industryKey('IT')).toBe('technology')
  })

  it('returns an unrecognised sector verbatim rather than minting a key for it',()=>{
    // Key-shaping junk would make it look canonical, and "Other" is arbitrary text by design.
    expect(industryKey('Boutique surf retreats')).toBe('Boutique surf retreats')
    expect(industryKey('')).toBe('')
    expect(industryKey(null)).toBe('')
    expect(industryKey(undefined)).toBe('')
  })
})

describe('industryOptions',()=>{
  it('offers the curated list for a known, aliased, or empty value',()=>{
    expect(industryOptions()).toHaveLength(INDUSTRIES.length)
    expect(industryOptions('hospitality')).toHaveLength(INDUSTRIES.length)
    expect(industryOptions('Hotels & Resorts')).toHaveLength(INDUSTRIES.length)
  })

  it('prepends exactly one entry for a value the list has never heard of',()=>{
    // This is the guarantee that makes the dropdown safe to retrofit: editing a client cannot
    // silently discard what a colleague or an import already recorded.
    const options=industryOptions('Boutique surf retreats')
    expect(options).toHaveLength(INDUSTRIES.length+1)
    expect(options[0]).toEqual({value:'Boutique surf retreats',label:'Boutique surf retreats'})
  })

  it('emits values the control can match against a stored key',()=>{
    expect(industryOptions().map((option)=>option.value)).toContain(industryKey('Food & Beverage'))
  })
})

describe('industryLabel',()=>{
  it('renders a stored key as its curated label',()=>{
    expect(industryLabel('food_beverage')).toBe('Food & beverage')
    expect(industryLabel('ngo_nonprofit')).toBe('NGO & nonprofit')
  })

  it('renders a legacy value through the same alias table the filter uses',()=>{
    expect(industryLabel('F&B')).toBe('Food & beverage')
    expect(industryLabel('Renewable energy')).toBe('Energy & utilities')
  })

  it('de-keys a key-shaped value this build does not know',()=>{
    expect(industryLabel('quantum_widgets')).toBe('Quantum widgets')
  })

  it('leaves free text exactly as a human typed it',()=>{
    expect(industryLabel('Boutique Villas')).toBe('Boutique Villas')
  })

  it('returns empty for nothing, so call sites keep their own wording',()=>{
    // ClientsPage renders `industryLabel(x)||'Industry not recorded'`; a non-empty fallback here
    // would win over that and put two different phrasings in the product.
    expect(industryLabel(null)).toBe('')
    expect(industryLabel('   ')).toBe('')
  })
})

describe('edge-function mirror',()=>{
  /* Deno cannot import from src/, so supabase/functions/_shared/industries.ts carries a copy and this
   * reads it off disk -- the same technique providerOutage.test.ts uses. Two copies drifting silently
   * is the whole risk, and the failure mode is a bulk import landing half-keyed. */
  const source=readFileSync(resolve(__dirname,'../../../supabase/functions/_shared/industries.ts'),'utf8')

  it('mirrors the key list', ()=>{
    const block=source.match(/export const INDUSTRY_KEYS:readonly string\[\]=\[([\s\S]*?)\]/)?.[1]
    expect(block,'edge copy must declare INDUSTRY_KEYS as an array literal').toBeDefined()
    const keys=[...block!.matchAll(/'([a-z0-9_]+)'/g)].map((match)=>match[1])
    expect(keys).toEqual(INDUSTRIES.map((industry)=>industry.key))
  })

  it('mirrors the alias table',()=>{
    const block=source.match(/export const INDUSTRY_ALIASES:Readonly<Record<string,string>>=\{([\s\S]*?)\n\}/)?.[1]
    expect(block,'edge copy must declare INDUSTRY_ALIASES as an object literal').toBeDefined()
    const aliases=[...block!.matchAll(/([a-z0-9_]+):'([a-z0-9_]+)'/g)].map((match)=>[match[1]!,match[2]!] as const)
    expect(aliases.length).toBeGreaterThan(0)
    // Every alias must land on a real key, and none may shadow one -- an alias named after a key would
    // be dead code that quietly disagrees with the list.
    const keys=new Set(INDUSTRIES.map((industry)=>industry.key))
    for(const [alias,target] of aliases){
      expect(keys.has(target),`alias ${alias} points at unknown key ${target}`).toBe(true)
      expect(keys.has(alias),`alias ${alias} shadows a real key`).toBe(false)
      // And the app must agree with the mirror on what each alias resolves to.
      expect(industryKey(alias),`app and edge copy disagree on ${alias}`).toBe(target)
    }
  })
})
