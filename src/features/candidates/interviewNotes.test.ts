import {describe,expect,it} from 'vitest'
import {MAX_INTERVIEW_NOTES,interviewNotesFromActivities,type NoteSourceActivity} from './interviewNotes'

/* Seeding is the whole reason the notes box gets used. An optional field that starts empty stays
 * empty, so what matters here is that what it seeds is worth keeping: conversations with the
 * candidate, newest first, and nothing that is really logistics.
 */

const activity=(overrides:Partial<NoteSourceActivity>={}):NoteSourceActivity=>({
  activity_type:'call',subject:'Screening call',summary:'Confirmed willing to relocate.',
  occurred_at:'2026-08-20T09:00:00Z',...overrides,
})

describe('seeding interview notes from activities',()=>{
  it('keeps calls and meetings',()=>{
    const seeded=interviewNotesFromActivities([
      activity({activity_type:'call',subject:'Screening call',summary:'Confirmed willing to relocate.'}),
      activity({activity_type:'meeting',subject:'Second interview',summary:'Ran a 12-person team.',occurred_at:'2026-08-21T09:00:00Z'}),
    ])
    expect(seeded).toContain('Confirmed willing to relocate.')
    expect(seeded).toContain('Ran a 12-person team.')
  })

  /* An email or a generic entry is far more likely to be "sent the brief" than an observation about
   * the person. Seeding those is how a consultant learns to clear the box before every generation. */
  it('drops activity types that are not a conversation with the candidate',()=>{
    const seeded=interviewNotesFromActivities([
      activity({activity_type:'email',summary:'Sent the brief over.'}),
      activity({activity_type:'other',summary:'Updated the record.'}),
      activity({activity_type:'whatsapp',summary:'Chased for the CV.'}),
    ])
    expect(seeded).toBe('')
  })

  it('ignores entries with no summary to contribute',()=>{
    expect(interviewNotesFromActivities([activity({summary:''}),activity({summary:null})])).toBe('')
  })

  it('puts the most recent conversation first',()=>{
    const seeded=interviewNotesFromActivities([
      activity({summary:'Older call.',occurred_at:'2026-08-01T09:00:00Z',subject:null}),
      activity({summary:'Newer call.',occurred_at:'2026-08-25T09:00:00Z',subject:null}),
    ])
    expect(seeded.indexOf('Newer call.')).toBeLessThan(seeded.indexOf('Older call.'))
  })

  it('labels a block with its subject, but not when the summary already opens with it',()=>{
    expect(interviewNotesFromActivities([activity({subject:'Second interview',summary:'Ran a 12-person team.'})]))
      .toBe('Second interview: Ran a 12-person team.')
    expect(interviewNotesFromActivities([activity({subject:'Screening call',summary:'Screening call went well.'})]))
      .toBe('Screening call went well.')
  })

  /* A quarter of relationship history in a prompt costs money on every regeneration and buries the
   * interview in it. Three is a screen plus a follow-up; the consultant can add more by hand. */
  it('seeds at most three conversations',()=>{
    const many=Array.from({length:8},(_,index)=>activity({summary:`Call ${index}.`,subject:null,occurred_at:`2026-08-0${index+1}T09:00:00Z`}))
    expect(interviewNotesFromActivities(many).split('\n\n')).toHaveLength(3)
  })

  it('never seeds past the length the form and the database accept',()=>{
    const huge=Array.from({length:3},(_,index)=>activity({summary:'x'.repeat(3000),subject:null,occurred_at:`2026-08-0${index+1}T09:00:00Z`}))
    expect(interviewNotesFromActivities(huge).length).toBeLessThanOrEqual(MAX_INTERVIEW_NOTES)
  })

  it('is empty for a candidate with no activity at all',()=>{
    expect(interviewNotesFromActivities([])).toBe('')
  })
})
