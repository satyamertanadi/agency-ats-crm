import {useState} from 'react'
import {fireEvent,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {TabPanel,Tabs,useTabsId} from './Tabs'

/* The three hand-rolled tab strips this replaces had role="tab" but no tabpanel, no aria-controls, and
 * no arrow keys. These assert the parts a user or a screen reader can actually feel. */

const items=[{id:'overview',label:'Overview'},{id:'profile',label:'Profile'},{id:'activity',label:'Activity'}] as const
type Section=typeof items[number]['id']

function Harness(){
  const [value,setValue]=useState<Section>('overview')
  const tabsId=useTabsId()
  return <>
    <Tabs items={items} value={value} onChange={setValue} label="Candidate sections" id={tabsId}/>
    <TabPanel tabsId={tabsId} id={value}>Content for {value}</TabPanel>
  </>
}

describe('Tabs',()=>{
  beforeEach(()=>vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callback(0);return 0}))
  afterEach(()=>vi.unstubAllGlobals())

  it('exposes one tab stop for the whole strip, on the selected tab',()=>{
    render(<Harness/>)
    expect(screen.getByRole('tab',{name:'Overview'})).toHaveAttribute('tabindex','0')
    expect(screen.getByRole('tab',{name:'Profile'})).toHaveAttribute('tabindex','-1')
    expect(screen.getByRole('tab',{name:'Activity'})).toHaveAttribute('tabindex','-1')
  })

  it('moves selection with the arrow keys and wraps at the end',()=>{
    render(<Harness/>)
    const strip=screen.getByRole('tablist',{name:'Candidate sections'})
    fireEvent.keyDown(strip,{key:'ArrowRight'})
    expect(screen.getByRole('tab',{name:'Profile'})).toHaveAttribute('aria-selected','true')
    fireEvent.keyDown(strip,{key:'ArrowRight'})
    fireEvent.keyDown(strip,{key:'ArrowRight'})
    expect(screen.getByRole('tab',{name:'Overview'})).toHaveAttribute('aria-selected','true')
  })

  it('wraps backwards from the first tab to the last',()=>{
    render(<Harness/>)
    fireEvent.keyDown(screen.getByRole('tablist'),{key:'ArrowLeft'})
    expect(screen.getByRole('tab',{name:'Activity'})).toHaveAttribute('aria-selected','true')
  })

  it('jumps to the ends with Home and End',()=>{
    render(<Harness/>)
    const strip=screen.getByRole('tablist')
    fireEvent.keyDown(strip,{key:'End'})
    expect(screen.getByRole('tab',{name:'Activity'})).toHaveAttribute('aria-selected','true')
    fireEvent.keyDown(strip,{key:'Home'})
    expect(screen.getByRole('tab',{name:'Overview'})).toHaveAttribute('aria-selected','true')
  })

  it('wires the selected tab to its panel so assistive tech can follow the relationship',()=>{
    render(<Harness/>)
    const tab=screen.getByRole('tab',{name:'Overview'})
    const panel=screen.getByRole('tabpanel')
    expect(tab.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.id)
  })
})
