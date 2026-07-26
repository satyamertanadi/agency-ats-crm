import {useState} from 'react'
import {fireEvent,render,screen} from '@testing-library/react'
import {describe,expect,it} from 'vitest'
import {Combobox} from './Combobox'

/* The motivating case is the candidate tag/skill filters, which are free-text `ilike` against
 * normalized tables today -- so "reactjs" silently matches nothing when the tag is "React". */

const all=[{id:'1',label:'React',detail:'12 candidates'},{id:'2',label:'React Native'},{id:'3',label:'Rust'}]

function Harness({allowFreeText=true}:{allowFreeText?:boolean}){
  const [value,setValue]=useState('')
  const options=all.filter((option)=>option.label.toLowerCase().includes(value.toLowerCase()))
  return <Combobox value={value} onChange={setValue} options={options} label="Skill" allowFreeText={allowFreeText}/>
}

describe('Combobox',()=>{
  it('announces itself as a combobox controlling a listbox',()=>{
    render(<Harness/>)
    const input=screen.getByRole('combobox',{name:'Skill'})
    expect(input).toHaveAttribute('aria-autocomplete','list')
    expect(input).toHaveAttribute('aria-expanded','false')
    fireEvent.focus(input)
    expect(input).toHaveAttribute('aria-expanded','true')
    expect(screen.getByRole('listbox',{name:'Skill'})).toBeInTheDocument()
  })

  it('tracks the highlighted option with aria-activedescendant rather than moving focus off the input',()=>{
    render(<Harness/>)
    const input=screen.getByRole('combobox')
    fireEvent.focus(input)
    input.focus()
    fireEvent.keyDown(input,{key:'ArrowDown'})
    // First option in render order. Its accessible name folds in the detail line, so it is matched
    // positionally rather than by an exact string.
    const active=screen.getAllByRole('option')[0]
    expect(active).toBeDefined()
    expect(input.getAttribute('aria-activedescendant')).toBe(active?.id)
    // Focus must stay put or the user could not keep typing.
    expect(document.activeElement).toBe(input)
  })

  it('commits the highlighted option on Enter',()=>{
    render(<Harness/>)
    const input=screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.keyDown(input,{key:'ArrowDown'})
    fireEvent.keyDown(input,{key:'Enter'})
    expect(input).toHaveValue('React')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('narrows the list as the user types',()=>{
    render(<Harness/>)
    const input=screen.getByRole('combobox')
    fireEvent.change(input,{target:{value:'rea'}})
    expect(screen.getAllByRole('option')).toHaveLength(2)
    fireEvent.change(input,{target:{value:'rus'}})
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  it('says so when nothing matches instead of showing an empty box',()=>{
    render(<Harness/>)
    fireEvent.change(screen.getByRole('combobox'),{target:{value:'cobol'}})
    expect(screen.getByText('No matches')).toBeInTheDocument()
  })

  it('keeps an unmatched value when free text is allowed',()=>{
    render(<Harness allowFreeText/>)
    const input=screen.getByRole('combobox')
    fireEvent.change(input,{target:{value:'cobol'}})
    fireEvent.keyDown(input,{key:'Enter'})
    expect(input).toHaveValue('cobol')
  })

  it('closes the list on Escape without clearing what was typed',()=>{
    render(<Harness/>)
    const input=screen.getByRole('combobox')
    fireEvent.change(input,{target:{value:'rea'}})
    fireEvent.keyDown(input,{key:'Escape'})
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input).toHaveValue('rea')
  })
})
