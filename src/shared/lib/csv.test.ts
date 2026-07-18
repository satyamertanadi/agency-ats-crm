import {describe,expect,it} from 'vitest'
import {csvFilename,toCsv} from './csv'

describe('CSV export',()=>{
  it('writes a header row from the record keys',()=>{
    expect(toCsv([{name:'Ayu',location:'Jakarta'}])).toBe('name,location\r\nAyu,Jakarta')
  })

  /* The reason this uses Papa rather than a comma join. Agency data is full of commas ("Jakarta,
   * Indonesia"), quotes, and pasted newlines, and every one of them silently shifts columns in a
   * hand-rolled writer. */
  it('quotes values containing commas, quotes, and newlines',()=>{
    const csv=toCsv([{name:'Sari, Dewi',note:'She said "yes"',address:'Line one\nLine two'}])
    expect(csv).toContain('"Sari, Dewi"')
    expect(csv).toContain('"She said ""yes"""')
    expect(csv).toContain('"Line one\nLine two"')
  })

  it('still emits headers when the filtered view is empty',()=>{
    expect(toCsv([],['name','status'])).toBe('name,status\n')
    expect(toCsv([])).toBe('')
  })

  it('honours an explicit column order',()=>{
    expect(toCsv([{b:'2',a:'1'}],['a','b'])).toBe('a,b\r\n1,2')
  })

  it('dates the filename so repeated exports do not overwrite each other',()=>{
    expect(csvFilename('candidates',new Date('2026-07-18T10:00:00Z'))).toBe('candidates-2026-07-18.csv')
  })
})
