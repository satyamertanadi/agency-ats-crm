import {describe,expect,it} from 'vitest'
import {
  MIN_CANDIDATE,SELECT_WIDTH,THREE_COLUMN_MIN_WIDTH,TIER_THRESHOLDS,
  resolveColumnTier,visibleCandidateColumns,type ColumnTier,
} from './candidateColumns'

const ids=(tier:ColumnTier,selection=false)=>visibleCandidateColumns(tier,selection).map((column)=>column.id)

describe('the column ladder',()=>{
  /* One pixel either side of every boundary. The density work shipped a 720px off-by-one that only
   * surfaced by testing the boundary itself rather than a width comfortably on each side, so these
   * are written as exact-value pairs on purpose. */
  it.each([
    ['six',TIER_THRESHOLDS.six,'five'],
    ['five',TIER_THRESHOLDS.five,'four'],
    ['four',TIER_THRESHOLDS.four,'three'],
  ] as const)('promotes to %s exactly at its threshold',(tier,threshold,below)=>{
    expect(resolveColumnTier(threshold,false)).toBe(tier)
    expect(resolveColumnTier(threshold-1,false)).toBe(below)
  })

  it('bottoms out at three and never below',()=>{
    expect(resolveColumnTier(TIER_THRESHOLDS.three,false)).toBe('three')
    expect(resolveColumnTier(TIER_THRESHOLDS.three-1,false)).toBe('three')
    expect(resolveColumnTier(200,false)).toBe('three')
    expect(resolveColumnTier(0,false)).toBe('three')
  })

  /* Selection must DEMOTE, not just prepend. A checkbox column that added 44px of content without
   * removing 44px of budget would push the table back into overflow -- the whole bug. */
  it.each([
    ['six',TIER_THRESHOLDS.six],
    ['five',TIER_THRESHOLDS.five],
    ['four',TIER_THRESHOLDS.four],
  ] as const)('shifts the %s threshold by the checkbox width when selecting',(tier,threshold)=>{
    // The exact width that qualified without selection no longer qualifies with it...
    expect(resolveColumnTier(threshold,false)).toBe(tier)
    expect(resolveColumnTier(threshold,true)).not.toBe(tier)
    // ...and 44px more restores it.
    expect(resolveColumnTier(threshold+SELECT_WIDTH,true)).toBe(tier)
  })

  /* Not measured yet, or no ResizeObserver at all. Assuming a wider tier would paint one frame of
   * overflowing table, which is a flash of exactly what this change removes. */
  it('falls back to the narrowest set when width is unknown',()=>{
    expect(resolveColumnTier(null,false)).toBe('three')
    expect(resolveColumnTier(null,true)).toBe('three')
  })
})

describe('visible columns',()=>{
  it('drops Owner first, then Status, then the row menu',()=>{
    expect(ids('six')).toEqual(['candidate','pipeline','followUp','owner','status','menu'])
    expect(ids('five')).toEqual(['candidate','pipeline','followUp','status','menu'])
    expect(ids('four')).toEqual(['candidate','pipeline','followUp','menu'])
    expect(ids('three')).toEqual(['candidate','pipeline','followUp'])
  })

  // The two columns the rebuild exists for. A tier that dropped either would be the record viewer again.
  it.each(['six','five','four','three'] as const)('protects Current process and Next action at %s',(tier)=>{
    expect(ids(tier)).toEqual(expect.arrayContaining(['candidate','pipeline','followUp']))
  })

  /* The two columns whose heading is for assistive technology only. An empty-string label would have
   * been the easy way to hide them and would leave the <th> with no accessible name, which is what
   * unlinks every cell beneath it from its header. */
  it('keeps an accessible heading on the columns whose label is hidden',()=>{
    const columns=visibleCandidateColumns('six',true)
    const hidden=columns.filter((column)=>column.hideLabel)
    expect(hidden.map((column)=>column.id)).toEqual(['select','menu'])
    for(const column of hidden)expect(column.label.length).toBeGreaterThan(0)
  })

  it('prepends the checkbox only while selecting',()=>{
    expect(ids('three',true)[0]).toBe('select')
    expect(ids('three',false)).not.toContain('select')
  })

  /* Candidate is the one column with no width: it absorbs the remainder, so identity grows on a wide
   * screen instead of being squeezed. Giving it a width would recreate the overflow. */
  /* Identity has the largest floor of any column, which is the whole point of the reallocation --
   * before it, Candidate had the SMALLEST fixed budget of the five and was the column that wrapped. */
  it('gives Candidate the largest minimum of any column',()=>{
    const fixed=visibleCandidateColumns('six',true)
      .filter((column)=>column.width)
      .map((column)=>Number.parseInt(column.width!,10))
    expect(Math.max(...fixed)).toBeLessThan(MIN_CANDIDATE)
  })

  it('leaves Candidate flexible and fixes every other column',()=>{
    for(const column of visibleCandidateColumns('six',true)){
      if(column.id==='candidate')expect(column.width).toBeUndefined()
      else expect(column.width).toMatch(/^\d+px$/)
    }
  })
})

describe('the physical floor',()=>{
  /* Two numbers doing two different jobs. Conflating them is how Candidate ends up compressed below
   * the point where a name is readable, which is the failure this whole change is about. */
  it('separates "when three activates" from "how narrow three may be drawn"',()=>{
    expect(THREE_COLUMN_MIN_WIDTH).toBe(658)
    expect(TIER_THRESHOLDS.three).toBe(666)
    expect(TIER_THRESHOLDS.three).toBeGreaterThan(THREE_COLUMN_MIN_WIDTH)
  })

  it('reserves the full Candidate floor inside that minimum',()=>{
    // 658 = 248 Candidate + 200 Current process + 210 Next action, so Candidate keeps its floor
    // rather than being the column that absorbs the shortfall.
    expect(THREE_COLUMN_MIN_WIDTH-200-210).toBe(MIN_CANDIDATE)
  })
})
