import {describe,expect,it} from 'vitest'
import {buildSetupSteps} from './SetupChecklist'

const empty={companies:0,contacts:0,activeJobs:0,candidates:0,pipelineEntries:0,members:1}
const base='/app/northstar'

describe('buildSetupSteps',()=>{
  it('opens only the first step for a brand-new workspace',()=>{
    const steps=buildSetupSteps(empty,base)
    expect(steps.every((step)=>!step.done)).toBe(true)
    expect(steps.filter((step)=>!step.blocked)).toHaveLength(1)
    expect(steps[0]).toMatchObject({key:'company',blocked:false,href:'/app/northstar/companies'})
  })

  it('unblocks the next step as each dependency is met',()=>{
    const steps=buildSetupSteps({...empty,companies:1},base)
    expect(steps[0]).toMatchObject({key:'company',done:true,blocked:false})
    expect(steps[1]).toMatchObject({key:'contact',done:false,blocked:false})
    expect(steps[2]).toMatchObject({key:'job',done:false,blocked:true})
  })

  // The owner is a member, so a solo workspace has not invited anyone yet.
  it('treats the team step as outstanding until a second member exists',()=>{
    expect(buildSetupSteps({...empty,members:1},base).find((step)=>step.key==='team')?.done).toBe(false)
    expect(buildSetupSteps({...empty,members:2},base).find((step)=>step.key==='team')?.done).toBe(true)
  })

  it('reports completion only when every step is done',()=>{
    const full={companies:1,contacts:1,activeJobs:1,candidates:1,pipelineEntries:1,members:2}
    expect(buildSetupSteps(full,base).every((step)=>step.done)).toBe(true)
    expect(buildSetupSteps({...full,pipelineEntries:0},base).every((step)=>step.done)).toBe(false)
  })

  // Steps derive from counts, so work done out of order (e.g. via import) is never
  // hidden behind a step the workspace has already moved past.
  it('does not block a completed step behind an outstanding earlier one',()=>{
    const steps=buildSetupSteps({...empty,candidates:5},base)
    expect(steps.find((step)=>step.key==='candidate')).toMatchObject({done:true,blocked:false})
    expect(steps.find((step)=>step.key==='company')).toMatchObject({done:false,blocked:false})
    expect(steps.find((step)=>step.key==='contact')).toMatchObject({done:false,blocked:true})
  })
})
