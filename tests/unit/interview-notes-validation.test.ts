import {describe,expect,it} from 'vitest'
import {RUBRIC_CRITERIA,summarizeRubric,validateInterviewNotes} from '../../supabase/functions/_shared/interview-schema'

/* The validator is the only thing standing between provider output and a record that grades a named
 * member of staff and feeds a hiring decision. What it must not allow through: a finding with no
 * transcript line behind it, a rubric the model reshaped, or a score the model chose for itself. */

const valid={
  detected_language:'en-US',
  summary:{
    headline:'Four years leading a regional commercial team.',
    key_points:['Led a regional team.','',' '],
    topics_covered:[{topic:'Experience',notes:'Regional leadership.'},{topic:'',notes:'dropped'}],
    candidate_stated_facts:[{fact:'ignored key',point:'Four years in role',quote:'I led it for four years.'}],
    logistics:{notice_period:'2 months',salary_expectation:'',location_preference:'',availability:''},
  },
  candidate_assessment:{
    requirement_evidence:[
      {requirement:'regional team leadership',classification:'matched',quote:'I led the regional team.',explanation:'Stated directly.'},
      {requirement:'energy experience',classification:'uncertain',quote:'',explanation:'Never discussed.'},
    ],
    strengths:[{point:'Clear ownership',quote:'I led it.'}],
    concerns:[],open_questions:['Confirm sector experience.'],recommendation_note:'Validate energy exposure.',
  },
  consultant_assessment:{
    rubric:[{criterion:'role_and_process_explained',rating:'strong',evidence_quote:'Let me explain the role.',coaching_note:'Keep doing this.'}],
    missed_topics:['salary expectations'],
  },
}

describe('interview notes validation',()=>{
  it('accepts a well-formed result and derives the score from the evidence',()=>{
    const notes=validateInterviewNotes(valid)
    // matched=1, uncertain=.25 over two requirements -> 63 after rounding.
    expect(notes.score).toBe(63)
    expect(notes.summary.headline).toBe(valid.summary.headline)
  })

  it('ignores a score the provider tries to supply',()=>{
    const notes=validateInterviewNotes({...valid,score:100,rating_summary:{strong:99,adequate:0,needs_work:0,not_observed:0,index:99}})
    expect(notes.score).toBe(63)
    expect(notes.rating_summary.index).not.toBe(99)
  })

  it('rejects a supported finding with no transcript quote behind it',()=>{
    expect(()=>validateInterviewNotes({...valid,candidate_assessment:{...valid.candidate_assessment,
      requirement_evidence:[{requirement:'regional team leadership',classification:'matched',quote:'',explanation:'Seems likely.'}]}}))
      .toThrow(/quote the transcript/)
  })

  it('rejects a result with no summary headline',()=>{
    expect(()=>validateInterviewNotes({...valid,summary:{...valid.summary,headline:'  '}})).toThrow(/headline/)
  })

  it('rejects an unknown evidence classification',()=>{
    expect(()=>validateInterviewNotes({...valid,candidate_assessment:{...valid.candidate_assessment,
      requirement_evidence:[{requirement:'x',classification:'excellent',quote:'q',explanation:'e'}]}}))
      .toThrow(/invalid/i)
  })

  it('always returns the full fixed rubric, filling omissions with not_observed',()=>{
    const notes=validateInterviewNotes(valid)
    expect(notes.consultant_assessment.rubric.map((entry)=>entry.criterion)).toEqual([...RUBRIC_CRITERIA])
    expect(notes.consultant_assessment.rubric.filter((entry)=>entry.rating==='not_observed')).toHaveLength(RUBRIC_CRITERIA.length-1)
  })

  it('discards criteria the provider invented and keeps only the first of a duplicate',()=>{
    const notes=validateInterviewNotes({...valid,consultant_assessment:{...valid.consultant_assessment,rubric:[
      {criterion:'charisma',rating:'strong',evidence_quote:'q',coaching_note:''},
      {criterion:'salary_expectation',rating:'strong',evidence_quote:'first',coaching_note:''},
      {criterion:'salary_expectation',rating:'needs_work',evidence_quote:'second',coaching_note:''},
    ]}})
    expect(notes.consultant_assessment.rubric.some((entry)=>entry.criterion==='charisma')).toBe(false)
    const salary=notes.consultant_assessment.rubric.find((entry)=>entry.criterion==='salary_expectation')
    expect(salary).toMatchObject({rating:'strong',evidence_quote:'first'})
  })

  it('downgrades a rating asserted without a supporting quote',()=>{
    const notes=validateInterviewNotes({...valid,consultant_assessment:{...valid.consultant_assessment,
      rubric:[{criterion:'probed_vague_answers',rating:'needs_work',evidence_quote:'',coaching_note:'Push harder.'}]}})
    expect(notes.consultant_assessment.rubric.find((entry)=>entry.criterion==='probed_vague_answers')?.rating).toBe('not_observed')
  })

  it('strips empty strings and entries missing their required field',()=>{
    const notes=validateInterviewNotes(valid)
    expect(notes.summary.key_points).toEqual(['Led a regional team.'])
    expect(notes.summary.topics_covered).toHaveLength(1)
  })
})

describe('rubric summary',()=>{
  it('excludes not_observed from the index rather than scoring it zero',()=>{
    const summary=summarizeRubric([
      {criterion:'role_and_process_explained',rating:'strong',evidence_quote:'q',coaching_note:''},
      {criterion:'salary_expectation',rating:'not_observed',evidence_quote:'',coaching_note:''},
    ])
    expect(summary).toEqual({strong:1,adequate:0,needs_work:0,not_observed:1,index:100})
  })

  it('is zero rather than NaN when nothing was observable',()=>{
    expect(summarizeRubric([{criterion:'salary_expectation',rating:'not_observed',evidence_quote:'',coaching_note:''}]).index).toBe(0)
  })
})
