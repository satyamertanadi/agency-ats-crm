import {describe,expect,it} from 'vitest'
import {buildAutocompleteRequestBody,mapAutocompleteResponse} from '../../supabase/functions/_shared/places'

describe('Places Autocomplete request body',()=>{
  it('biases toward Indonesia via a rectangle, never a hard region restriction',()=>{
    const body=buildAutocompleteRequestBody('Jak','session-1')
    expect(body).toMatchObject({input:'Jak',sessionToken:'session-1'})
    expect(body.locationBias).toHaveProperty('rectangle')
    // The whole point of "bias, not restrict" is that these keys never appear -- either one would
    // hard-filter results to Indonesia and silently break "let me type a London address too."
    expect(body).not.toHaveProperty('locationRestriction')
    expect(body).not.toHaveProperty('includedRegionCodes')
  })

  it('carries the same session token across calls so Google bills one search as one session',()=>{
    const first=buildAutocompleteRequestBody('Jak','session-1')
    const second=buildAutocompleteRequestBody('Jaka',first.sessionToken)
    expect(second.sessionToken).toBe('session-1')
  })
})

describe('Places Autocomplete response mapping',()=>{
  it('maps place predictions to the {id,label} shape Combobox needs',()=>{
    const result=mapAutocompleteResponse({suggestions:[
      {placePrediction:{placeId:'place-1',text:{text:'Jakarta, Indonesia'}}},
      {placePrediction:{placeId:'place-2',text:{text:'Jakarta Barat, Jakarta, Indonesia'}}},
    ]})
    expect(result).toEqual([
      {id:'place-1',label:'Jakarta, Indonesia'},
      {id:'place-2',label:'Jakarta Barat, Jakarta, Indonesia'},
    ])
  })

  it('drops a prediction missing an id or a label rather than rendering a broken option',()=>{
    const result=mapAutocompleteResponse({suggestions:[
      {placePrediction:{placeId:'place-1',text:{text:'Jakarta, Indonesia'}}},
      {placePrediction:{placeId:undefined,text:{text:'No id'}}},
      {placePrediction:{placeId:'place-3',text:undefined}},
      {placePrediction:{placeId:'place-4',text:{text:''}}},
    ]})
    expect(result).toEqual([{id:'place-1',label:'Jakarta, Indonesia'}])
  })

  it('returns an empty list rather than throwing when Google sends no suggestions at all',()=>{
    expect(mapAutocompleteResponse({})).toEqual([])
    expect(mapAutocompleteResponse({suggestions:[]})).toEqual([])
  })
})
