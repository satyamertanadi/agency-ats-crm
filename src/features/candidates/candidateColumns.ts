/* Which columns the candidate table can afford, given the room it actually has.
 *
 * The rebuild made every cell richer without giving the table more width, and nothing allocated that
 * width deliberately -- so the browser inferred it from content, a long job title won, and the
 * identity column wrapped to three lines while Status was clipped mid-word. This module is the
 * allocation that was missing.
 *
 * Two rules shape everything below:
 *
 * 1. Secondary columns are FIXED px; Candidate takes what is left. Percentages summing to 100% plus a
 *    fixed Action column overflow by exactly the Action width -- the very bug being fixed. Fixed
 *    secondaries also mean identity is the column that GROWS on a wide screen rather than the one
 *    that gets squeezed.
 * 2. Drop order is Owner, then Status, then the row menu. Current process and Next action are
 *    protected: they are the reason the rebuild happened, and a table without them is the record
 *    viewer we started from.
 *
 * Pure and DOM-free on purpose. The thresholds are the whole design, so they belong somewhere they
 * can be pinned one pixel either side without rendering anything.
 */

/* `menu` replaced `action`, which rendered a full "Add to job" secondary button in every single row.
 * Fifty identical buttons is fifty pieces of chrome competing with the fifty names they sit beside,
 * for an action taken on maybe one row in twenty -- and it cost 92px of the width the identity column
 * needed. Add to job is unchanged and still reachable three ways: bulk selection, this row menu, and
 * the candidate record. What went away is its permanent occupation of a column. */
export type CandidateColumnId='select'|'candidate'|'pipeline'|'followUp'|'owner'|'status'|'menu'
export type ColumnTier='six'|'five'|'four'|'three'

export interface CandidateColumn{
  id:CandidateColumnId
  label:string
  /** Omitted for `candidate`, which absorbs the remaining width. */
  width?:string
  /** The heading is for assistive technology only -- see HIDDEN_LABELS. */
  hideLabel?:boolean
}

/* The floor that keeps a name and its role sub-line legible. Used twice, deliberately: to derive the
 * thresholds below, AND as a real CSS min-width on the narrowest table (see .candidates-table-three
 * in features.css). Arithmetic alone would let table-layout:fixed compress Candidate to nothing to
 * satisfy width:100%, which is exactly the unreadable identity column this work removes. */
/* Raised 208 -> 248 with the width freed by dropping the Action column. 208px had to hold an avatar,
 * a full name and a "Senior Financial Controller at PT Sinar Mas" sub-line; the name wrapped to two
 * lines for anyone with more than about eighteen characters, which is most Indonesian full names.
 * 248 keeps the great majority of names on one line, which is the point of an identity column. */
export const MIN_CANDIDATE=248
export const SELECT_WIDTH=44

const FIXED={pipeline:200,followUp:210,owner:120,status:132,menu:48} as const

/* Exact-fit promotion is brittle against borders, fractional CSS pixels, browser zoom and scrollbar
 * geometry. Being 8px conservative costs one column; being 8px optimistic costs the horizontal
 * overflow this exists to prevent. */
export const PROMOTION_MARGIN=8

const sum=(...values:number[])=>values.reduce((total,value)=>total+value,0)

/** Effective width for each tier = its fixed columns + the Candidate floor + the safety margin. */
export const TIER_THRESHOLDS={
  six:sum(FIXED.pipeline,FIXED.followUp,FIXED.owner,FIXED.status,FIXED.menu,MIN_CANDIDATE,PROMOTION_MARGIN),   // 966
  five:sum(FIXED.pipeline,FIXED.followUp,FIXED.status,FIXED.menu,MIN_CANDIDATE,PROMOTION_MARGIN),              // 846
  four:sum(FIXED.pipeline,FIXED.followUp,FIXED.menu,MIN_CANDIDATE,PROMOTION_MARGIN),                           // 714
  three:sum(FIXED.pipeline,FIXED.followUp,MIN_CANDIDATE,PROMOTION_MARGIN),                                     // 666
} as const

/** Physical minimum of the three-column table, WITHOUT the promotion margin: 208+210+220. Below this
 *  the table stops shrinking and .table-scroll scrolls internally. Distinct from TIER_THRESHOLDS.three
 *  (which decides when Three becomes active) and the two must not be conflated. */
export const THREE_COLUMN_MIN_WIDTH=sum(MIN_CANDIDATE,FIXED.pipeline,FIXED.followUp) // 658

const TIER_COLUMNS:Record<ColumnTier,readonly CandidateColumnId[]>={
  six:['candidate','pipeline','followUp','owner','status','menu'],
  five:['candidate','pipeline','followUp','status','menu'],
  four:['candidate','pipeline','followUp','menu'],
  /* The floor. Below this the row menu goes too -- at that width the row is something you open, not
   * something you act on in place, and the record itself carries every action. */
  three:['candidate','pipeline','followUp'],
}

/* Column headings name the QUESTION the column answers, not the table it was joined from.
 * "Pipeline" and "Follow-up" were both database vocabulary: the first cell actually reads
 * "Head of Finance / Interview - 12d", which is where the candidate is in a process, and the second
 * reads "Call re: notice period / 3 days late", which is what is owed next. */
const LABELS:Record<CandidateColumnId,string>={
  select:'Select',candidate:'Candidate',pipeline:'Current process',followUp:'Next action',
  owner:'Owner',status:'Status',menu:'Row actions',
}

const WIDTHS:Partial<Record<CandidateColumnId,string>>={
  select:`${SELECT_WIDTH}px`,pipeline:`${FIXED.pipeline}px`,followUp:`${FIXED.followUp}px`,
  owner:`${FIXED.owner}px`,status:`${FIXED.status}px`,menu:`${FIXED.menu}px`,
}

/* Headings that exist for a screen reader and would be noise on screen. "Select" labels a column of
 * checkboxes and "Row actions" a column of overflow buttons -- both self-evident by sight, and
 * neither can be dropped, because a <th> with no accessible name leaves the column unannounced. */
const HIDDEN_LABELS:ReadonlySet<CandidateColumnId>=new Set<CandidateColumnId>(['select','menu'])

/* Selection mode really does take 44px of information width, so it must be able to DEMOTE a tier
 * rather than merely add a column. Subtracting before consulting the ladder is what makes that
 * automatic -- one input, one ladder, no second code path to keep in step.
 *
 * A null width means "not measured yet, or no ResizeObserver". That resolves to THREE, the
 * conservative floor: assuming a wider tier would render an overflowing table for one frame, which is
 * a flash of precisely the bug being fixed. */
export function resolveColumnTier(width:number|null,selectionActive:boolean):ColumnTier{
  if(width===null)return 'three'
  const effective=width-(selectionActive?SELECT_WIDTH:0)
  if(effective>=TIER_THRESHOLDS.six)return 'six'
  if(effective>=TIER_THRESHOLDS.five)return 'five'
  if(effective>=TIER_THRESHOLDS.four)return 'four'
  return 'three'
}

/** The ordered columns for a tier. `select` is prepended rather than living in TIER_COLUMNS, because
 *  it is not something the ladder can drop -- it appears exactly when selection mode is on. */
export function visibleCandidateColumns(tier:ColumnTier,selectionActive:boolean):CandidateColumn[]{
  const ids=selectionActive?['select' as const,...TIER_COLUMNS[tier]]:[...TIER_COLUMNS[tier]]
  return ids.map((id)=>({id,label:LABELS[id],width:WIDTHS[id],hideLabel:HIDDEN_LABELS.has(id)||undefined}))
}
