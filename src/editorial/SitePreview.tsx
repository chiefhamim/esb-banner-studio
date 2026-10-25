// "Web Article" preview for the Editorial Desk: the esbpowerline.com article page, rendered in an
// iframe with the site's own stylesheet (src/editorial/site-preview.css, generated from the site
// repo by tools/site-css.mjs) and markup ported from app/(public)/articles/[slug]/page.tsx plus the
// draft-specific bits of the site's CMS preview (components/editor/ArticlePreviewPanel.tsx).
// Live-only parts of the page (market ticker, comments, the real ad creative, "data behind this
// story") are left out rather than faked; the CMS preview's dashed ad-slot marker is kept.
import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import siteCss from './site-preview.css?raw'
import bannerWhite from '../assets/images/site/banner.jpg'
import bannerDark from '../assets/images/site/banner_dark.jpg'
import bannerMidnight from '../assets/images/site/banner_midnight.jpg'
import siteLogo from '../assets/images/site/site-logo.png'
import inter400 from '../assets/fonts/ui-inter-400.woff2?url'
import inter500 from '../assets/fonts/ui-inter-500.woff2?url'
import inter600 from '../assets/fonts/ui-inter-600.woff2?url'
import inter700 from '../assets/fonts/ui-inter-700.woff2?url'
import inter800 from '../assets/fonts/Inter-800.woff2?url'
import grotesk500 from '@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff2?url'
import grotesk600 from '@fontsource/space-grotesk/files/space-grotesk-latin-600-normal.woff2?url'
import grotesk700 from '@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2?url'
import serif600 from '@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2?url'
import serif700 from '@fontsource/source-serif-4/files/source-serif-4-latin-700-normal.woff2?url'
import bengali600 from '../assets/fonts/bengali-600.woff2?url'
import bengali700 from '../assets/fonts/bengali-700.woff2?url'
import { CATEGORIES } from '../core/tokens'

export type SiteTheme = 'midnight' | 'dark' | 'white'
export type SiteDevice = 'desktop' | 'tablet' | 'mobile'
export const SITE_THEMES: { id: SiteTheme; label: string }[] = [
  { id: 'midnight', label: 'Midnight' },
  { id: 'dark', label: 'Dark' },
  { id: 'white', label: 'White' },
]
export const DEVICE_WIDTHS: Record<SiteDevice, number> = { desktop: 1280, tablet: 768, mobile: 390 }

export interface RelatedStory {
  slug: string
  title: string
  excerpt?: string
  category: string
  imageUrl?: string
  date?: string
}

export interface SitePreviewProps {
  theme: SiteTheme
  device: SiteDevice
  availableWidth: number
  title: string
  excerpt: string
  slug: string
  category: string
  author: string
  date: Date
  readTime: number
  heroUrl: string | null
  heroCredit: string
  paragraphs: string[]
  /** The story's formatted HTML (already sanitised); when present it is shown instead of `paragraphs`. */
  bodyHtml?: string | null
  tags: string[]
  related: RelatedStory[]
}

// ---------------------------------------------------------------- helpers mirroring lib/utils.ts
const ARTICLE_TZ = 'Asia/Dhaka'
export function formatArticleDate(date: Date): string {
  const d = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: ARTICLE_TZ })
  const t = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: ARTICLE_TZ })
  return `Published on ${d} at ${t}`
}
export const slugify = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** lib/article-ad-split.ts: with >= 3 top-level blocks the automatic slot sits after floor(n/2) of them. */
export function adSplitIndex(count: number): number | null {
  if (count < 3) return null
  return Math.floor(count / 2)
}

