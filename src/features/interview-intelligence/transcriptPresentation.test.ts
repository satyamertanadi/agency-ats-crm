import {describe,expect,it} from 'vitest'
import {formatOffset,transcriptLifecycle} from './transcriptPresentation'
import type {TranscriptOverviewRow} from './transcriptRepository'

const transcript=(overrides:Partial<TranscriptOverviewRow>={}):TranscriptOverviewRow=>({
  transcriptId:'t1',source:'manual_text',status:'ready',entryCount:40,hasTimestamps:true,
  completeness:'complete',createdAt:'2026-09-01T00:00:00Z',purgeDueAt:'2026-12-01T00:00:00Z',
  supersededBy:null,unmappedSpeakerCount:0,speakerCount:2,
  ...overrides,
})

describe('transcript lifecycle',()=>{
  it('says nothing at all when the feature is unavailable',()=>{
    const state=transcriptLifecycle({featureAvailable:false,consent:null,transcripts:[]})
    expect(state.state).toBe('unavailable')
    expect(state.action).toBeNull()
  })

  it('asks for consent before offering to add a transcript',()=>{
    /* Consent gates storage, not just analysis. Offering "Add transcript" first would invite a
     * consultant to paste a recording of a named person that the database then refuses, which reads
     * as a broken feature rather than a skipped step. */
    const state=transcriptLifecycle({featureAvailable:true,consent:null,transcripts:[]})
    expect(state.state).toBe('consent_required')
    expect(state.action).toBe('record_consent')
  })

  it('offers no way forward when consent was declined',()=>{
    const state=transcriptLifecycle({featureAvailable:true,consent:'declined',transcripts:[]})
    expect(state.state).toBe('consent_declined')
    expect(state.action).toBeNull()
  })

  it('treats a withdrawal as final for this interview',()=>{
    const state=transcriptLifecycle({featureAvailable:true,consent:'withdrawn',transcripts:[transcript()]})
    expect(state.state).toBe('consent_withdrawn')
    expect(state.action).toBeNull()
  })

  it('asks for a transcript once consent is granted',()=>{
    const state=transcriptLifecycle({featureAvailable:true,consent:'granted',transcripts:[]})
    expect(state.state).toBe('transcript_required')
    expect(state.action).toBe('add_transcript')
  })

  it('blocks on mapping while any speaker is undecided',()=>{
    const state=transcriptLifecycle({featureAvailable:true,consent:'granted',transcripts:[transcript({unmappedSpeakerCount:2,status:'needs_mapping'})]})
    expect(state.state).toBe('mapping_required')
    expect(state.detail).toContain('2 speakers')
  })

  it('uses the singular for one unmapped speaker',()=>{
    const state=transcriptLifecycle({featureAvailable:true,consent:'granted',transcripts:[transcript({unmappedSpeakerCount:1})]})
    expect(state.detail).toContain('1 speaker is')
  })

  it('ignores a superseded artifact when deciding what to do next',()=>{
    // A superseded transcript is history. Counting its unmapped speakers would block the interview on
    // a version nobody is using.
    const state=transcriptLifecycle({featureAvailable:true,consent:'granted',transcripts:[
      transcript({transcriptId:'old',supersededBy:'new',unmappedSpeakerCount:2}),
      transcript({transcriptId:'new'}),
    ]})
    expect(state.state).toBe('ready')
  })

  it('warns about the missing ratio while something can still be done about it',()=>{
    const state=transcriptLifecycle({featureAvailable:true,consent:'granted',transcripts:[transcript({hasTimestamps:false})]})
    expect(state.state).toBe('ready')
    expect(state.detail).toContain('speaking share will be unavailable')
  })

  it('counts lines across a multi-transcript bundle',()=>{
    const state=transcriptLifecycle({featureAvailable:true,consent:'granted',transcripts:[
      transcript({transcriptId:'a',entryCount:30}),
      transcript({transcriptId:'b',entryCount:20}),
    ]})
    expect(state.detail).toContain('50 lines across 2 transcripts')
  })
})

describe('offset formatting',()=>{
  it('renders a dash rather than 00:00 for a missing timestamp',()=>{
    // 00:00 is a real position in the recording and would read as the interview's opening line.
    expect(formatOffset(null)).toBe('—')
    expect(formatOffset(0)).toBe('0:00')
  })

  it('renders minutes and seconds',()=>{
    expect(formatOffset(65_000)).toBe('1:05')
    expect(formatOffset(600_000)).toBe('10:00')
  })
})
