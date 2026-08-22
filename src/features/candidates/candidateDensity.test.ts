import {afterEach,describe,expect,it,vi} from 'vitest'
import {readDensity,writeDensity} from './candidateDensity'

afterEach(()=>{localStorage.clear();vi.restoreAllMocks()})

describe('candidate density preference',()=>{
  /* Compact is the default on purpose. The screen's stated problem is that it is too spacious for
   * people who live in it all day, and whatever ships as the default is what almost everyone uses --
   * a preference nobody finds is not a fix. */
  it('defaults to compact when nothing is stored',()=>{
    expect(readDensity()).toBe('compact')
  })

  it('round-trips a choice',()=>{
    writeDensity('comfortable')
    expect(readDensity()).toBe('comfortable')
    writeDensity('compact')
    expect(readDensity()).toBe('compact')
  })

  it('treats an unrecognised stored value as the default rather than trusting it',()=>{
    localStorage.setItem('candidate-density','enormous')
    expect(readDensity()).toBe('compact')
  })

  /* Private-mode Safari throws on localStorage rather than returning null. A remembered row height is
   * not worth taking the page down for, which is why all five keys in this app are wrapped. */
  it('survives a browser that refuses storage',()=>{
    vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('denied')})
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('denied')})
    expect(()=>writeDensity('comfortable')).not.toThrow()
    expect(readDensity()).toBe('compact')
  })
})
