import {describe,expect,it} from 'vitest'
import {candidateFilterChips,candidateFilterKeys} from './candidateFilterChips'

const chips=(query:string,ownerNames:Record<string,string>={})=>
  candidateFilterChips(new URLSearchParams(query),{ownerNames})

describe('candidateFilterChips',()=>{
  it('says nothing when nothing is filtered',()=>{
    expect(chips('')).toEqual([])
    expect(chips('page=3&sort=name&dir=asc')).toEqual([])
  })

  /* A chip showing `do_not_contact` would be worse than no chip -- it is the raw column value, not
   * something the consultant chose from a dropdown. These resolve through the same maps the filter
   * controls and the table badges render from. */
  it('reads back enum filters as their real labels',()=>{
    expect(chips('status=do_not_contact')).toEqual([{key:'status',label:'Status',value:'Do not contact'}])
    expect(chips('source=job_board')).toEqual([{key:'source',label:'Source',value:'Job board'}])
    expect(chips('availability=within_2_weeks')).toEqual([{key:'availability',label:'Availability',value:'Within 2 weeks'}])
  })

  // A uuid on screen is not a filter anyone can read.
  it('names the owner rather than showing an id',()=>{
    expect(chips('owner=member-1',{'member-1':'Satya Mertanadi'}))
      .toEqual([{key:'owner',label:'Owner',value:'Satya Mertanadi'}])
  })

  it('falls back readably when the owner is not in the team list yet',()=>{
    expect(chips('owner=member-9')).toEqual([{key:'owner',label:'Owner',value:'Selected member'}])
  })

  it('degrades a hand-edited unknown value instead of printing an enum',()=>{
    expect(chips('status=nonsense')[0]!.value).toBe('nonsense')
  })

  it('lists free-text filters and keeps their order stable',()=>{
    expect(chips('q=maya&location=Bali&tag=vip&skill=React').map((chip)=>chip.key))
      .toEqual(['q','location','tag','skill'])
  })

  it('ignores blank and whitespace-only params',()=>{
    expect(chips('q=&location=%20%20')).toEqual([])
  })

  /* Ordering is not a filter: it changes what you see first, not what you can see. Listing it would
   * make "no filters applied" almost never true, which is how a signal stops being a signal. */
  it('does not treat sort or paging as filters',()=>{
    expect(chips('sort=name&dir=asc&page=2&q=ana').map((chip)=>chip.key)).toEqual(['q'])
  })

  // Clear-all must cover exactly what the chips can produce, or a chip survives its own removal.
  it('declares every key it can emit',()=>{
    const emitted=chips('q=a&status=active&location=b&source=referral&owner=m1&tag=t&skill=s&availability=immediately&queue=needs_enrichment&issue=missing_cv')
      .map((chip)=>chip.key)
    expect([...emitted].sort()).toEqual([...candidateFilterKeys].sort())
  })

  /* The data-quality issue reads as its label, not its code. It is also the one chip resolved through
   * a parser: the SQL matches nothing for an unrecognised code, so a chip claiming a filter that is
   * not applying would be worse than no chip at all. */
  it('names the data-quality issue in words, and ignores one it does not serve',()=>{
    expect(chips('queue=needs_enrichment&issue=missing_contact_method'))
      .toEqual([{key:'issue',label:'Issue',value:'No way to reach them'}])
    expect(chips('queue=needs_enrichment&issue=missing_visa')).toEqual([])
  })

  /* The issue only applies inside the queue it belongs to, and the chip has to agree: an `?issue=`
   * that arrives without `?queue=needs_enrichment` is never sent to the server, so a chip for it
   * would claim a filter that is not applying. */
  it('does not chip an issue outside the enrichment queue',()=>{
    expect(chips('issue=missing_cv')).toEqual([])
    expect(chips('queue=stale&issue=missing_cv').map((chip)=>chip.key)).toEqual([])
  })
})
