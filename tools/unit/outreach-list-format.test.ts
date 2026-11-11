// @vitest-environment node
import { describe, expect, it } from 'vitest'
import readExcelFile from 'read-excel-file/node'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LIST_COLUMNS, listTemplateBytes } from '../../src/outreach/listTemplate'
import { contactsFromRows } from '../../src/outreach/directory'

const require = createRequire(import.meta.url)
const { pickNext } = require('../../electron/outreach-schedule.cjs')
const { createSettingsManager } = require('../../electron/outreach-settings.cjs')

describe('the list format download', () => {
  it('is read back by the importer, and its instructions are never taken for contacts', async () => {
    const sheets = await readExcelFile(Buffer.from(listTemplateBytes()))
    expect(sheets.map((s: { sheet: string }) => s.sheet)).toEqual(['Contacts', 'Instructions'])
    const head = sheets[0].data[0].map(String)
    expect(head).toEqual(LIST_COLUMNS)
    const row = ['a@example.com', 'Salma Begum', 'Director', 'Org', 'Power Generation', 'MAGAZINE', '', 'SAFE_TO_SEND']
    const parsed = contactsFromRows([head, row])
    expect(parsed.contacts[0]).toMatchObject({ email: 'a@example.com', personName: 'Salma Begum', designation: 'Director', organization: 'Org', mxStatus: 'SAFE_TO_SEND' })
    expect(() => contactsFromRows(sheets[1].data.map((r: unknown[]) => r.map(String)))).toThrow(/No "Email"/)
  })
})

describe('sending to one organisation', () => {
  const stats = (n: number, last: number) => new Map([['pd.gov.bd', { countToday: n, lastSentAt: last, resetAt: 9e12 }]])
  const msgs = [{ to: 'a@pd.gov.bd' }, { to: 'b@pd.gov.bd' }]
  it('has no daily limit by default', () => {
    expect(pickNext(msgs, new Set(), 1e9, stats(40, 0), {})).toMatchObject({ index: 0 })
    expect(pickNext(msgs, new Set(), 1e9, stats(40, 0), { domainMaxPerDay: 0, domainMinGapSec: 180 })).toMatchObject({ index: 0 })
  })
  it('still spaces emails to one office, and still honours a limit the editor sets', () => {
    expect(pickNext(msgs, new Set(), 1e9, stats(1, 1e9 - 1000), { domainMaxPerDay: 0, domainMinGapSec: 180 })).toMatchObject({ waiting: 'domain', kind: 'spacing' })
    expect(pickNext(msgs, new Set(), 1e9, stats(3, 0), { domainMaxPerDay: 3, domainMinGapSec: 0 })).toMatchObject({ waiting: 'domain', kind: 'limit' })
  })
  it('moves on to another organisation while one has to wait', () => {
    const list = [{ to: 'a@pd.gov.bd' }, { to: 'c@bpdb.gov.bd' }]
    expect(pickNext(list, new Set(), 1e9, stats(1, 1e9 - 1000), { domainMaxPerDay: 0, domainMinGapSec: 180 })).toMatchObject({ index: 1, domain: 'bpdb.gov.bd' })
  })
})

describe('settings saved under the old 3-a-day rule', () => {
  const open = (saved: object) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-set-'))
    const filePath = path.join(dir, 'outreach-autopilot.json')
    fs.writeFileSync(filePath, JSON.stringify(saved))
    return { got: createSettingsManager({ dir }).get(), disk: JSON.parse(fs.readFileSync(filePath, 'utf8')) }
  }
  it('lift the limit once, and mark the change as the newest for other PCs', () => {
    const { got, disk } = open({ domainMaxPerDay: 3, domainMinGapSec: 1200, dailyLimit: 150, sharedUpdatedAt: 5 })
    expect(got).toMatchObject({ domainMaxPerDay: 0, domainMinGapSec: 180, dailyLimit: 150 })
    expect(disk.orgLimitLifted).toBe(true)
    expect(got.sharedUpdatedAt).toBeGreaterThan(5)
  })
  it('leave alone a limit the editor chose after the change, or chose differently before it', () => {
    expect(open({ domainMaxPerDay: 3, domainMinGapSec: 1200, orgLimitLifted: true }).got.domainMaxPerDay).toBe(3)
    expect(open({ domainMaxPerDay: 8, domainMinGapSec: 600 }).got).toMatchObject({ domainMaxPerDay: 8, domainMinGapSec: 600 })
  })
})
