// src/outreach/rendered.ts
// Per-message deterministic checks on rendered emails to catch visual bugs and data defects.

import type { Contact } from './types'
import { roleMailbox } from './addressCheck'

export type FlagKind =
  | 'empty_fragment'
  | 'odd_name'
  | 'generic_mailbox_with_name'
  | 'long_subject'
  | 'fallback_used'
  | 'no_name'

export interface Flag {
  kind: FlagKind
  title: string
  detail: string
  sample?: string
}

const ODD_NAME_WORDS = new Set(['info', 'admin', 'office', 'contact', 'support'])

export function reviewRendered(
  contact: Contact,
  message: { subject: string; body: string },
): Flag[] {
  const flags: Flag[] = []
  const name = (contact.personName || '').trim()
  const org = (contact.organization || '').trim()

  // 1. empty_fragment: check for punctuation defects or leftover doubled spaces
  const lines = message.body.split('\n')
  let emptyFragmentFound: string | null = null

  for (const line of lines) {
    if (/,\s*,/.test(line)) {
      emptyFragmentFound = line.slice(0, 80)
      break
    }
    if (/\s+at\s+\./.test(line)) {
      emptyFragmentFound = line.slice(0, 80)
      break
    }
    if (/\bof\s*,/.test(line)) {
      emptyFragmentFound = line.slice(0, 80)
      break
    }
    if (/\s{2,}/.test(line)) {
      emptyFragmentFound = line.slice(0, 80)
      break
    }
    if (/^\s*[,.:;!?-]+\s*$/.test(line) && line.trim().length > 0) {
      emptyFragmentFound = line.slice(0, 80)
      break
    }
  }

  if (emptyFragmentFound) {
    flags.push({
      kind: 'empty_fragment',
      title: 'Empty fragment or punctuation artifact',
      detail: 'The letter contains broken spacing or dangling punctuation left by an empty field.',
      sample: emptyFragmentFound.trim(),
    })
  }

  // 2. odd_name: name contains @, digits, equals organization, or is a role word
  if (name) {
    const lowerName = name.toLowerCase()
    let isOdd = false
    let reason = ''

    if (name.includes('@')) {
      isOdd = true
      reason = 'Name contains an @ symbol'
    } else if (/\d/.test(name)) {
      isOdd = true
      reason = 'Name contains digits'
    } else if (org && lowerName === org.toLowerCase()) {
      isOdd = true
      reason = 'Name equals the organisation name'
    } else if (ODD_NAME_WORDS.has(lowerName)) {
      isOdd = true
      reason = `Name is a role mailbox term (“${name}”)`
    }

    if (isOdd) {
      flags.push({
        kind: 'odd_name',
        title: 'Odd contact name',
        detail: `${reason} (“${name}”).`,
        sample: name,
      })
    }
  }

  // 3. generic_mailbox_with_name: role mailbox but a personal name is filled
  if (roleMailbox(contact.email) && name) {
    flags.push({
      kind: 'generic_mailbox_with_name',
      title: 'Personal name sent to shared mailbox',
      detail: `Addressed to ${name} but sending to shared role mailbox <${contact.email}>.`,
      sample: `${name} <${contact.email}>`,
    })
  }

  // 4. long_subject: > 78 characters after filling
  if (message.subject.length > 78) {
    flags.push({
      kind: 'long_subject',
      title: 'Long subject line',
      detail: `Subject is ${message.subject.length} characters (exceeds 78 character limit).`,
      sample: message.subject,
    })
  }

  // Informational flags (never sent to Needs you queue)
  if (!name) {
    flags.push({
      kind: 'no_name',
      title: 'No person name',
      detail: 'Greets as Sir/Madam.',
    })
  }

  return flags
}

/** Returns only actionable flags that must be reviewed before sending. */
export function actionableFlags(flags: Flag[]): Flag[] {
  return flags.filter((f) => f.kind !== 'fallback_used' && f.kind !== 'no_name')
}
