import {useState} from 'react'
import {fireEvent,render,screen} from '@testing-library/react'
import {describe,expect,it} from 'vitest'
import {SegmentedControl} from './SegmentedControl'

const options=[{id:'list',label:'List'},{id:'board',label:'Board'}] as const

function Harness(){
  const [value,setValue]=useState<'list'|'board'>('list')
  return <SegmentedControl options={options} value={value} onChange={setValue} label="Client view"/>
}

describe('SegmentedControl',()=>{
  it('presents mutually exclusive options as a radiogroup rather than plain buttons',()=>{
    render(<Harness/>)
    expect(screen.getByRole('radiogroup',{name:'Client view'})).toBeInTheDocument()
    expect(screen.getByRole('radio',{name:'List'})).toHaveAttribute('aria-checked','true')
    expect(screen.getByRole('radio',{name:'Board'})).toHaveAttribute('aria-checked','false')
  })

  it('keeps a single tab stop on the checked option',()=>{
    render(<Harness/>)
    expect(screen.getByRole('radio',{name:'List'})).toHaveAttribute('tabindex','0')
    expect(screen.getByRole('radio',{name:'Board'})).toHaveAttribute('tabindex','-1')
  })

  it('switches with the arrow keys and wraps',()=>{
    render(<Harness/>)
    const group=screen.getByRole('radiogroup')
    fireEvent.keyDown(group,{key:'ArrowRight'})
    expect(screen.getByRole('radio',{name:'Board'})).toHaveAttribute('aria-checked','true')
    fireEvent.keyDown(group,{key:'ArrowRight'})
    expect(screen.getByRole('radio',{name:'List'})).toHaveAttribute('aria-checked','true')
  })
})
