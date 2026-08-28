import {describe,expect,it} from 'vitest'
import {
  compareDimension,coverageLabel,dimensionLabel,drilldownTruncated,orderedThemes,
  processingNotes,ratePercent,sampleNote,speakingShareNote,
} from './qualityPresentation'
import type {DimensionTrend,QualityScorecard,TeamPatterns} from './qualityRepository'

/* The Scorecard's rules are all one rule: say what the number rests on, or do not say the number.
 * These tests exist because every one of them is a place where a plausible-looking figure would be
 * more damaging than a blank. */

const trend=(over:Partial<DimensionTrend>={}):DimensionTrend=>({
  dimension:'question_quality',interviews:5,averageScore:3.2,attentionFindings:0,
  attentionInterviewIds:[],previousInterviews:5,previousAverageScore:2.8,...over,
})

const scorecard=(over:Partial<QualityScorecard>={}):QualityScorecard=>({
  scope:'mine',analysedInterviews:6,previousAnalysedInterviews:4,minimumSample:3,drilldownCap:100,
  interviewIds:[],bands:[],dimensions:[],
  conversation:{measuredInterviews:6,unmeasuredInterviews:0,averageConsultantSharePercent:42.5},
  coaching:{open:0,acknowledged:0,completed:0,overdue:0},...over,
})

const patterns=(over:Partial<TeamPatterns>={}):TeamPatterns=>({
  analysedInterviews:10,minimumSample:3,drilldownCap:100,coverage:[],themes:[],
  attentionFindings:0,attentionInterviewIds:[],
  transcripts:{total:10,complete:8},runs:{total:10,failed:1},...over,
})

describe('sample size', ()=>{
  it('distinguishes an empty period from one that is merely too small',()=>{
    /* Both produce a null average, and they mean opposite things to the reader: one is "nothing has
     * happened yet", the other is "keep going". Collapsing them into a dash makes the Scorecard look
     * broken during exactly the period a new workspace first opens it. */
    expect(sampleNote(0,3)).toBe('No analysed interviews yet in this period.')
    expect(sampleNote(2,3)).toBe('2 of 3 interviews needed before an average is shown.')
  })

  it('says nothing once the floor is met',()=>{
    expect(sampleNote(3,3)).toBeNull()
    expect(sampleNote(40,3)).toBeNull()
  })
})

describe('comparing a dimension against the consultant\'s own history',()=>{
  it('reports the change in score points, never as a percentage',()=>{
    /* These are 0-4 rubric scores. "Up 14%" of a four-point scale is a number with no meaning that
     * reads as though it had one. */
    const result=compareDimension(trend(),3)
    expect(result.direction).toBe('improved')
    expect(result.delta).toBe(0.4)
    expect(result.note).toContain('Up 0.40')
    expect(result.note).not.toContain('%')
  })

  it('refuses to compare when the previous period is below the floor',()=>{
    /* A solid month against a single interview last month is not a trend, and rendering it as one
     * would be the most persuasive wrong number on the page. */
    const result=compareDimension(trend({previousInterviews:1,previousAverageScore:1.0}),3)
    expect(result.direction).toBe('not_comparable')
    expect(result.delta).toBeNull()
    expect(result.note).toContain('both periods')
  })

  it('refuses to compare when the current period is below the floor',()=>{
    const result=compareDimension(trend({interviews:2,averageScore:4}),3)
    expect(result.direction).toBe('not_comparable')
    expect(result.delta).toBeNull()
  })

  it('says so plainly when there is no previous period at all',()=>{
    const result=compareDimension(trend({previousInterviews:0,previousAverageScore:null}),3)
    expect(result.direction).toBe('not_comparable')
    expect(result.note).toBe('No interviews in the previous period to compare against.')
  })

  it('treats a small movement as steady rather than as a direction',()=>{
    /* A tenth of a point across a handful of interviews is noise. Calling it "improved" invites a
     * consultant to change what they are doing in response to nothing. */
    const result=compareDimension(trend({averageScore:3.0,previousAverageScore:2.9}),3)
    expect(result.direction).toBe('steady')
    expect(result.note).toContain('Steady')
  })

  it('reports a real decline rather than softening it',()=>{
    const result=compareDimension(trend({averageScore:2.1,previousAverageScore:3.3}),3)
    expect(result.direction).toBe('declined')
    expect(result.delta).toBe(-1.2)
    expect(result.note).toContain('Down 1.20')
  })
})

