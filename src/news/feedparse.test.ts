// News engine (shared, identical in both apps): feed parsing details.
import { describe, expect, it } from 'vitest'
import { parseFeed, stripTitleSuffix } from './feedparse'

describe('stripTitleSuffix', () => {
  it.each([
    ['গ্যাস সংকটে বন্ধ সার কারখানা | jagonews24.com', 'গ্যাস সংকটে বন্ধ সার কারখানা'],
    ['এলএনজি আমদানি বাড়ছে - bonikbarta.com.bd', 'এলএনজি আমদানি বাড়ছে'],
    ['Power tariff hike on cards — samakal.com', 'Power tariff hike on cards'],
    ['লোডশেডিং বাড়ছে | ঢাকাপোস্ট.কম', 'লোডশেডিং বাড়ছে'],
    ['Solar park adds 3.5 GW - 3.5 GW', 'Solar park adds 3.5 GW - 3.5 GW'],
    ['ঢাকা-চট্টগ্রাম গ্যাস পাইপলাইনের কাজ শুরু', 'ঢাকা-চট্টগ্রাম গ্যাস পাইপলাইনের কাজ শুরু'],
  ])('%s', (raw, want) => expect(stripTitleSuffix(raw)).toBe(want))
})

describe('parseFeed', () => {
  it('reads a BST pubDate as Dhaka time and strips the site name', () => {
    const xml = '<rss><channel><item><title>বিদ্যুৎ উৎপাদন বাড়ছে — dhakapost.com</title><link>https://p.example/1</link><pubDate>Mon, 09 Nov 2026 10:00:00 BST</pubDate></item></channel></rss>'
    const [e] = parseFeed(xml)
    expect(e.title).toBe('বিদ্যুৎ উৎপাদন বাড়ছে')
    expect(e.date).toBe('Mon, 09 Nov 2026 10:00:00 BST')
  })
})
