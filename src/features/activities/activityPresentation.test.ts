import {describe,expect,it} from 'vitest'
import {presentActivity} from './activityPresentation'

describe('activity presentation',()=>{
  it('promotes phase movement while retaining detailed stages',()=>{expect(presentActivity({activity_type:'status_change',subject:'Stage changed',summary:'Moved from Interested to Client Ready.'})).toEqual({title:'Moved from Screening to Shortlist',summary:'Interested → Client Ready',detail:'Detailed stage'})})
  it('describes movement inside one phase',()=>{expect(presentActivity({activity_type:'status_change',subject:null,summary:'Moved from Submitted to Client to Client Reviewing.'}).title).toBe('Moved within Client review')})
  it('leaves manual activity unchanged',()=>{expect(presentActivity({activity_type:'call',subject:'Catch-up',summary:'Available Monday'})).toEqual({title:'Catch-up',summary:'Available Monday',detail:null})})
})
