import {describe,expect,it} from 'vitest'
import {normalizeWhatsAppPhone,whatsAppLink} from './whatsapp'

describe('normalizeWhatsAppPhone',()=>{
  it('rewrites a local leading 0 to the 62 country code',()=>{
    expect(normalizeWhatsAppPhone('0857-0833-1426')).toBe('6285708331426')
  })
  it('trusts a number already given with a plus as already having its country code',()=>{
    expect(normalizeWhatsAppPhone('+1 415 555 0100')).toBe('14155550100')
  })
  it('leaves a number already starting with a country code untouched',()=>{
    expect(normalizeWhatsAppPhone('62 857 0833 1426')).toBe('6285708331426')
  })
  it('returns null for blank input',()=>{
    expect(normalizeWhatsAppPhone('   ')).toBeNull()
  })
})

describe('whatsAppLink',()=>{
  it('builds a wa.me link with the message URL-encoded',()=>{
    expect(whatsAppLink('0812 3456 7890','Hi there! Are you free?')).toBe('https://wa.me/6281234567890?text=Hi%20there!%20Are%20you%20free%3F')
  })
  it('returns null when the phone cannot be normalized',()=>{
    expect(whatsAppLink('',"doesn't matter")).toBeNull()
  })
})
