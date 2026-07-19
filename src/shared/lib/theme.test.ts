import {describe,expect,it} from 'vitest'
import {parsePreference,resolveTheme} from './theme'

describe('theme preference',()=>{
  it('resolves an explicit choice regardless of what the OS reports',()=>{
    expect(resolveTheme('dark',false)).toBe('dark')
    expect(resolveTheme('light',true)).toBe('light')
  })

  it('follows the OS only while set to system',()=>{
    expect(resolveTheme('system',true)).toBe('dark')
    expect(resolveTheme('system',false)).toBe('light')
  })

  /* Anything that is not a theme we ship falls back to following the OS. A stored value can outlive
   * the version that wrote it, and an unrecognised one must not leave the page with no theme at all. */
  it('treats an unknown or missing stored value as system',()=>{
    expect(parsePreference(null)).toBe('system')
    expect(parsePreference(undefined)).toBe('system')
    expect(parsePreference('')).toBe('system')
    expect(parsePreference('midnight')).toBe('system')
    expect(parsePreference('system')).toBe('system')
    expect(parsePreference(42)).toBe('system')
  })

  it('keeps the two themes it does ship',()=>{
    expect(parsePreference('dark')).toBe('dark')
    expect(parsePreference('light')).toBe('light')
  })
})
