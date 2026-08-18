import {describe,expect,it} from 'vitest'
import {enrichmentGaps,followUpSignal,pipelineSignal,shortAgo,statusFacets} from './candidateRowSignals'

/* Every instant here is built from LOCAL date components, never from a UTC string. These functions
 * count the viewer's calendar days, so a fixture written as '2026-08-17T20:00:00Z' lands on a
 * different local date depending on where the test runs -- which made this file pass in UTC and fail
 * at UTC+8. `at(dayOffset, hour)` is unambiguous in every timezone. */
const at=(dayOffset:number,hour:number)=>new Date(2026,7,18+dayOffset,hour,0,0).toISOString()
// Mid-afternoon deliberately: a task due at 09:00 today is already past by "now" but still due TODAY,
// which is the case a naive `due < now` check gets wrong and reports as overdue.
const now=new Date(2026,7,18,15,0,0)

describe('shortAgo',()=>{
  it('compresses to what fits on a sub-line',()=>{
    expect(shortAgo(at(0,9),now)).toBe('today')
    expect(shortAgo(at(-1,9),now)).toBe('yesterday')
    expect(shortAgo(at(-6,9),now)).toBe('6d ago')
  })

  it('does not report a future timestamp as an age',()=>{
    // Clock skew between browser and database should read as "today", never "-1d ago".
    expect(shortAgo(at(0,16),now)).toBe('today')
  })
})

describe('followUpSignal',()=>{
  it('states the real lateness rather than the word overdue',()=>{
    const result=followUpSignal({next_task_at:at(-2,9),next_task_title:'Call back',last_activity_at:at(-6,9)},now)
    expect(result.state).toBe('overdue')
    expect(result.dueLabel).toBe('2 days late')
    expect(result.taskTitle).toBe('Call back')
    expect(result.activityLabel).toBe('Last activity 6d ago')
  })

  it('singularises one day late',()=>{
    expect(followUpSignal({next_task_at:at(-1,20),next_task_title:'x',last_activity_at:null},now).dueLabel).toBe('1 day late')
  })

  /* The case a `due < now` check gets wrong: due at 09:00, now is 15:00, still today. Calling this
   * overdue would put a solid red badge on work that is not yet late. */
  it('treats a task due earlier today as due today, not overdue',()=>{
    const result=followUpSignal({next_task_at:at(0,9),next_task_title:'Morning call',last_activity_at:null},now)
    expect(result.state).toBe('today')
    expect(result.dueLabel).toBe('Today')
  })

  it('does not dress a future follow-up as a problem',()=>{
    const result=followUpSignal({next_task_at:at(5,9),next_task_title:'Check in',last_activity_at:null},now)
    expect(result.state).toBe('future')
    expect(result.dueLabel).toBe('in 5d')
  })

  it('says nothing is scheduled without claiming nothing exists',()=>{
    const result=followUpSignal({next_task_at:null,next_task_title:null,last_activity_at:null},now)
    expect(result).toMatchObject({state:'none',taskTitle:null,dueLabel:null,activityLabel:'No activity logged'})
  })

  it('falls back to a verb when a task has no usable title',()=>{
    expect(followUpSignal({next_task_at:at(5,9),next_task_title:'   ',last_activity_at:null},now).taskTitle).toBe('Follow up')
  })
})

describe('pipelineSignal',()=>{
  it('reads Candidate -> Job -> Stage with time parked there',()=>{
    const result=pipelineSignal({open_job_count:1,primary_job_title:'Backend Engineer',primary_stage_name:'Interview',primary_stage_entered_at:at(-12,9)},now)
    expect(result).toMatchObject({inPipeline:true,jobTitle:'Backend Engineer',moreLabel:null,stageLabel:'Interview · 12d'})
  })

  it('counts the other open jobs instead of hiding them',()=>{
    const result=pipelineSignal({open_job_count:3,primary_job_title:'Job B',primary_stage_name:'Screening',primary_stage_entered_at:at(0,9)},now)
    expect(result.moreLabel).toBe('+2 more')
    expect(result.stageLabel).toBe('Screening · 0d')
  })

  it('reports no pipeline when there is none',()=>{
    expect(pipelineSignal({open_job_count:0,primary_job_title:null,primary_stage_name:null,primary_stage_entered_at:null},now).inPipeline).toBe(false)
  })

  /* A member without jobs.read gets count 0 and null columns. That must read as "nothing to show",
   * never as a half-rendered row claiming a job with no stage. */
  it('treats the RLS-degraded shape as no pipeline',()=>{
    const result=pipelineSignal({open_job_count:0,primary_job_title:'Leaked Job',primary_stage_name:'Interview',primary_stage_entered_at:at(-12,9)},now)
    expect(result.inPipeline).toBe(false)
    expect(result.jobTitle).toBeNull()
  })

  it('still names the job when the stage is unknown',()=>{
    const result=pipelineSignal({open_job_count:1,primary_job_title:'Job A',primary_stage_name:null,primary_stage_entered_at:null},now)
    expect(result).toMatchObject({inPipeline:true,jobTitle:'Job A',stageLabel:null})
  })
})

describe('statusFacets',()=>{
  /* The point of the split: active/passive is posture, not lifecycle, so it must not badge. Badging
   * it made every row carry an identical green chip that told a consultant nothing. */
  it('does not badge active, and surfaces the availability that was displayed nowhere',()=>{
    expect(statusFacets({status:'active',availability:'1_month'}))
      .toEqual({lifecycle:null,posture:'Active',availabilityLabel:'1 month'})
  })

  it('badges the outcomes and drops the posture',()=>{
    expect(statusFacets({status:'placed',availability:null})).toEqual({lifecycle:'placed',posture:null,availabilityLabel:null})
    expect(statusFacets({status:'do_not_contact',availability:null})).toMatchObject({lifecycle:'do_not_contact',posture:null})
    expect(statusFacets({status:'archived',availability:null})).toMatchObject({lifecycle:'archived',posture:null})
  })

  it('keeps free-text availability as the human wrote it',()=>{
    // The column has no CHECK, so an import can hold anything; the optionSet returns it untouched.
    expect(statusFacets({status:'passive',availability:'After Ramadan'}))
      .toEqual({lifecycle:null,posture:'Passive',availabilityLabel:'After Ramadan'})
  })

  it('resolves a legacy alias to the curated label',()=>{
    expect(statusFacets({status:'active',availability:'asap'}).availabilityLabel).toBe('Immediately')
  })
})

describe('enrichmentGaps',()=>{
  it('names what is missing, in the order worth fixing',()=>{
    expect(enrichmentGaps({has_cv:false,skill_names:[],current_position:null})).toEqual(['role','skills','CV'])
  })

  it('is empty for a complete record',()=>{
    expect(enrichmentGaps({has_cv:true,skill_names:['SQL'],current_position:'Engineer'})).toEqual([])
  })

  // Owner is deliberately absent: it has its own column and its own queue.
  it('does not double-count a missing owner',()=>{
    expect(enrichmentGaps({has_cv:true,skill_names:['SQL'],current_position:'Engineer'})).not.toContain('owner')
  })
})
