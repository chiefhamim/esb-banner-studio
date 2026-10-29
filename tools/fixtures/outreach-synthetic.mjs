import fs from 'node:fs'
import path from 'node:path'

/**
 * Creates a synthetic CSV mailing list for outreach testing.
 * Uses only synthetic @*.example.com or @example.com addresses.
 *
 * Requirements:
 * - Columns: Serial, Person Name, Designation, Organization, Sector Group, Email, Phone, Purpose, Mail Server, Deliverability Status, Address
 * - 60 rows total
 * - 10 with no name
 * - 8 with no designation
 * - 6 info@ mailboxes
 * - 5 UNKNOWN status
 * - 3 DEAD_NO_DNS
 * - 2 EXCLUDED
 * - 4 REVIEW_REQUIRED
 * - 5 Bangla names
 * - 12 sharing 3 domains (4 each: alpha-power.example.com, beta-grid.example.com, gamma-energy.example.com)
 * - 1 duplicate email
 * - 1 multi-address cell
 */
export function writeSyntheticList(dir, n = 60) {
  const filePath = path.join(dir, 'synthetic-contacts.csv')
  const header = [
    'Serial',
    'Person Name',
    'Designation',
    'Organization',
    'Sector Group',
    'Email',
    'Phone',
    'Purpose',
    'Mail Server',
    'Deliverability Status',
    'Address',
  ]

  const sharedDomains = [
    'alpha-power.example.com',
    'beta-grid.example.com',
    'gamma-energy.example.com',
  ]

  const rows = [header]

  for (let i = 1; i <= n; i++) {
    let name = `Executive ${i}`
    let designation = `Director of Operations ${i}`
    let org = `Power Corp ${i}`
    let sector = `GROUP 1: POWER GENERATION`
    let email = `user${i}@co${i}.example.com`
    let phone = `+88017000000${String(i).padStart(2, '0')}`
    let purpose = 'MAGAZINE_DISTRIBUTION;SPONSORSHIP'
    let mx = `mail.co${i}.example.com`
    let status = 'SAFE_TO_SEND'
    let address = `Plot ${i}, Road ${i % 10 + 1}, Dhaka`

    // 5 Bangla names: 1..5
    if (i === 1) name = 'তানভীর আহমেদ'
    else if (i === 2) name = 'রাশেদুল হাসান'
    else if (i === 3) name = 'মাহমুদুল হক'
    else if (i === 4) name = 'ফারহানা ইসলাম'
    else if (i === 5) name = 'কাজী সাইদুর রহমান'

    // 10 with no name: 6..15
    if (i >= 6 && i <= 15) {
      name = ''
    }

    // 8 with no designation: 16..23
    if (i >= 16 && i <= 23) {
      designation = ''
    }

    // 6 info@ mailboxes: 24..29
    if (i >= 24 && i <= 29) {
      email = `info@corp${i}.example.com`
    }

    // 5 UNKNOWN status: 30..34
    if (i >= 30 && i <= 34) {
      status = 'UNKNOWN'
    }

    // 3 DEAD_NO_DNS: 35..37
    if (i >= 35 && i <= 37) {
      status = 'DEAD_NO_DNS'
    }

    // 2 EXCLUDED: 38..39
    if (i >= 38 && i <= 39) {
      status = 'EXCLUDED'
    }

    // 4 REVIEW_REQUIRED: 40..43
    if (i >= 40 && i <= 43) {
      status = 'REVIEW_REQUIRED'
    }

    // 12 sharing 3 domains: 44..55 (4 each)
    if (i >= 44 && i <= 55) {
      const dIdx = Math.floor((i - 44) / 4)
      const dom = sharedDomains[dIdx]
      email = `staff${i}@${dom}`
      mx = `mail.${dom}`
      org = `Shared Utility ${dIdx + 1}`
    }

    // 1 duplicate email: row 56 duplicates row 1's email
    if (i === 56) {
      email = `user1@co1.example.com`
      name = 'Duplicate Contact'
    }

    // 1 multi-address cell: row 57 has multiple addresses
    if (i === 57) {
      email = `primary57@co57.example.com, secondary57@co57.example.com`
    }

    rows.push([
      String(i),
      name,
      designation,
      org,
      sector,
      email,
      phone,
      purpose,
      mx,
      status,
      address,
    ])
  }

  const csvContent = rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? '')
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(',')
    )
    .join('\r\n') + '\r\n'

  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filePath, '\ufeff' + csvContent, 'utf8')
  return filePath
}

if (process.argv[1] && process.argv[1].endsWith('outreach-synthetic.mjs')) {
  const targetDir = process.argv[2] || path.join(process.cwd(), 'tools', 'fixtures')
  const p = writeSyntheticList(targetDir)
  console.log('Wrote synthetic outreach list to:', p)
}
