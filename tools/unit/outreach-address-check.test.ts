import { describe, expect, it } from 'vitest'
import { roleMailbox, disposableDomain, summarizeChecks } from '../../src/outreach/addressCheck'

describe('Step 4.2 addressCheck pure utilities', () => {
  it('correctly detects role mailboxes', () => {
    expect(roleMailbox('info@example.com')).toBe(true)
    expect(roleMailbox('admin@power.gov.bd')).toBe(true)
    expect(roleMailbox('contact@esbpowerline.com')).toBe(true)
    expect(roleMailbox('support@cloud.com')).toBe(true)
    expect(roleMailbox('office@grid.net')).toBe(true)
    expect(roleMailbox('hr@company.org')).toBe(true)
    expect(roleMailbox('sales@agency.com')).toBe(true)
    expect(roleMailbox('webmaster@site.com')).toBe(true)
    expect(roleMailbox('noreply@service.com')).toBe(true)
    expect(roleMailbox('no-reply@service.com')).toBe(true)
    expect(roleMailbox('postmaster@mx.net')).toBe(true)

    // Personal / leadership mailboxes are not role mailboxes
    expect(roleMailbox('kamal@example.com')).toBe(false)
    expect(roleMailbox('md@example.com')).toBe(false)
    expect(roleMailbox('chairman@grid.org')).toBe(false)
    expect(roleMailbox('')).toBe(false)
  })

  it('correctly detects disposable domains', () => {
    expect(disposableDomain('mailinator.com')).toBe(true)
    expect(disposableDomain('user@guerrillamail.com')).toBe(true)
    expect(disposableDomain('temp@10minutemail.com')).toBe(true)
    expect(disposableDomain('test@yopmail.com')).toBe(true)
    expect(disposableDomain('throwaway@trashmail.com')).toBe(true)
    expect(disposableDomain('test@getnada.com')).toBe(true)
    expect(disposableDomain('sharklasers.com')).toBe(true)

    // Valid enterprise domains are not disposable
    expect(disposableDomain('esbpowerline.com')).toBe(false)
    expect(disposableDomain('bpdb.gov.bd')).toBe(false)
    expect(disposableDomain('gmail.com')).toBe(false)
  })

  it('summarizes address check counts across a contact audience', () => {
    const emails = [
      'ceo@company1.com',
      'info@company1.com',
      'manager@dead-domain.com',
      'temp@mailinator.com',
    ]

    const domainResults = {
      'company1.com': { mx: true, a: false },
      'dead-domain.com': { mx: false, a: false },
      'mailinator.com': { mx: true, a: false },
    }

    const summary = summarizeChecks(emails, domainResults)
    expect(summary.total).toBe(4)
    expect(summary.hasMailServer).toBe(3) // ceo, info, temp
    expect(summary.noMailServer).toBe(1) // manager@dead-domain.com
    expect(summary.sharedMailboxes).toBe(1) // info@
    expect(summary.disposable).toBe(1) // mailinator.com
  })
})
