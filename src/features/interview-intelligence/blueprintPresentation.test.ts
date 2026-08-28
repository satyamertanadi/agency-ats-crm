import {describe,expect,it} from 'vitest'
import {blueprintState,summarizeBlueprint} from './blueprintPresentation'
import type {BlueprintStatus} from './blueprintRepository'

const status=(overrides:Partial<BlueprintStatus>={}):BlueprintStatus=>({
  rubricId:null,version:null,activatedAt:null,sourceDocumentId:null,
  essentialQuestionCount:0,mustHaveCount:0,niceToHaveCount:0,
  isStale:false,draftRubricId:null,draftUpdatedAt:null,
  coreRubricId:null,coreRubricVersion:null,
  ...overrides,
})

describe('blueprint state',()=>{
  it('treats a workspace without the feature as unavailable',()=>{
    expect(blueprintState(null)).toBe('unavailable')
  })

  it('separates "never set up" from "stale"',()=>{
    // These are different situations and the panel says them differently: one is a setup step, the
    // other is a warning about something already in use.
    expect(blueprintState(status())).toBe('not_set_up')
    expect(blueprintState(status({rubricId:'r1',version:1,isStale:true}))).toBe('stale')
  })

  it('surfaces a waiting draft ahead of an empty state',()=>{
    expect(blueprintState(status({draftRubricId:'d1'}))).toBe('draft_waiting')
  })

  it('prefers the stale warning over the plain active state',()=>{
    expect(blueprintState(status({rubricId:'r1',version:2,isStale:false}))).toBe('active')
    expect(blueprintState(status({rubricId:'r1',version:2,isStale:true}))).toBe('stale')
  })
})

describe('blueprint summary',()=>{
  it('does not make an unconfigured job look like a problem',()=>{
    const summary=summarizeBlueprint(status())
    expect(summary.tone).toBe('neutral')
    expect(summary.headline).toBe('No blueprint yet')
  })

  it('says the stale blueprint is still in use',()=>{
    /* The wording matters more than it looks. A consultant who reads "outdated" and assumes the
     * system refreshed it will interview against questions they think were updated and were not. */
    const summary=summarizeBlueprint(status({rubricId:'r1',version:3,isStale:true,essentialQuestionCount:8,mustHaveCount:4}))
    expect(summary.tone).toBe('warn')
    expect(summary.headline).toContain('Version 3')
    expect(summary.detail).toContain('still in use')
  })

  it('counts questions in the active summary',()=>{
    const summary=summarizeBlueprint(status({rubricId:'r1',version:1,essentialQuestionCount:6,mustHaveCount:3}))
    expect(summary.tone).toBe('good')
    expect(summary.detail).toBe('6 questions · 3 must-have')
  })

  it('does not say "1 questions"',()=>{
    const summary=summarizeBlueprint(status({rubricId:'r1',version:1,essentialQuestionCount:1,mustHaveCount:1}))
    expect(summary.detail).toBe('1 question · 1 must-have')
  })
})
