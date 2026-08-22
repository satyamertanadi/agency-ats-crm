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
 * 2. Drop order is Owner, then Status, then Action. Pipeline and Follow-up are protected: they are
 *    the reason the rebuild happened, and a table without them is the record viewer we started from.
 *
 * Pure and DOM-free on purpose. The thresholds are the whole design, so they belong somewhere they
 * can be pinned one pixel either side without rendering anything.
 */

export type CandidateColumnId='select'|'candidate'|'pipeline'|'followUp'|'owner'|'status'|'action'
export type ColumnTier='six'|'five'|'four'|'three'

export interface CandidateColumn{
  id:CandidateColumnId
  label:string
  /** Omitted for `candidate`, which absorbs the remaining width. */
  width?:string
}

/* The floor that keeps a name and its role sub-line legible. Used twice, deliberately: to derive the
 * thresholds below, AND as a real CSS min-width on the narrowest table (see .candidates-table-three
 * in features.css). Arithmetic alone would let table-layout:fixed compress Candidate to nothing to
 * satisfy width:100%, which is exactly the unreadable identity column this work removes. */
export const MIN_CANDIDATE=208
export const SELECT_WIDTH=44

const FIXED={pipeline:210,followUp:220,owner:110,status:120,action:92} as const

/* Exact-fit promotion is brittle against borders, fractional CSS pixels, browser zoom and scrollbar
 * geometry. Being 8px conservative costs one column; being 8px optimistic costs the horizontal
 * overflow this exists to prevent. */
export const PROMOTION_MARGIN=8

const sum=(...values:number[])=>values.reduce((total,value)=>total+value,0)

/** Effective width for each tier = its fixed columns + the Candidate floor + the safety margin. */
export const TIER_THRESHOLDS={
  six:sum(FIXED.pipeline,FIXED.followUp,FIXED.owner,FIXED.status,FIXED.action,MIN_CANDIDATE,PROMOTION_MARGIN),   // 968
  five:sum(FIXED.pipeline,FIXED.followUp,FIXED.status,FIXED.action,MIN_CANDIDATE,PROMOTION_MARGIN),              // 858
  four:sum(FIXED.pipeline,FIXED.followUp,FIXED.action,MIN_CANDIDATE,PROMOTION_MARGIN),                           // 738
  three:sum(FIXED.pipeline,FIXED.followUp,MIN_CANDIDATE,PROMOTION_MARGIN),                                       // 646
} as const

/** Physical minimum of the three-column table, WITHOUT the promotion margin: 208+210+220. Below this
 *  the table stops shrinking and .table-scroll scrolls internally. Distinct from TIER_THRESHOLDS.three
 *  (which decides when Three becomes active) and the two must not be conflated. */
export const THREE_COLUMN_MIN_WIDTH=sum(MIN_CANDIDATE,FIXED.pipeline,FIXED.followUp) // 638

const TIER_COLUMNS:Record<ColumnTier,readonly CandidateColumnId[]>={
  six:['candidate','pipeline','followUp','owner','status','action'],
  five:['candidate','pipeline','followUp','status','action'],
  four:['candidate','pipeline','followUp','action'],
  three:['candidate','pipeline','followUp'],
}

const LABELS:Record<CandidateColumnId,string>={
  select:'Select',candidate:'Candidate',pipeline:'Pipeline',followUp:'Follow-up',
  owner:'Owner',status:'Status',action:'Action',
}

const WIDTHS:Partial<Record<CandidateColumnId,string>>={
  select:`${SELECT_WIDTH}px`,pipeline:`${FIXED.pipeline}px`,followUp:`${FIXED.followUp}px`,
  owner:`${FIXED.owner}px`,status:`${FIXED.status}px`,action:`${FIXED.action}px`,
}

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
  return ids.map((id)=>({id,label:LABELS[id],width:WIDTHS[id]}))
}
