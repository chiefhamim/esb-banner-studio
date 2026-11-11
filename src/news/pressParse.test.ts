// News engine (shared, identical in both apps): official press lists, synthetic National Portal markup.
import { describe, expect, it } from 'vitest'
import { parseGovPressTable, resolveGovOfficeName } from './pressParse'

const PAGE = 'https://pmo.gov.bd/site/view/press_release'
const NAV = `
<header><a href="/site/page/abc">প্রধানমন্ত্রীর কার্যালয় সংক্রান্ত</a></header>
<nav><ul><li><a href="/site/page/services">সেবা ও কার্যক্রম</a></li><li><a href="/site/page/bio">প্রধানমন্ত্রীর জীবন বৃত্তান্ত</a></li></ul></nav>
<ul class="sidebar-menu"><li><a href="/site/page/officers">কর্মকর্তাবৃন্দের তালিকা</a></li>
<li><a href="https://giu.pmo.gov.bd/">গভর্ন্যান্স ইনোভেশন ইউনিট (জিআইইউ)</a></li><li><a href="https://ngoab.gov.bd/">এনজিও বিষয়ক ব্যুরো</a></li></ul>
<ul><li><a href="/site/page/contact">যোগাযোগ ও ঠিকানা সংক্রান্ত তথ্য</a></li></ul>
<footer><a href="/site/page/privacy">গোপনীয়তার নীতিমালা ও শর্তাবলি</a></footer>`

describe('parseGovPressTable', () => {
  it('reads the release table and nothing from the menus', () => {
    const html = `<html><body>${NAV}<table><thead><tr><th>ক্রম</th><th>শিরোনাম</th><th>তারিখ</th></tr></thead><tbody>
      <tr><td>১</td><td><a href="/site/press_release/1a2b-3c">প্রধানমন্ত্রীর সঙ্গে বিদ্যুৎ উপদেষ্টার সাক্ষাৎ</a></td><td>০৯-১১-২০২৬</td><td><a href="/files/x.pdf">ডাউনলোড</a></td></tr>
      <tr><td>২</td><td><a href="/site/press_release/4d5e">এলএনজি আমদানি নিয়ে সভা অনুষ্ঠিত</a></td><td>2026-11-03</td></tr>
      <tr><td>৩</td><td><a href="/site/press_release/9z">ডেস্ক অফিসার পদে নিয়োগ বিজ্ঞপ্তি প্রকাশ</a></td><td>2026-11-02</td></tr>
    </tbody></table></body></html>`
    const r = parseGovPressTable(html, PAGE)
    expect(r.map((x) => x.title)).toEqual(['প্রধানমন্ত্রীর সঙ্গে বিদ্যুৎ উপদেষ্টার সাক্ষাৎ', 'এলএনজি আমদানি নিয়ে সভা অনুষ্ঠিত'])
    expect(r[0].link).toBe('https://pmo.gov.bd/site/press_release/1a2b-3c')
    expect(r[0].published).toBe('2026-11-09T06:00:00.000Z')
  })
  it('gives nothing for a page that is only navigation', () => {
    expect(parseGovPressTable(`<html><body>${NAV}<div class="content">কোনো তথ্য পাওয়া যায়নি</div></body></html>`, PAGE)).toEqual([])
  })
  it('without a table, keeps release links only', () => {
    const html = `${NAV}<div class="list"><a href="/site/news/77aa">বিদ্যুৎ খাতের উন্নয়ন নিয়ে প্রধানমন্ত্রীর বৈঠক</a> <span>০৮ নভেম্বর ২০২৬</span></div>`
    const r = parseGovPressTable(html, PAGE)
    expect(r).toHaveLength(1)
    expect(r[0].published).toBe('2026-11-07T18:00:00.000Z')
  })
  it('drops an undated table row that does not link to a release', () => {
    const html = `<table><tr><td>১</td><td><a href="/site/page/about-office">প্রধানমন্ত্রীর কার্যালয় সংক্রান্ত তথ্য</a></td></tr></table>`
    expect(parseGovPressTable(html, PAGE)).toEqual([])
  })
})

describe('resolveGovOfficeName', () => {
  it('names known offices and refuses non-government hosts', () => {
    expect(resolveGovOfficeName('https://www.pmo.gov.bd/x', 'f')).toBe('PMO Press Wing')
    expect(resolveGovOfficeName('https://example.com/x', 'f')).toBeNull()
  })
})

describe('the new national portal', () => {
  it('reads the printed date, not the old cell left in a comment', () => {
    const page = `<table><tbody><tr class="table-tr">
      <td data-column="id">১</td>
      <!-- <td>a title kept in a comment</td> --> <!-- <td>11/3/2026</td> -->
      <td data-column="title">আগামী গ্রীষ্মের আগেই সৌরবিদ্যুৎ উৎপাদন সম্ভব</td>
      <td data-column="publish_date"><span>০৩-১১-২০২৬</span></td>
      <td><a href="/pages/news/some-release-6aeaad9798f72df36a8639a8">দেখুন</a></td>
    </tr></tbody></table>`
    const [row] = parseGovPressTable(page, 'https://powerdivision.gov.bd/pages/news/')
    expect(row.title).toBe('আগামী গ্রীষ্মের আগেই সৌরবিদ্যুৎ উৎপাদন সম্ভব')
    expect(row.published?.slice(0, 10)).toBe('2026-11-03')
  })
})
