import {useRef,useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {searchLocations} from '../../features/core/commercialRepository'
import {useDebouncedValue} from '../lib/useDebouncedValue'
import {Combobox} from './Combobox'
import {Field} from './Field'

/* Google-Maps-style location search, dropped in wherever a "Location" field was a plain `<Input>`.
 * Built entirely from existing pieces -- Combobox for the picker, useDebouncedValue so typing doesn't
 * fire a request per keystroke -- with one new thing layered on: a Google "session token" that turns
 * a whole type-then-select sequence into one billed session instead of one request per keystroke.
 *
 * `allowFreeText` stays on (Combobox's default): if the search endpoint is unconfigured, rate-limited,
 * or Google simply has no opinion on what was typed, this behaves exactly like the plain text input it
 * replaced -- the value keeps typing and saving, there is just nothing in the dropdown. A location
 * field must never become unusable because a third-party search failed. */
export function LocationField({value,onChange,label='Location',id,bare=false}:{
  value:string
  onChange:(value:string)=>void
  label?:string
  id?:string
  /* Skips the internal <Field> label wrapper for hosts that already provide their own -- CandidateForm
   * and CandidateCvParser's review draft both wrap every field in a shared FormField/ReviewField that
   * renders the label, the same way they already use the label-less OptionSelect rather than Field. */
  bare?:boolean
}){
  const debounced=useDebouncedValue(value)
  /* null between searches (before the first keystroke, and again right after a selection) so the
   * next search mints a fresh token -- reusing one across unrelated searches would just mean Google
   * bills them as one much longer session instead of two normal ones. A ref, not state: it is read
   * inside the query function and written on selection, neither of which should re-render this
   * component on its own. */
  const sessionToken=useRef<string|null>(null)
  /* The value last committed by picking a suggestion. Without this, selecting "Jakarta, Indonesia"
   * would -- 300ms later, once the debounce catches up to the now-full value -- fire one more search
   * for the exact string that was just selected, for no reason. */
  const [lastCommitted,setLastCommitted]=useState('')

  const query=useQuery({
    queryKey:['location-search',debounced],
    enabled:debounced.trim().length>=2&&debounced!==lastCommitted,
    queryFn:()=>{
      if(!sessionToken.current)sessionToken.current=crypto.randomUUID()
      return searchLocations(debounced.trim(),sessionToken.current)
    },
  })
  const suggestions=(query.data?.suggestions??[]).map((suggestion)=>({id:suggestion.id,label:suggestion.label}))

  const handleChange=(next:string)=>{
    /* Combobox exposes one onChange for both "the user typed a character" and "the user picked a
     * suggestion" -- there is no separate callback for a commit. A value that exactly matches one of
     * the options just offered is, in practice, only ever reached by clicking it: the list holds full
     * formatted addresses ("Jakarta, Indonesia"), not the partial text a keystroke-by-keystroke typist
     * passes through on the way there. */
    if(suggestions.some((suggestion)=>suggestion.label===next)){
      setLastCommitted(next)
      sessionToken.current=null
    }else if(!next.trim()){
      sessionToken.current=null
    }else if(!sessionToken.current){
      sessionToken.current=crypto.randomUUID()
    }
    onChange(next)
  }

  const combobox=<Combobox id={id} label={label} value={value} onChange={handleChange}
    options={suggestions} loading={query.isFetching} placeholder="Start typing a city or address"/>
  return bare?combobox:<Field label={label}>{combobox}</Field>
}