describe('speaking share',()=>{
  it('states the consultant\'s own share without implying a correct one',()=>{
    /* There is no ideal talk/listen ratio -- it depends on the role, the stage and the candidate. A
     * target here would be invented precision presented as a standard. */
    const note=speakingShareNote(scorecard())
    expect(note).toContain('42.5%')
    expect(note).toContain('6 interviews')
    expect(note).not.toMatch(/should|ideal|target|too much|recommended/i)
  })

  it('reports how many interviews could not be measured rather than hiding them',()=>{
    const note=speakingShareNote(scorecard({
      conversation:{measuredInterviews:3,unmeasuredInterviews:6,averageConsultantSharePercent:38},
    }))
    expect(note).toContain('6 more could not be measured')
  })

  it('withholds the share when too few interviews were measurable',()=>{
    /* The transcripts may exist; if their timestamps were too sparse the share is arithmetically
     * valid and means nothing. */
    const note=speakingShareNote(scorecard({
      conversation:{measuredInterviews:2,unmeasuredInterviews:4,averageConsultantSharePercent:null},
    }))
    expect(note).toContain('2 of 3 interviews needed')
  })
})

describe('rates',()=>{
  it('refuses to divide by nothing',()=>{
    /* "0%" and "no transcripts at all" render identically once the division has happened, and the
     * second is a pipeline problem rather than a quality one. */
    expect(ratePercent(0,0)).toBeNull()
    expect(ratePercent(0,10)).toBe(0)
  })

  it('keeps the denominator beside every rate it prints',()=>{
    const notes=processingNotes(patterns())
    expect(notes[0]!.value).toBe('80%')
    expect(notes[0]!.caption).toBe('8 of 10 transcripts')
    expect(notes[1]!.value).toBe('10%')
    expect(notes[1]!.caption).toBe('1 of 10 runs')
  })

  it('says there was nothing rather than showing a dash with no explanation',()=>{
    const notes=processingNotes(patterns({transcripts:{total:0,complete:0},runs:{total:0,failed:0}}))
    expect(notes[0]!.value).toBe('—')
    expect(notes[0]!.caption).toBe('No transcripts in this period')
    expect(notes[1]!.caption).toBe('No analysis runs in this period')
  })
})

describe('team themes',()=>{
  it('orders by how widely a theme appears, breaking ties predictably',()=>{
    const ordered=orderedThemes(patterns({themes:[
      {dimension:'question_quality',findings:9,interviews:3,interviewIds:[]},
      {dimension:'listening_balance',findings:4,interviews:7,interviewIds:[]},
      {dimension:'essential_coverage',findings:12,interviews:3,interviewIds:[]},
    ]}))
    expect(ordered.map((item)=>item.dimension)).toEqual(['listening_balance','essential_coverage','question_quality'])
  })

  it('carries no member identifier that could be re-sorted into a ranking of people',()=>{
    /* The plan says never rank consultants. The reliable way to honour that is for the data to be
     * absent rather than merely unrendered, because the surface that renders it is the easiest thing
     * in the system to change later. */
    const ordered=orderedThemes(patterns({themes:[{dimension:'question_quality',findings:2,interviews:2,interviewIds:['i1','i2']}]}))
    const keys=Object.keys(ordered[0]!)
    /* interviewIds is the drilldown -- the interviews behind a training theme, which a reviewer may
     * already open one at a time. What is absent is any member identifier, so nothing here can be
     * re-sorted into a list of consultants ordered by score. */
    expect(keys).toEqual(['dimension','findings','interviews','interviewIds'])
    expect(JSON.stringify(ordered)).not.toMatch(/member|consultant_id|subject/i)
  })
})

describe('labels',()=>{
  it('names insufficient evidence as a limit of the recording, not a low grade',()=>{
    expect(dimensionLabel('listening_balance')).toBe('Listening balance')
    expect(coverageLabel('insufficient_evidence')).toBe('Could not tell')
  })

  it('passes an unrecognised value through rather than rendering undefined',()=>{
    // A new band added by a later prompt version must not blank a row.
    expect(dimensionLabel('something_new')).toBe('something_new')
  })
})

describe('drilldown honesty',()=>{
  it('flags truncation only when the list actually stops short at the cap',()=>{
    expect(drilldownTruncated(140,100,100)).toBe(true)
    expect(drilldownTruncated(40,40,100)).toBe(false)
    // Fewer rows than the count but not because of the cap is a bug elsewhere, not truncation.
    expect(drilldownTruncated(40,30,100)).toBe(false)
  })
})
