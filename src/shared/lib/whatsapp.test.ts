import {describe,expect,it} from 'vitest'
import {DEFAULT_WHATSAPP_TEMPLATE,normalizeWhatsAppPhone,renderWhatsAppMessage,whatsAppLink} from './whatsapp'

describe('normalizeWhatsAppPhone',()=>{
  it('rewrites a local leading 0 to the 62 country code',()=>{
    expect(normalizeWhatsAppPhone('0857-0833-1426')).toBe('6285708331426')
  })
  /* 62 used to be a literal, so every non-Indonesian workspace built links to Indonesian numbers and
   * WhatsApp reported the contact did not exist -- which reads as a bad candidate number. */
  it('uses the workspace country code for a local number',()=>{
    expect(normalizeWhatsAppPhone('012-345-6789','60')).toBe('60123456789')
    expect(normalizeWhatsAppPhone('012-345-6789','+65')).toBe('65123456789')
  })
  it('falls back rather than building a dead number from a malformed code',()=>{
    expect(normalizeWhatsAppPhone('0857 0833 1426','abc')).toBe('6285708331426')
    expect(normalizeWhatsAppPhone('0857 0833 1426','123456')).toBe('6285708331426')
  })
  it('leaves a plus-prefixed number alone whatever the workspace code is',()=>{
    expect(normalizeWhatsAppPhone('+1 415 555 0100','60')).toBe('14155550100')
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

/* The opening line was an English sentence compiled into the candidate page, in a product whose
 * primary market writes to candidates in Indonesian. */
describe('renderWhatsAppMessage',()=>{
  const values={first_name:'Ayu',consultant:'Satya',agency:'Samara'}

  it('substitutes every placeholder',()=>{
    expect(renderWhatsAppMessage('Halo {first_name}, saya {consultant} dari {agency}.',values))
      .toBe('Halo Ayu, saya Satya dari Samara.')
  })
  it('falls back to the default when the workspace has not set one',()=>{
    for(const empty of [null,undefined,'   '])expect(renderWhatsAppMessage(empty,values)).toBe(renderWhatsAppMessage(DEFAULT_WHATSAPP_TEMPLATE,values))
  })
  /* Substituted, never evaluated: this string is a settings field an agency can write anything into,
   * including braces that are not placeholders. */
  it('leaves unknown braces exactly as written',()=>{
    expect(renderWhatsAppMessage('Hi {first_name} {unknown} {{first_name}}',values)).toBe('Hi Ayu {unknown} {Ayu}')
  })
  it('repeats a placeholder used more than once',()=>{
    expect(renderWhatsAppMessage('{first_name}? Hi {first_name}.',values)).toBe('Ayu? Hi Ayu.')
  })
})
