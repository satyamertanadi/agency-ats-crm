import {useState} from 'react'
import {fireEvent,render,screen} from '@testing-library/react'
import {describe,expect,it,vi} from 'vitest'
import {Field} from './Field'
import {OptionSelect} from './OptionSelect'

/* Two contracts matter here and neither is caught by a typecheck: that the control emits the KEY and
 * not the label, and that in uncontrolled mode the value reaches FormData -- which is how the client
 * edit form (a bare <form> read with FormData) saves. */

const options=[{value:'hospitality',label:'Hospitality'},{value:'food_beverage',label:'Food & beverage'}]

function Harness({initial='',onChange}:{initial?:string;onChange?:(value:string)=>void}){
  const [value,setValue]=useState(initial)
  return <Field label="Industry"><OptionSelect label="Industry" options={options} value={value} onChange={(next)=>{setValue(next);onChange?.(next)}}/></Field>
}

describe('OptionSelect',()=>{
  it('renders the placeholder, every option, and the Other row',()=>{
    render(<Harness/>)
    const select=screen.getByRole('combobox',{name:'Industry'})
    expect(select).toHaveValue('')
    expect(screen.getByRole('option',{name:'Not recorded'})).toBeInTheDocument()
    expect(screen.getByRole('option',{name:'Hospitality'})).toBeInTheDocument()
    expect(screen.getByRole('option',{name:'Food & beverage'})).toBeInTheDocument()
    expect(screen.getByRole('option',{name:'Other…'})).toBeInTheDocument()
  })

  it('reports the key, not the label',()=>{
    const onChange=vi.fn()
    render(<Harness onChange={onChange}/>)
    fireEvent.change(screen.getByRole('combobox',{name:'Industry'}),{target:{value:'food_beverage'}})
    expect(onChange).toHaveBeenCalledWith('food_beverage')
  })

  it('reveals a named free-text row for Other and clears the value immediately',()=>{
    // Clearing on the way in matters: leaving the previous key in place would save a sector the
    // consultant has just said is wrong if they abandon the form half-typed.
    const onChange=vi.fn()
    render(<Harness initial="hospitality" onChange={onChange}/>)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox',{name:'Industry'}),{target:{value:'__other__'}})
    expect(onChange).toHaveBeenCalledWith('')
    expect(screen.getByRole('textbox',{name:'Industry — other'})).toBeInTheDocument()
  })

  it('passes free text through verbatim and keeps the row open while typing',()=>{
    const onChange=vi.fn()
    render(<Harness onChange={onChange}/>)
    fireEvent.change(screen.getByRole('combobox',{name:'Industry'}),{target:{value:'__other__'}})
    const other=screen.getByRole('textbox',{name:'Industry — other'})
    fireEvent.change(other,{target:{value:'Boutique surf retreats'}})
    expect(onChange).toHaveBeenLastCalledWith('Boutique surf retreats')
    fireEvent.change(other,{target:{value:''}})
    expect(screen.getByRole('textbox',{name:'Industry — other'})).toBeInTheDocument()
  })

  it('shows an off-list seed in the select when it is a real option, not in the Other box',()=>{
    // industryOptions() prepends unrecognised stored values, so a legacy sector arrives as a genuine
    // option and reads as intact data rather than as something the consultant typed by hand.
    render(<Field label="Industry"><OptionSelect label="Industry" value="Boutique villas"
      options={[{value:'Boutique villas',label:'Boutique villas'},...options]}/></Field>)
    expect(screen.getByRole('combobox',{name:'Industry'})).toHaveValue('Boutique villas')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('opens the Other row for a seed no option matches',()=>{
    render(<Field label="Industry"><OptionSelect label="Industry" value="Yacht chartering" options={options}/></Field>)
    expect(screen.getByRole('textbox',{name:'Industry — other'})).toHaveValue('Yacht chartering')
  })

  describe('uncontrolled mode',()=>{
    const form=(ui:React.ReactNode)=>{const {container}=render(<form>{ui}</form>);return container.querySelector('form')!}

    it('carries the default value into FormData',()=>{
      const element=form(<Field label="Industry"><OptionSelect name="industry" label="Industry" defaultValue="hospitality" options={options}/></Field>)
      expect(new FormData(element).get('industry')).toBe('hospitality')
    })

    it('carries a changed selection into FormData',()=>{
      const element=form(<Field label="Industry"><OptionSelect name="industry" label="Industry" defaultValue="hospitality" options={options}/></Field>)
      fireEvent.change(screen.getByRole('combobox',{name:'Industry'}),{target:{value:'food_beverage'}})
      expect(new FormData(element).get('industry')).toBe('food_beverage')
    })

    it('carries Other free text into FormData under the same name',()=>{
      // The visible <select> is deliberately unnamed; two same-named controls would make get() a coin
      // flip between the chosen option and the typed text.
      const element=form(<Field label="Industry"><OptionSelect name="industry" label="Industry" options={options}/></Field>)
      fireEvent.change(screen.getByRole('combobox',{name:'Industry'}),{target:{value:'__other__'}})
      fireEvent.change(screen.getByRole('textbox',{name:'Industry — other'}),{target:{value:'Yacht chartering'}})
      expect(new FormData(element).getAll('industry')).toEqual(['Yacht chartering'])
    })
  })
})
