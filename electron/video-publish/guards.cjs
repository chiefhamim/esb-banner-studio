// ESB Studio — Video publishing: the app's own rate guards, persisted so a restart does not reset them.
//
//   - YouTube: `videos.insert` draws on a Video Uploads bucket of 100 calls a day (verified 2026-11-01). The day
//     resets at midnight Pacific Time, as Google's quota does. The limit is a config value.
//   - Facebook: at most 30 API-published Reels per Page in any 24 hours (moving window).
'use strict'
const fs = require('node:fs')
const path = require('node:path')

function store(file) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} } }
  const write = (v) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(v))
    fs.renameSync(tmp, file)
  }
  return { read, write }
}

function dayKey(t, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t))
}

/** Calls per calendar day in `timeZone`. */
function createDailyQuota({ file, limit = 100, timeZone = 'America/Los_Angeles', clock = () => Date.now(), label = 'YouTube uploads' }) {
  const s = store(file)
  function used() {
    const v = s.read()
    return v.day === dayKey(clock(), timeZone) ? Number(v.count) || 0 : 0
  }
  function check() {
    const n = used()
    if (n >= limit) {
      const err = new Error(`${label}: the daily limit of ${limit} is used up. It resets at midnight Pacific Time.`)
      err.kind = 'quota'
      throw err
    }
    return { used: n, limit }
  }
  function record() {
    const day = dayKey(clock(), timeZone)
    const v = s.read()
    s.write({ day, count: (v.day === day ? Number(v.count) || 0 : 0) + 1 })
  }
  return { used, check, record, limit: () => limit }
}

/** At most `limit` events per key in any `windowMs`. */
function createMovingWindow({ file, limit = 30, windowMs = 24 * 3600 * 1000, clock = () => Date.now(), label = 'Facebook Reels' }) {
  const s = store(file)
  const recent = (all, key) => (Array.isArray(all[key]) ? all[key] : []).filter((t) => typeof t === 'number' && clock() - t < windowMs)
  function used(key) { return recent(s.read(), String(key)).length }
  function check(key) {
    const list = recent(s.read(), String(key))
    if (list.length >= limit) {
      const freeAt = Math.min(...list) + windowMs
      const err = new Error(`${label}: ${limit} have gone out on this Page in the last 24 hours, the most the app allows. The next can go at ${new Date(freeAt).toISOString()}.`)
      err.kind = 'quota'
      err.freeAt = freeAt
      throw err
    }
    return { used: list.length, limit }
  }
  function record(key) {
    const all = s.read()
    all[String(key)] = [...recent(all, String(key)), clock()]
    s.write(all)
  }
  return { used, check, record, limit: () => limit }
}

module.exports = { createDailyQuota, createMovingWindow, dayKey }