// ---------------------------------------------------------------- lucide glyphs used by the page
const GLYPHS: Record<string, ReactNode> = {
  home: <><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  newspaper: <><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" /><path d="M18 14h-8" /><path d="M15 18h-5" /><path d="M10 6h8v4h-8V6Z" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>,
  book: <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></>,
  menu: <><line x1="4" x2="20" y1="12" y2="12" /><line x1="4" x2="20" y1="6" y2="6" /><line x1="4" x2="20" y1="18" y2="18" /></>,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" x2="15.42" y1="13.51" y2="17.49" /><line x1="15.41" x2="8.59" y1="6.51" y2="10.49" /></>,
  bookmark: <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />,
  type: <><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" x2="15" y1="20" y2="20" /><line x1="12" x2="12" y1="4" y2="20" /></>,
  minus: <path d="M5 12h14" />,
  plus: <><path d="M5 12h14" /><path d="M12 5v14" /></>,
  imageOff: <><line x1="2" x2="22" y1="2" y2="22" /><path d="M10.41 10.41a2 2 0 1 1-2.83-2.83" /><line x1="13.5" x2="6" y1="13.5" y2="21" /><line x1="18" x2="21" y1="12" y2="15" /><path d="M3.59 3.59A1.99 1.99 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.052-.22 1.41-.59" /><path d="M21 15V5a2 2 0 0 0-2-2H9" /></>,
  user: <><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></>,
  mail: <><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>,
  pin: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>,
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
  chevronUp: <path d="m18 15-6-6-6 6" />,
  arrowUpRight: <><path d="M7 7h10v10" /><path d="M7 17 17 7" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></>,
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  moonStar: <><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /><path d="M19 3v4" /><path d="M21 5h-4" /></>,
  facebook: <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />,
  youtube: <><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" /><path d="m10 15 5-3-5-3z" /></>,
}
function Glyph({ name, className, strokeWidth = 2 }: { name: keyof typeof GLYPHS; className?: string; strokeWidth?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {GLYPHS[name]}
    </svg>
  )
}

// ---------------------------------------------------------------- iframe host (as the site's CMS preview does)
const fontCss = `
@font-face{font-family:'ESB Sans';font-weight:400;src:url(${inter400}) format('woff2')}
@font-face{font-family:'ESB Sans';font-weight:500;src:url(${inter500}) format('woff2')}
@font-face{font-family:'ESB Sans';font-weight:600;src:url(${inter600}) format('woff2')}
@font-face{font-family:'ESB Sans';font-weight:700;src:url(${inter700}) format('woff2')}
@font-face{font-family:'ESB Sans';font-weight:800;src:url(${inter800}) format('woff2')}
@font-face{font-family:'Space Grotesk';font-weight:500;src:url(${grotesk500}) format('woff2')}
@font-face{font-family:'Space Grotesk';font-weight:600;src:url(${grotesk600}) format('woff2')}
@font-face{font-family:'Space Grotesk';font-weight:700;src:url(${grotesk700}) format('woff2')}
@font-face{font-family:'Source Serif 4';font-weight:600;src:url(${serif600}) format('woff2')}
@font-face{font-family:'Source Serif 4';font-weight:700;src:url(${serif700}) format('woff2')}
@font-face{font-family:'Hind Siliguri';font-weight:600;src:url(${bengali600}) format('woff2')}
@font-face{font-family:'Hind Siliguri';font-weight:700;src:url(${bengali700}) format('woff2')}
:root{--font-sans:'ESB Sans';--font-display:'Space Grotesk';--font-mono:'Cascadia Mono',Consolas,monospace;--font-bengali:'Hind Siliguri';--font-masthead:'Source Serif 4'}
html,body{margin:0}
a{cursor:default}
`

function SiteFrame({ theme, width, scale, children, onHeight }: { theme: SiteTheme; width: number; scale: number; children: ReactNode; onHeight: (h: number) => void }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [mount, setMount] = useState<HTMLElement | null>(null)
  const [height, setHeight] = useState(900)

  // Build the document synchronously (no srcdoc/load race): an about:blank frame is writable at mount.
  useEffect(() => {
    const frame = ref.current
    const doc = frame?.contentDocument
    if (!doc) return
    if (!doc.getElementById('esb-site-css')) {
      doc.open()
      doc.write("<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head><body></body></html>")
      doc.close()
      const style = doc.createElement('style')
      style.id = 'esb-site-css'
      style.textContent = fontCss + siteCss
      doc.head.appendChild(style)
      doc.body.className = 'min-h-screen bg-background text-foreground antialiased font-sans'
    }
    setMount(doc.body)
  }, [])

  useEffect(() => {
    const html = mount?.ownerDocument.documentElement
    if (!html) return
    html.className = `theme-${theme} ${theme === 'white' ? 'light' : 'dark'}`
    html.dataset.siteTheme = theme
  }, [theme, mount])

  useEffect(() => {
    if (!mount) return
    const win = mount.ownerDocument.defaultView
    if (!win || typeof win.ResizeObserver === 'undefined') return
    const ro = new win.ResizeObserver(() => {
      const h = Math.ceil(mount.scrollHeight)
      setHeight(h)
      onHeight(h)
    })
    ro.observe(mount)
    return () => ro.disconnect()
  }, [mount, onHeight])

  return (
    <iframe
      ref={ref}
      title="esbpowerline.com article preview"
      style={{ width, height, border: 0, display: 'block', transform: `scale(${scale})`, transformOrigin: 'top left', background: 'transparent', pointerEvents: 'none' }}
    >
      {mount && createPortal(children, mount)}
    </iframe>
  )
}

