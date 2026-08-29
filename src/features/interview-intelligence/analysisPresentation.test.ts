import {describe,expect,it} from 'vitest'
import {
  analysisStatusLine,
  candidateBand,
  formatShare,
  metricsAreUsable,
  metricsUnavailableReason,
  resultLabel,
  speakingShares,
} from './analysisPresentation'
import type {MetricSummary,SpeakerMetric} from './analysisRepository'

const speaker=(id:string,speechMs:number,role='consultant'):SpeakerMetric=>({
  speakerId:id,speakerRole:role,subjectMemberId:null,speechMs,turnCount:1,averageTurnMs:speechMs,longestTurnMs:speechMs,
})

const summary=(overrides:Partial<MetricSummary>={}):MetricSummary=>({
  timestampCoverage:1,unknownSpeechMs:0,overlapMs:0,overlapCount:0,metricConfidence:'high',...overrides,
})

describe('speaking share',()=>{
  it('divides by summed participant speech',()=>{
    const shares=speakingShares([speaker('a',4000),speaker('b',6000,'candidate')])
    expect(shares.get('a')).toBe(0.4)
    expect(shares.get('b')).toBe(0.6)
  })

  it('counts unknown speech as its own share rather than redistributing it',()=>{
    // Redistributing would quietly flatter whoever the mapping did recognise.
    const shares=speakingShares([speaker('a',2000),speaker('b',2000,'candidate'),speaker('c',6000,'unknown')])
    expect(shares.get('c')).toBe(0.6)
    expect(shares.get('a')).toBe(0.2)
  })

  it('reports Unavailable, never 0%, when nothing was measured',()=>{
    /* The most quietly convincing lie this product could tell is a speaking ratio for a transcript
     * that carries no timestamps. */
    const shares=speakingShares([speaker('a',0),speaker('b',0,'candidate')])
    expect(shares.get('a')).toBeNull()
    expect(formatShare(null)).toBe('Unavailable')
    expect(formatShare(0)).toBe('0%')
  })
})

describe('when metrics may be shown at all',()=>{
  it('hides them when nothing is timed, and says why',()=>{
    expect(metricsAreUsable(summary({timestampCoverage:0,metricConfidence:'low'}))).toBe(false)
    expect(metricsUnavailableReason(summary({timestampCoverage:0}))).toContain('no timestamps')
  })

  it('hides them when confidence is low, even with some timing',()=>{
    // Partial coverage produces numbers that look exact and are not.
    expect(metricsAreUsable(summary({timestampCoverage:0.4,metricConfidence:'low'}))).toBe(false)
    expect(metricsUnavailableReason(summary({timestampCoverage:0.4,metricConfidence:'low'}))).toContain('reliable')
  })

  it('shows them when coverage and confidence are good',()=>{
    expect(metricsAreUsable(summary())).toBe(true)
  })

  it('treats a missing summary as unusable',()=>{
    expect(metricsAreUsable(null)).toBe(false)
  })
})

describe('result wording',()=>{
  it('says "not asked about" rather than anything that reads as a mark against the candidate',()=>{
    /* The invariant the whole product is built around. To a hurried consultant, "not evidenced" reads
     * as a failing; the truth is that nobody asked. */
    expect(resultLabel('not_evidenced').label).toBe('Not asked about')
    expect(resultLabel('not_evidenced').tone).toBe('neutral')
  })

  it('keeps contradicted visually distinct from not asked',()=>{
    expect(resultLabel('contradicted').tone).toBe('bad')
    expect(resultLabel('not_evidenced').tone).not.toBe('bad')
  })

  it('never produces a percentage for a band',()=>{
    for(const band of ['strong_evidence_of_fit','promising_but_incomplete','material_concerns','clear_mismatch','insufficient_evidence']){
      expect(candidateBand(band).label).not.toMatch(/\d/)
    }
  })
})

describe('status line',()=>{
  it('says a stale result is still the previous one',()=>{
    const line=analysisStatusLine({status:'completed',isStale:true,errorCode:null})
    expect(line.label).toBe('May be outdated')
    expect(line.detail).toContain('still the previous result')
  })

  it('does not call a completed, current analysis outdated',()=>{
    expect(analysisStatusLine({status:'completed',isStale:false,errorCode:null}).label).toBe('Complete')
  })

  it('says nothing was stored when a run failed',()=>{
    const line=analysisStatusLine({status:'failed',isStale:false,errorCode:'provider_rejected'})
    expect(line.detail).toContain('Nothing was stored')
  })

  it('explains a rejection for prohibited inference without repeating what was said',()=>{
    const line=analysisStatusLine({status:'failed',isStale:false,errorCode:'prohibited_inference'})
    expect(line.detail).toContain('must not assess')
    expect(line.detail).toContain('Nothing was stored')
  })

  it('offers the next step when there is no run yet',()=>{
    expect(analysisStatusLine({status:null,isStale:false,errorCode:null}).label).toBe('Not analysed')
  })
})

describe('a stopped run reads as stopped, not as never started',()=>{
  it('names the consent case and does not invite a retry',()=>{
    /* Before cancellation existed as a status this fell through to "Not analysed -- request an
     * analysis once the transcript and speakers are ready", which hid a deliberate stop and pointed
     * the consultant at an action that would be refused for the same reason. */
    const line=analysisStatusLine({status:'cancelled',isStale:false,errorCode:'consent_not_granted'})
    expect(line.label).toBe('Analysis stopped')
    expect(line.detail).toContain('withdrew consent')
    expect(line.detail).toContain('Nothing was sent')
    expect(line.detail).not.toMatch(/try again|request an analysis/i)
  })

  it('distinguishes a disabled workspace from a withdrawn candidate',()=>{
    const disabled=analysisStatusLine({status:'cancelled',isStale:false,errorCode:'feature_disabled'})
    expect(disabled.detail).toContain('switched off')
    expect(disabled.detail).not.toContain('withdrew')
  })

  it('still says something safe for a reason it does not recognise',()=>{
    // A later gate reason must not render an empty detail line.
    const line=analysisStatusLine({status:'cancelled',isStale:false,errorCode:'something_new'})
    expect(line.label).toBe('Analysis stopped')
    expect(line.detail).toContain('Nothing was sent')
  })

  it('never reports a cancelled run as a failure',()=>{
    // "Failed" invites a retry and reads as a defect; neither is true here.
    const line=analysisStatusLine({status:'cancelled',isStale:false,errorCode:'consent_not_granted'})
    expect(line.tone).not.toBe('bad')
  })
})
