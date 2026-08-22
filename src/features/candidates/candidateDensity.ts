export type CandidateDensity='compact'|'comfortable'

const STORAGE_KEY='candidate-density'

/* How tight the candidate table is drawn, remembered per browser.
 *
 * localStorage rather than a column, following the rule TodayPage states for its setup checklist:
 * this records a preference about how one screen is drawn, not a fact about the organisation, so it
 * does not warrant a migration or an RLS policy. It is also per-device on purpose -- the same
 * consultant wants tighter rows on a 27" monitor than on a laptop.
 *
 * Wrapped in try/catch like all four existing keys: private-mode Safari throws on localStorage rather
 * than returning null, and a remembered row height is not worth taking the page down for.
 *
 * Compact is the DEFAULT. The screen's stated problem is that it is too spacious for people who live
 * in it all day, and a preference nobody discovers is not a fix -- whatever ships as the default is
 * what almost everyone will use. Comfortable stays one click away for anyone who wants the air back. */
export function readDensity():CandidateDensity{
  try{return localStorage.getItem(STORAGE_KEY)==='comfortable'?'comfortable':'compact'}catch{return 'compact'}
}

export function writeDensity(density:CandidateDensity){
  try{localStorage.setItem(STORAGE_KEY,density)}catch{/* see readDensity */}
}

export const DENSITY_OPTIONS=[
  {id:'compact' as const,label:'Compact'},
  {id:'comfortable' as const,label:'Comfortable'},
]
