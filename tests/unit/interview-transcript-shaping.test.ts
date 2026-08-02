import {describe,expect,it} from 'vitest'
import {meetingCodeFromUrl,nextAttemptDelayMs,resolveSpeakerRoles,shapeTranscript} from '../../supabase/functions/_shared/interview-transcript'

/* Who was talking is the load-bearing decision in this feature. The consultant review is a judgement
 * about a named member of staff, and it is only worth anything if the lines attributed to them are
 * actually theirs -- so the mapping and the talk-time arithmetic it feeds are tested directly.
 *
 * Google Meet gives a participant resource name and a display name. There is no email, which is why
 * none of this matches on identity. */

const consultantRef='conferenceRecords/x/participants/1'
const candidateRef='conferenceRecords/x/participants/2'
const participants=[
  {name:consultantRef,displayName:'Priya Raman'},
  {name:candidateRef,displayName:'Amara Chen'},
]
const roleOf=(roles:ReturnType<typeof resolveSpeakerRoles>,reference:string)=>roles.get(reference)?.role

describe('speaker role resolution',()=>{
  it('identifies the organizer as the consultant and the pipeline candidate as the candidate',()=>{
    const roles=resolveSpeakerRoles({participants,entries:[],organizerName:'Priya Raman',memberNames:['Priya Raman'],candidateName:'Amara Chen'})
    expect(roleOf(roles,consultantRef)).toBe('consultant')
    expect(roleOf(roles,candidateRef)).toBe('candidate')
  })

  it('matches a Meet display name that is shorter or longer than the ATS record',()=>{
    const roles=resolveSpeakerRoles({
      participants:[{name:consultantRef,displayName:'Priya'},{name:candidateRef,displayName:'Amara Chen Wijaya'}],
      entries:[],organizerName:'Priya Raman',memberNames:['Priya Raman'],candidateName:'Amara Chen Wijaya',
    })
    expect(roleOf(roles,consultantRef)).toBe('consultant')
    expect(roleOf(roles,candidateRef)).toBe('candidate')
  })

  it('does not match a short name inside an unrelated longer one',()=>{
    const roles=resolveSpeakerRoles({participants:[{name:consultantRef,displayName:'Mariana Putri'}],entries:[],organizerName:'Ari',memberNames:['Ari']})
    expect(roleOf(roles,consultantRef)).toBe('other')
  })

  it('infers the second voice as the candidate when only the consultant is identified',()=>{
    const roles=resolveSpeakerRoles({
      participants:[{name:consultantRef,displayName:'Priya Raman'},{name:candidateRef,displayName:'iPhone (guest)'}],
      entries:[],organizerName:'Priya Raman',memberNames:['Priya Raman'],candidateName:'Amara Chen',
    })
    expect(roleOf(roles,candidateRef)).toBe('candidate')
  })

  it('refuses to guess with three unidentified voices',()=>{
    const roles=resolveSpeakerRoles({
      participants:[{name:consultantRef,displayName:'Priya Raman'},{name:candidateRef,displayName:'Guest one'},{name:'p/3',displayName:'Guest two'}],
      entries:[],organizerName:'Priya Raman',memberNames:['Priya Raman'],candidateName:'Amara Chen',
    })
    expect([roleOf(roles,candidateRef),roleOf(roles,'p/3')]).toEqual(['other','other'])
  })

  it('leaves everyone unattributed when no consultant is identified',()=>{
    const roles=resolveSpeakerRoles({participants,entries:[],organizerName:null,memberNames:[],candidateName:null})
    expect([...roles.values()].map((entry)=>entry.role)).toEqual(['other','other'])
  })
})

describe('transcript shaping',()=>{
  const entries=[
    {participant:consultantRef,text:'Thanks for making the time.',languageCode:'en-US',startTime:'2026-07-29T02:00:00Z',endTime:'2026-07-29T02:00:06Z'},
    {participant:candidateRef,text:'I led the regional team for four years.',languageCode:'en-US',startTime:'2026-07-29T02:00:06Z',endTime:'2026-07-29T02:00:20Z'},
  ]
  const named={organizerName:'Priya Raman',memberNames:['Priya Raman'],candidateName:'Amara Chen'}

  it('sums talk time per role and anchors offsets to the first entry',()=>{
    const shaped=shapeTranscript({participants,entries,...named})
    expect(shaped.talkTime).toEqual({consultant_ms:6000,candidate_ms:14000,other_ms:0})
    expect(shaped.entries.map((entry)=>entry.start_ms)).toEqual([0,6000])
    expect(shaped.durationSeconds).toBe(20)
    expect(shaped.language).toBe('en-US')
  })

  it('labels every line with its speaker and role in the flattened text',()=>{
    const shaped=shapeTranscript({participants,entries,...named})
    expect(shaped.plainText).toBe('Priya Raman (consultant): Thanks for making the time.\nAmara Chen (candidate): I led the regional team for four years.')
  })

  it('drops empty lines and contributes no talk time for an entry with no usable end time',()=>{
    const shaped=shapeTranscript({
      participants,
      entries:[
        {participant:consultantRef,text:'   ',startTime:'2026-07-29T02:00:00Z',endTime:'2026-07-29T02:00:06Z'},
        {participant:consultantRef,text:'Still counted as a line.',startTime:'2026-07-29T02:00:00Z'},
      ],
      ...named,
    })
    expect(shaped.entries).toHaveLength(1)
    expect(shaped.talkTime.consultant_ms).toBe(0)
  })

  it('never produces a negative duration from out-of-order timestamps',()=>{
    const shaped=shapeTranscript({
      participants,
      entries:[{participant:consultantRef,text:'Reversed.',startTime:'2026-07-29T02:00:10Z',endTime:'2026-07-29T02:00:04Z'}],
      ...named,
    })
    expect(shaped.talkTime.consultant_ms).toBe(0)
    expect(shaped.entries.every((entry)=>entry.end_ms>=entry.start_ms)).toBe(true)
  })
})

describe('meeting code extraction',()=>{
  it('reads the code out of a hangout link with query parameters',()=>{
    expect(meetingCodeFromUrl('https://meet.google.com/abc-defg-hij?authuser=0')).toBe('abc-defg-hij')
  })
  it('returns null for anything that is not a Meet link',()=>{
    expect(meetingCodeFromUrl('https://zoom.us/j/123')).toBeNull()
    expect(meetingCodeFromUrl(null)).toBeNull()
  })
})

describe('retry backoff',()=>{
  it('lengthens with each attempt and stops growing past the schedule',()=>{
    const delays=[1,2,3,4,5,6,7].map(nextAttemptDelayMs)
    expect(delays).toEqual([5,15,45,120,240,360,360].map((minutes)=>minutes*60_000))
    // Strictly increasing until the schedule runs out, so a transcript that is merely late is not
    // polled at the same rate as one that will never arrive.
    expect(delays.slice(1,6).every((value,index)=>value>(delays.slice(0,5)[index]??Infinity))).toBe(true)
  })
})
