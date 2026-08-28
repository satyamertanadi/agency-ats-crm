import {describe,expect,it} from 'vitest'
import {coachingStatusLabel,feedbackLabel,splitTodayItems,todayItemLabel,todayItemTone} from './reviewPresentation'
import type {TodayInterviewItem} from './reviewRepository'

const item=(overrides:Partial<TodayInterviewItem>={}):TodayInterviewItem=>({
  kind:'coaching_open',interviewId:'i1',jobCandidateId:'jc1',referenceId:'r1',
  headline:'New coaching action to acknowledge',occurredAt:'2026-09-01T00:00:00Z',audience:'consultant',
  ...overrides,
})

describe('feedback wording',()=>{
  it('says disagreed, not overruled or corrected',()=>{
    /* Both the finding and the disagreement are kept, so a label implying the finding was withdrawn
     * would claim an outcome the data does not have. */
    expect(feedbackLabel('disagreed')).toBe('Disagreed')
    expect(feedbackLabel('disagreed').toLowerCase()).not.toContain('overrul')
    expect(feedbackLabel('disagreed').toLowerCase()).not.toContain('correct')
  })

  it('names the consultant’s own entry as context rather than a defence',()=>{
    expect(feedbackLabel('consultant_context')).toBe('Consultant context')
  })
})

describe('coaching status wording',()=>{
  it('distinguishes seeing it from doing it',()=>{
    // The whole reason acknowledged exists as a separate state.
    expect(coachingStatusLabel('open')).toBe('To acknowledge')
    expect(coachingStatusLabel('acknowledged')).toBe('In progress')
    expect(coachingStatusLabel('completed')).toBe('Complete')
  })
})

describe('Today grouping',()=>{
  it('separates the viewer’s own work from what they review',()=>{
    const {mine,toReview}=splitTodayItems([
      item({kind:'coaching_open',audience:'consultant'}),
      item({kind:'attention_finding',audience:'reviewer',referenceId:'f1'}),
      item({kind:'mapping_required',audience:'consultant',referenceId:'t1'}),
    ])
    expect(mine).toHaveLength(2)
    expect(toReview).toHaveLength(1)
  })

  it('groups only what the database returned, deciding nothing about visibility',()=>{
    /* The audience is set server-side from the caller's permissions. If this ever started filtering
     * on anything else, it would be a client-side authorization boundary. */
    const {mine,toReview}=splitTodayItems([item({audience:'reviewer'})])
    expect(mine).toHaveLength(0)
    expect(toReview).toHaveLength(1)
  })

  it('tones a failure louder than a routine item',()=>{
    expect(todayItemTone('analysis_failed')).toBe('bad')
    expect(todayItemTone('coaching_open')).toBe('info')
    expect(todayItemTone('consent_missing')).toBe('warn')
  })

  it('labels every kind',()=>{
    for(const kind of ['consent_missing','mapping_required','analysis_failed','coaching_open','attention_finding'] as const){
      expect(todayItemLabel(kind)).not.toBe(kind)
    }
  })
})
