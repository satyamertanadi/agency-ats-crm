import {describe,expect,it} from 'vitest'
import {URL_INPUT_PATTERN,externalUrl,isEnterableUrl} from './externalUrl'

describe('externalUrl',()=>{
  it('links a full https address',()=>{
    expect(externalUrl('https://acme.co.id/careers')).toMatchObject({valid:true,href:'https://acme.co.id/careers',text:'https://acme.co.id/careers'})
  })

  /* A scheme-less hostname is a URL a human wrote correctly. Supplying the scheme for the href while
   * displaying the stored text is a rendering decision, not an edit to the record. */
  it('links a bare hostname without changing what is displayed',()=>{
    const result=externalUrl('www.acme.co.id')
    expect(result).toMatchObject({valid:true,href:'https://www.acme.co.id/'})
    expect(result?.text).toBe('www.acme.co.id')
  })

  /* The values that actually arrive in an imported "website" column. Each of these used to render as
   * <a href="N/A">, which resolves to a path on the ATS itself. */
  it.each(['N/A','-','none','ask Budi','0812-3456-7890','tbc'])('refuses to link %j',(value)=>{
    expect(externalUrl(value)).toMatchObject({valid:false,href:null,text:value})
  })

  /* The one that is a security question rather than a tidiness question: an imported column is
   * attacker-influenced data, and an allow-list is what keeps the next exotic scheme from mattering. */
  const hostile=['javascript:alert(1)','data:text/html,<script>alert(1)</script>','vbscript:msgbox(1)','file:///etc/passwd']
  it.each(hostile)('never produces an href for %j',(value)=>{
    expect(externalUrl(value)).toMatchObject({valid:false,href:null})
  })

  it('preserves the original text even when it will not be linked',()=>{
    expect(externalUrl('  javascript:alert(1)  ')?.text).toBe('javascript:alert(1)')
  })

  it('treats blank as nothing to render at all, which is not the same as invalid',()=>{
    expect(externalUrl('   ')).toBeNull()
    expect(externalUrl(null)).toBeNull()
  })
})

describe('isEnterableUrl',()=>{
  /* Every one of these fields is optional, so an empty value must stay saveable -- refusing to save a
   * client because it has no website would be a worse failure than the one being prevented. */
  it('allows empty',()=>{
    expect(isEnterableUrl('')).toBe(true)
    expect(isEnterableUrl(undefined)).toBe(true)
  })

  it('rejects what would not be linkable',()=>{
    expect(isEnterableUrl('N/A')).toBe(false)
    expect(isEnterableUrl('javascript:alert(1)')).toBe(false)
    expect(isEnterableUrl('acme.co.id')).toBe(true)
  })
})

describe('URL_INPUT_PATTERN',()=>{
  /* The form attribute and the render-time function are two expressions of one rule (see the comment
   * on URL_INPUT_PATTERN). Nothing in the type system ties them together, so this does: anything the
   * form would accept must be something the detail page is willing to link, and vice versa. Without
   * it, the two drift and a value saves cleanly then renders with a correction flag. */
  const pattern=new RegExp(`^(?:${URL_INPUT_PATTERN})$`)
  it.each([
    'https://acme.co.id',
    'http://acme.co.id/careers?ref=1',
    'acme.co.id',
    'www.acme.co.id',
    'acme.co.id:8443/path',
  ])('accepts %j, which externalUrl also links',(value)=>{
    expect(pattern.test(value)).toBe(true)
    expect(externalUrl(value)?.valid).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'N/A',
    'ask Budi',
    'acme',
    'ftp://acme.co.id',
  ])('rejects %j, which externalUrl also refuses to link',(value)=>{
    expect(pattern.test(value)).toBe(false)
    expect(externalUrl(value)?.valid).toBe(false)
  })
})
