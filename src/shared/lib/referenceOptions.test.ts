import {describe,expect,it} from 'vitest'
import {withCurrentOption} from './referenceOptions'

const list=[{id:'a',name:'Acme'},{id:'b',name:'Bumi'}]

describe('withCurrentOption',()=>{
  /* THE bug. A <select defaultValue> whose options lack that value silently selects the FIRST option,
   * so saving the form writes a different reference than the one on screen -- a contact reassigned to
   * another client, reported as success. The fixture deliberately uses an id that is NOT in the list;
   * one that happened to be present would prove nothing. */
  it('keeps a current value that the list does not contain',()=>{
    const result=withCurrentOption(list,{id:'z',name:'Zenith Holdings'})
    expect(result[0]).toEqual({id:'z',name:'Zenith Holdings'})
    expect(result).toHaveLength(3)
  })

  it('does not duplicate a current value the list already has',()=>{
    const result=withCurrentOption(list,{id:'b',name:'Bumi'})
    expect(result).toEqual(list)
    expect(result.filter((option)=>option.id==='b')).toHaveLength(1)
  })

  it('leaves the list alone when there is no current value',()=>{
    expect(withCurrentOption(list,null)).toEqual(list)
    expect(withCurrentOption(list,undefined)).toEqual(list)
    expect(withCurrentOption(list,{id:null})).toEqual(list)
    expect(withCurrentOption(list,{id:''})).toEqual(list)
  })

  /* An embed can come back permission-filtered under RLS: the id is on the row, the name is not. The
   * option must still exist -- dropping it would reintroduce the exact silent-reassignment bug for
   * precisely the users whose permissions are most restricted. */
  it('still keeps the value when the label is missing',()=>{
    expect(withCurrentOption(list,{id:'z'})[0]).toEqual({id:'z',name:'Current selection (not in list)'})
    expect(withCurrentOption(list,{id:'z',name:'   '})[0]?.name).toBe('Current selection (not in list)')
  })

  it('survives a list that has not loaded yet',()=>{
    expect(withCurrentOption(undefined,{id:'z',name:'Zenith'})).toEqual([{id:'z',name:'Zenith'}])
    expect(withCurrentOption(undefined,null)).toEqual([])
  })

  it('does not mutate the list it was given',()=>{
    const original=[...list]
    withCurrentOption(list,{id:'z',name:'Zenith'})
    expect(list).toEqual(original)
  })
})