// ---------------------------------------------------------------- the page
const NAV_CATEGORIES = CATEGORIES.map((c) => ({ name: c.name, slug: slugify(c.name), color: c.accent }))
const EXPLORE_LINKS = ['Latest News', 'All Categories', 'Monthly Magazine', 'Grid Explorer', 'Energy Policy', 'LPG Price', 'Grid Archive since 2013', 'Event Studies', 'Titas Gas Record', 'Search']

function SitePage(p: SitePreviewProps) {
  const banner = p.theme === 'midnight' ? bannerMidnight : p.theme === 'dark' ? bannerDark : bannerWhite
  const cat = NAV_CATEGORIES.find((c) => c.name === p.category) ?? NAV_CATEGORIES[0]
  const initials = (p.author || 'ESB PowerLine').substring(0, 2)
  // formatted stories split into their top-level blocks, as the site does for the ad slot
  const blocks = p.bodyHtml ? Array.from(new DOMParser().parseFromString(`<body>${p.bodyHtml}</body>`, 'text/html').body.children).map((e) => e.outerHTML) : null
  const items = blocks ?? p.paragraphs
  const split = adSplitIndex(items.length)
  const first = split === null ? items : items.slice(0, split)
  const second = split === null ? [] : items.slice(split)
  const item = (t: string, k: string) => (blocks ? <div key={k} className="article-block" dangerouslySetInnerHTML={{ __html: t }} /> : <p key={k}>{t}</p>)
  const year = p.date.getFullYear()

  return (
    <>
      {/* ---- header: masthead banner + primary nav (components/shared/PublicNavbar.tsx) ---- */}
      <header className="public-site-header">
        <div className="container container--shell">
          <a href="#" className="block" aria-label="ESB PowerLine — home">
            <img src={banner} alt="ESB PowerLine — Safe Energy Safe Nation" className="site-banner__image block mx-auto" style={{ width: '100%', height: 'auto' }} />
          </a>
        </div>
        <nav className="public-nav-bar" aria-label="Primary">
          <div className="container container--shell public-nav-bar__inner">
            <div className="public-nav-bar__hub-band">
              <div className="public-nav-bar__main">
                <div className="public-nav-bar__start">
                  <div className="public-nav-bar__pill-cluster public-nav-bar__start-cluster">
                    <div className="public-nav-bar__utilities">
                      <a href="#" className="public-nav-bar__pill-btn public-nav-bar__pill-btn--paired public-nav-bar__home" aria-label="Home">
                        <Glyph name="home" className="icon-sm" />
                        <span className="public-nav-bar__pill-label">Home</span>
                      </a>
                      <span className="public-nav-bar__pill-divider hidden sm:block" aria-hidden />
                      <div className="locale-toggle-wrapper public-nav-bar__locale">
                        <div className="locale-toggle">
                          <div className="locale-toggle__swatches">
                            <div className="locale-toggle__item relative"><button type="button" className="locale-toggle__btn locale-toggle__btn--active" aria-pressed="true" aria-label="English"><span className="locale-toggle__label locale-toggle__label--en">EN</span></button></div>
                            <div className="locale-toggle__item relative"><button type="button" className="locale-toggle__btn" aria-pressed="false" aria-label="বাংলা"><span className="locale-toggle__label locale-toggle__label--bn">বাং</span></button></div>
                          </div>
                        </div>
                      </div>
                      <span className="public-nav-bar__pill-divider" aria-hidden />
                      <a href="#" className="public-nav-bar__pill-btn public-nav-bar__pill-btn--paired public-nav-bar__search-pill public-nav-bar__utility-btn" aria-label="Search">
                        <Glyph name="search" className="icon-sm opacity-85" />
                        <span className="public-nav-bar__pill-label public-nav-bar__pill-label--search">Search</span>
                      </a>
                    </div>
                  </div>
                </div>
                <div className="public-nav-bar__center flex">
                  <div className="public-nav-bar__hub" role="group" aria-label="Primary sections">
                    <a href="#" className="public-nav-bar__hub-link public-nav-bar__hub-link--latest public-nav-bar__hub-link--active" aria-label="Articles">
                      <Glyph name="newspaper" className="h-3.5 w-3.5 shrink-0 opacity-90" />
                      <span className="hidden lg:inline">Latest</span>
                    </a>
                    <a href="#" className="public-nav-bar__hub-link public-nav-bar__hub-link--grid" aria-label="Grid Explorer">
                      <Glyph name="chart" className="h-3.5 w-3.5 shrink-0 opacity-90" />
                      <span className="hidden lg:inline">Grid Explorer</span>
                    </a>
                    <a href="#" className="public-nav-bar__hub-link public-nav-bar__hub-link--magazine" aria-label="Magazine">
                      <Glyph name="book" className="h-3.5 w-3.5 shrink-0 opacity-90" />
                      <span className="hidden lg:inline">Magazine</span>
                    </a>
                  </div>
                </div>
                <div className="public-nav-bar__end">
                  <div className="public-nav-bar__pill-cluster public-nav-bar__utility-cluster">
                    <div className="public-nav-bar__utilities">
                      <div className="site-theme-toggle-wrapper public-nav-bar__themes">
                        <div className="site-theme-toggle">
                          <div className="site-theme-toggle__swatches">
                            {([['midnight', 'moonStar'], ['dark', 'moon'], ['white', 'sun']] as const).map(([id, glyph]) => (
                              <div key={id} className="site-theme-toggle__item relative">
                                <button type="button" className="site-theme-toggle__btn" aria-label={`Switch to ${id} theme`} aria-pressed={p.theme === id}>
                                  <Glyph name={glyph} className={`icon-sm transition-colors ${p.theme === id ? 'text-primary' : 'text-muted-foreground'}`} strokeWidth={p.theme === id ? 2.5 : 2} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    <button type="button" className="public-nav-bar__menu-btn lg:hidden tap-safe" aria-label="Toggle menu"><Glyph name="menu" className="icon-md" /></button>
                  </div>
                </div>
              </div>
            </div>
            <div className="public-nav-bar__categories-shell public-nav-bar__categories hidden lg:block">
              <div className="category-nav-ribbon category-nav-ribbon--desktop grid divide-x divide-border/40" style={{ gridTemplateColumns: `repeat(${NAV_CATEGORIES.length}, minmax(0, 1fr))` }}>
                {NAV_CATEGORIES.map((c) => {
                  const active = c.name === cat.name
                  return (
                    <a key={c.slug} href="#" style={{ '--cat-color': c.color } as React.CSSProperties} className={`category-nav-cell group relative transition-all duration-200 select-none w-full overflow-hidden font-medium category-nav-cell--custom${active ? ' category-nav-cell--active' : ''} text-foreground`}>
                      <span className={`absolute top-0 left-0 z-[2] h-[2px] w-full transition-transform duration-200 origin-left ${active ? 'scale-x-100' : 'scale-x-0'} category-nav-underline--custom`} style={{ backgroundColor: c.color }} aria-hidden />
                      <span className="category-nav-cell__stack"><span className="category-nav-label relative z-[1] font-sans">{c.name}</span></span>
                    </a>
                  )
                })}
              </div>
            </div>
          </div>
        </nav>
      </header>

      {/* ---- article (app/(public)/articles/[slug]/page.tsx) ---- */}
      <main>
        <div className="article-page-root container py-10 max-w-3xl article-page--with-sticky-author fluid-article-container">
          <nav aria-label="Breadcrumb" className="breadcrumbs mb-4 text-xs text-muted-foreground">
            <ol className="flex flex-wrap items-center gap-1.5">
              {[['Home', false], ['News', false], [p.category, false], [p.title.slice(0, 110), true]].map(([name, last], i) => (
                <li key={i} className="inline-flex items-center gap-1.5 min-w-0">
                  {last ? <span aria-current="page" className="truncate max-w-[16rem] text-foreground/80">{name}</span> : <a href="#" className="hover:text-primary transition-colors">{name}</a>}
                  {!last && <span aria-hidden className="text-muted-foreground/50">/</span>}
                </li>
              ))}
            </ol>
          </nav>
          <a href="#" className="text-sm text-primary hover:underline">← Back to news</a>

          <header className="article-header">
            <div className="article-category-wrap flex items-center gap-2">
              <a href="#" className="text-sm font-bold uppercase tracking-widest text-primary hover:underline">{p.category}</a>
            </div>
            <h1 className="font-display font-extrabold tracking-tight leading-[1.05] text-foreground">{p.title || 'Headline'}</h1>
            {p.excerpt && <p className="text-muted-foreground leading-snug font-light article-excerpt">{p.excerpt}</p>}
            <div className="article-meta-row">
              <div className="article-meta-left-group">
                <a href="#" className="article-meta-avatar rounded-full bg-muted flex items-center justify-center font-bold text-muted-foreground uppercase shadow-sm shrink-0">{initials}</a>
                <div className="article-meta-text flex flex-col min-w-0">
                  <div className="article-meta-author"><a href="#" className="hover:text-primary transition-colors">{p.author || 'ESB PowerLine'}</a></div>
                  <div className="article-meta-subline">
                    <div className="article-meta-date-wrapper"><span className="article-meta-date article-meta-details">{formatArticleDate(p.date)}</span></div>
                    <span className="article-meta-separator article-meta-mobile-hide">•</span>
                    <div className="article-meta-stats-wrapper">
                      <span className="article-meta-read-time article-meta-details">{p.readTime} min read</span>
                      <span className="article-meta-separator">•</span>
                      <span className="article-meta-views-count article-meta-details">0 views</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="article-meta-actions flex items-center gap-2">
                <button type="button" className="btn h-9 px-4 gap-2 rounded-full border-transparent bg-primary/10 text-primary inline-flex items-center text-sm"><Glyph name="share" className="h-4 w-4" /><span className="hidden sm:inline text-xs font-semibold">Share</span></button>
                <button type="button" disabled className="btn btn-secondary inline-flex items-center gap-2 text-sm opacity-60 cursor-not-allowed"><Glyph name="bookmark" className="h-4 w-4" /><span className="article-save-btn-text">Save article</span></button>
              </div>
            </div>
          </header>

          <figure>
            <div className="image-container-with-credit rounded-xl w-full aspect-video border border-border overflow-hidden bg-muted/40 flex items-center justify-center relative">
              {p.heroUrl ? (
                <>
                  <img src={p.heroUrl} alt={p.title} className="absolute inset-0 h-full w-full" style={{ objectFit: 'cover', objectPosition: '50% 50%' }} />
                  {p.heroCredit && <span className="image-credit-overlay">Photo: {p.heroCredit}</span>}
                </>
              ) : (
                <div className="absolute inset-0 h-full w-full flex items-center justify-center gap-2 text-xs uppercase tracking-wider text-muted-foreground bg-muted/40"><Glyph name="imageOff" className="h-5 w-5 opacity-60" /><span className="font-medium tracking-wide">No image</span></div>
              )}
            </div>
          </figure>

          <div className="article-reading-tools">
            <div className="article-text-size" role="group" aria-label="Text size">
              <Glyph name="type" className="article-text-size__icon h-3.5 w-3.5" />
              <button type="button" className="article-text-size__btn" aria-label="Decrease text size"><Glyph name="minus" className="h-3.5 w-3.5" /></button>
              <span className="article-text-size__level">A</span>
              <button type="button" className="article-text-size__btn" aria-label="Increase text size"><Glyph name="plus" className="h-3.5 w-3.5" /></button>
            </div>
          </div>

          <div className="article-body mt-8 text-lg md:text-xl leading-relaxed pb-safe">
            {first.map((t, i) => item(t, String(i)))}
            {second.length > 0 && (
              <>
                <div className="article-body-ad-block my-10 flex h-[140px] items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/20" aria-hidden>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">In-article advertisement · automatic midpoint</span>
                </div>
                {second.map((t, i) => item(t, `b${i}`))}
              </>
            )}
            {items.length === 0 && <p className="text-muted-foreground">The story body appears here as it will read on esbpowerline.com.</p>}
          </div>

          {p.tags.length > 0 && (
            <div className="mt-10 pt-6 border-t border-border/30">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 block mb-3">Trending Keywords</span>
              <div className="flex flex-wrap gap-2">{p.tags.map((t) => <span key={t} className="tag">#{t}</span>)}</div>
            </div>
          )}

          {p.related.length > 0 && (
            <div className="mt-10">
              <div className="flex items-baseline justify-between gap-3 mb-4">
                <h2 className="font-semibold text-lg">Related stories</h2>
                <a href="#" className="text-sm text-primary hover:underline">More in {p.category} →</a>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {p.related.map((r) => (
                  <a key={r.slug} href="#" className="article-card group">
                    <div className="article-card__image-wrapper relative">
                      {r.imageUrl ? <img src={r.imageUrl} alt={r.title} width={500} height={192} className="article-card__image" style={{ objectFit: 'cover' }} /> : <div className="article-card__image h-48 w-full flex items-center justify-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40"><Glyph name="imageOff" className="h-3.5 w-3.5 opacity-60" /><span className="font-medium tracking-wide">No image</span></div>}
                      <div className="absolute top-2.5 left-2.5 flex flex-wrap items-center gap-1"><span className="category-pill">{r.category}</span></div>
                    </div>
                    <div className="p-5 flex-1 flex flex-col justify-between">
                      <div>
                        <h3 className="font-semibold tracking-[-0.015em] leading-tight group-hover:text-primary transition-colors">{r.title}</h3>
                        {r.excerpt && <p className="mt-2.5 text-[13px] text-muted-foreground line-clamp-3 leading-snug">{r.excerpt}</p>}
                      </div>
                      <div className="mt-4 flex items-center justify-between text-ui-xs text-muted-foreground pt-1">
                        {r.date && <span>{formatArticleDate(new Date(r.date)).replace('Published on ', '')}</span>}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ---- footer (components/shared/PublicFooter.tsx) ---- */}
      <footer className="border-t border-border/60 bg-card/30">
        <div className="container container--shell py-10 md:py-12">
          <div className="flex flex-col items-start gap-4 border-b border-border/40 pb-8 sm:flex-row sm:items-center sm:gap-6">
            <span className="brand-logo inline-block public-footer-logo"><span className="brand-logo__frame shrink-0 rounded-md border-0 bg-transparent px-0 py-0 shadow-none"><img src={siteLogo} alt="ESB PowerLine — Energy Solution of Bangladesh" className="brand-logo__img h-11 w-auto max-w-[240px]" /></span></span>
            <div className="brand-deck min-w-0 flex-1">
              <p className="brand-deck__kicker">News portal &amp; magazine</p>
              <p className="brand-deck__lede">{FOOTER.lede}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-10 pt-8 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-12 lg:gap-x-8 lg:gap-y-0">
            <section className="md:col-span-2 lg:col-span-4">
              <FooterHeading>Editorial &amp; Office</FooterHeading>
              <div className="space-y-4">
                <ContactItem glyph="user" label="Editor & Publisher"><p className="font-display font-semibold tracking-tight text-foreground">Farid Uddin Ahmed</p></ContactItem>
                <ContactItem glyph="mail" label="E-mail"><a href="#" className="block break-words">esbplbd@gmail.com</a></ContactItem>
                <ContactItem glyph="pin" label="Office Address"><p className="font-medium text-foreground">ESB Power Line</p><p className="text-foreground/70">House #36/1, Avenue #01, Block-A, Section-10, Mirpur, Pallabi, Dhaka-1216, Bangladesh.</p></ContactItem>
                <ContactItem glyph="phone" label="Advertising Department"><a href="#" className="block">+8801711-378733</a></ContactItem>
                <ContactItem glyph="share" label="Official channels">
                  <div className="official-social official-social--footer">
                    <a href="#" className="official-social__link"><Glyph name="facebook" className="official-social__icon" /><span>Facebook</span></a>
                    <a href="#" className="official-social__link"><Glyph name="youtube" className="official-social__icon" /><span>YouTube</span></a>
                  </div>
                </ContactItem>
              </div>
            </section>
            <section className="md:col-span-1 lg:col-span-2">
              <FooterHeading>Explore</FooterHeading>
              <ul className="space-y-2.5">{EXPLORE_LINKS.map((l) => <li key={l}><a href="#" className="text-sm font-medium text-foreground/85">{l}</a></li>)}</ul>
            </section>
            <section className="md:col-span-1 lg:col-span-2">
              <FooterHeading>Sectors</FooterHeading>
              <ul className="space-y-2.5">{NAV_CATEGORIES.slice(0, 5).map((c) => <li key={c.slug}><a href="#" className="text-sm font-medium text-foreground/85">{c.name}</a></li>)}</ul>
            </section>
            <section className="md:col-span-4 lg:col-span-4">
              <FooterHeading className="lg:ml-auto lg:text-right">Members</FooterHeading>
              <div className="card flex flex-col gap-4 p-5 sm:p-6">
                <p className="text-sm leading-relaxed text-foreground/85">{FOOTER.guestPitch}</p>
                <a href="#" className="btn btn-primary inline-flex w-fit items-center gap-1.5 text-sm">{FOOTER.join}<Glyph name="arrowUpRight" className="h-4 w-4" /></a>
                <p className="text-xs leading-relaxed text-foreground/60">{FOOTER.staffNote}</p>
              </div>
            </section>
          </div>
          <div className="mt-10 flex flex-col gap-6 border-t border-border/40 pt-6 text-xs text-foreground/55">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <p className="text-center leading-relaxed text-foreground/60 md:text-left">{FOOTER.tagline}</p>
              <div className="flex flex-wrap items-center justify-center gap-3 md:justify-end">
                {['About Us', 'Contact ESB'].map((l) => <a key={l} href="#" className="inline-flex items-center justify-center px-4 py-2 text-xs font-medium text-muted-foreground bg-secondary/30 border border-border/40 rounded-full">{l}</a>)}
                <a href="#" className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-muted-foreground bg-secondary/30 border border-border/40 rounded-full">Back to Top<Glyph name="chevronUp" className="h-3.5 w-3.5 opacity-80" /></a>
              </div>
            </div>
            <div className="border-t border-border/20 pt-4 text-center md:text-left space-y-1.5">
              <p className="text-xs font-semibold text-foreground/60 leading-normal">© {year} ESB PowerLine. All rights reserved.</p>
              <p className="text-[10px] text-foreground/70 font-normal leading-normal">Developed in-house by <span className="font-medium">chiefhamim</span></p>
            </div>
          </div>
        </div>
      </footer>
    </>
  )
}

function FooterHeading({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={`mb-5 w-fit font-display text-xs font-semibold uppercase tracking-[0.16em] text-foreground ${className}`}>
      {children}
      <span className="mt-2.5 block h-0.5 w-full min-w-[2rem] rounded-full bg-primary" aria-hidden />
    </h3>
  )
}
function ContactItem({ glyph, label, children }: { glyph: keyof typeof GLYPHS; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <Glyph name={glyph} className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">{label}</p>
        <div className="text-sm leading-relaxed text-foreground/90">{children}</div>
      </div>
    </div>
  )
}

// English copy, verbatim from the site's lib/i18n/messages.ts.
const FOOTER = {
  lede: 'Bangladesh\'s power sector news portal and the ESB PowerLine monthly magazine — daily reporting, sector data, and analysis from generation and grid to policy and projects.',
  guestPitch: 'Sign in to save articles and magazine issues, download data packages, join discussions, and unlock in-depth analysis across the power sector.',
  join: 'Member login',
  staffNote: 'Editorial staff and administrators use the same sign-in with assigned roles.',
  tagline: 'Authoritative coverage for utilities, regulators, IPPs, investors and policymakers.',
}

class PreviewBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) } }
  render() {
    if (this.state.error) {
      return <div className="ed-rail-flag warn" style={{ margin: 12 }}>Site preview failed to render: {this.state.error}</div>
    }
    return this.props.children
  }
}

export function SitePreview(props: SitePreviewProps) {
  const width = DEVICE_WIDTHS[props.device]
  const scale = Math.min(1, props.availableWidth / width)
  const [frameH, setFrameH] = useState(900)
  const hostRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (hostRef.current) hostRef.current.style.height = `${Math.ceil(frameH * scale)}px`
  }, [frameH, scale])
  return (
    <div ref={hostRef} className="esb-site-mock" style={{ width: Math.ceil(width * scale), overflow: 'hidden', borderRadius: 8, border: '1px solid var(--line-2)', background: props.theme === 'white' ? '#f8fafc' : props.theme === 'dark' ? '#09090b' : '#04070f', margin: '0 auto' }} data-theme-site={props.theme} data-device={props.device}>
      <PreviewBoundary>
        <SiteFrame theme={props.theme} width={width} scale={scale} onHeight={setFrameH}>
          <SitePage {...props} />
        </SiteFrame>
      </PreviewBoundary>
    </div>
  )
}
