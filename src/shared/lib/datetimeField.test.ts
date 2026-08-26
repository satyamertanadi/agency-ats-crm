import {describe,expect,it} from 'vitest'
import {dateTimeHint,dateTimePreview,isUsableTimeZone} from './datetimeField'

/* What a datetime-local field actually means, and whether we say it correctly.
 *
 * The bug this addresses is not cosmetic: an en-US machine renders 08/09/2026, which half the world
 * reads as 8 September and half as 9 August, and the workspace reports in Asia/Makassar while the
 * control resolves whatever the device says. A consultant can enter a time and have colleagues read
 * a different one.
 *
 * The tests pin the round trip explicitly, including across a DST boundary, because "explain the
 * timezone" is only worth anything if the instant being explained is the instant being stored.
 */

/* The device zone is passed in rather than mocked. A suite that only passes in one timezone is the
 * exact failure mode this module exists to prevent, and mocking Intl to arrange that would be
 * testing the mock. */

describe('timezone usability',()=>{
  it('accepts a real IANA zone',()=>{
    expect(isUsableTimeZone('Asia/Makassar')).toBe(true)
    expect(isUsableTimeZone('Europe/London')).toBe(true)
  })

  /* organizations.timezone is free text and an import can put anything in it. An unknown zone must
   * produce no preview rather than throw underneath a form somebody is typing into. */
  it('rejects anything it cannot format',()=>{
    expect(isUsableTimeZone('Mars/Olympus')).toBe(false)
    expect(isUsableTimeZone('')).toBe(false)
    expect(isUsableTimeZone(null)).toBe(false)
    expect(isUsableTimeZone(undefined)).toBe(false)
  })

  it('does not throw on a nonsense zone',()=>{
    expect(()=>dateTimePreview('2026-08-12T17:00','Mars/Olympus')).not.toThrow()
    expect(dateTimePreview('2026-08-12T17:00','Mars/Olympus')).toBeNull()
  })
})

describe('the preview',()=>{
  it('says nothing about an empty or half-typed value',()=>{
    expect(dateTimePreview('','Asia/Makassar')).toBeNull()
    expect(dateTimePreview(null,'Asia/Makassar')).toBeNull()
    expect(dateTimePreview('not-a-date','Asia/Makassar')).toBeNull()
    // A partially typed year is the common case while somebody is still filling the field in.
    expect(dateTimePreview('2026-','Asia/Makassar')).toBeNull()
  })

  /* The month is a word. That is the entire point: 08/09/2026 is ambiguous to most of the planet and
   * the native control's rendering cannot be changed. */
  it('writes the month as a word rather than a number',()=>{
    const preview=dateTimePreview('2026-08-09T17:00','Asia/Makassar','Asia/Makassar')
    expect(preview?.text).toContain('Aug')
    expect(preview?.text).not.toMatch(/\b08\/09\b|\b09\/08\b/)
  })

  it('reports no divergence when the device already matches the workspace',()=>{
    expect(dateTimePreview('2026-08-12T17:00','Asia/Makassar','Asia/Makassar')?.differsFromDevice).toBe(false)
  })

  it('reports divergence when the device is set elsewhere',()=>{
    expect(dateTimePreview('2026-08-12T17:00','Asia/Makassar','Europe/London')?.differsFromDevice).toBe(true)
  })

  /* Compared by identifier, not by current offset. Europe/London and UTC share an offset in January
   * and differ in July; a hint that vanished seasonally would be worse than one that never appeared. */
  it('reports divergence between zones that share an offset today',()=>{
    expect(dateTimePreview('2026-01-12T17:00','Europe/London','UTC')?.differsFromDevice).toBe(true)
  })
})

describe('the round trip',()=>{
  /* The property that matters: whatever the preview claims, the instant stored is the instant the
   * control resolved. If these ever disagree the hint is actively misleading, which is worse than
   * having no hint at all. */
  const storedInstant=(localValue:string)=>new Date(localValue).toISOString()

  it('previews the same instant that gets stored',()=>{
    const local='2026-08-12T17:00'
    const iso=storedInstant(local)
    const preview=dateTimePreview(local,'Asia/Makassar')
    const rendered=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Makassar',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZoneName:'short'}).format(new Date(iso))
    expect(preview?.text).toBe(rendered)
  })

  /* Asia/Makassar has no DST, so the interesting boundary has to be borrowed from a zone that does.
   * 2026-03-29 01:00 UTC is when Europe/London moves to BST; a preview that ignored DST would render
   * this an hour out. */
  it('survives a DST boundary in a zone that observes one',()=>{
    const before=dateTimePreview('2026-03-29T00:30:00Z','Europe/London')
    const after=dateTimePreview('2026-03-29T02:30:00Z','Europe/London')
    expect(before?.text).toContain('GMT')
    expect(after?.text).toContain('BST')
  })

  it('keeps the workspace reading stable while the device moves',()=>{
    const fromLondon=dateTimePreview('2026-08-12T10:00:00Z','Asia/Makassar','Europe/London')
    const fromNewYork=dateTimePreview('2026-08-12T10:00:00Z','Asia/Makassar','America/New_York')
    // Same instant, same workspace zone, therefore the same sentence wherever it is read.
    expect(fromLondon?.text).toBe(fromNewYork?.text)
  })
})

describe('the hint',()=>{
  it('names the workspace timezone before anything is entered',()=>{
    expect(dateTimeHint('','Asia/Makassar')).toBe('Workspace time: Asia/Makassar')
  })

  it('states what will be saved once a value exists',()=>{
    expect(dateTimeHint('2026-08-12T17:00','Asia/Makassar','Asia/Makassar')).toMatch(/^Saved as .*Aug/)
  })

  /* The one case a consultant needs told: they are typing in one zone and the workspace reads
   * another. */
  it('names both zones when they differ',()=>{
    const hint=dateTimeHint('2026-08-12T17:00','Asia/Makassar','Europe/London')||''
    expect(hint).toContain('your device is set to')
    expect(hint).toContain('Europe/London')
  })

  it('offers nothing when the workspace timezone is unusable',()=>{
    expect(dateTimeHint('2026-08-12T17:00','Mars/Olympus')).toBeNull()
    expect(dateTimeHint('','')).toBeNull()
  })
})
