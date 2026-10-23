// Editorial Desk — the ESB PowerLine CMS article editor, with the source beside it and the banner behind it.
//   Left: the original article (link, extraction report, Bengali headline/deck, figures to check, paragraphs) and a
//         "New link" tab for the next story.
//   Centre: the CMS editor — "Headline & deck", then "Story" as its own panel (Body · SEO · Social · Preview).
//   Right: the CMS sidebar — Publish, Featured image (the banner's photo slot, editable here or in Graphics),
//          Organize (category, tags, byline), and Outputs (Banner · Web article · Facebook).
//   Empty desk: a centred intake card (link / pasted Bengali / site CMS posts).

import { useState, useEffect, useMemo, useCallback } from 'react'
import type { CSSProperties } from 'react'
import logoUrl from '../assets/images/esb-logo.png'
import './editorial.css'
import { useEditorialStore } from './editorialStore'
import { OutputsPanel } from './GraphicsRail'
import { useWidth } from '../ui/useWidth'
import { FeaturedImage } from './FeaturedImage'
import { SitePreview, SITE_THEMES, formatArticleDate } from './SitePreview'
import type { SiteDevice, SiteTheme } from './SitePreview'
import { useShellStore } from '../shell/shellStore'
import { Icon } from '../ui/Icon'
import { Field, Select, Check, Dialog, IconButton, MenuBar, Panel, Seg, Tabs } from '../ui/controls'
import type { MenuDef } from '../ui/controls'
import { useStore } from '../store'
import { CATEGORIES } from '../core/tokens'
import type { Assets } from '../core/render'
import { loadBaseAssets } from '../core/assets'
import { describeIntakeError, automateNewsFromUrl } from './automation'
import { autoDesk } from './deskFlag'
import { detectCategory, generatePlatformCaption, suggestHighlight } from '../core/newsroom'
import { extractFactTable, type FactItem } from './facts'
import { bengaliToAsciiDigits } from './bengali'
import {
  translateNewsArticle,
  extractFocusKeywords,
  testGeminiApiKey,
} from './translator'
import {
  SITE_BASE_URL,
  buildCmsArticlePayload,
  insertArticleToSupabase,
} from './siteApi'
import { parseArticleDocument } from './extract'

if (typeof window !== 'undefined') {
  // Test seam: lets the Playwright extraction suite run page fixtures through the real extractor.
  ;(window as unknown as { __esbParseArticle?: typeof parseArticleDocument }).__esbParseArticle = parseArticleDocument
}

interface FactSpan {
  text: string
  isFact: boolean
  isVerified?: boolean
  sourceFact?: FactItem
  tooltip?: string
}

function parseParagraphWithFacts(text: string, factTable: FactItem[], sourceAscii: string): FactSpan[] {
  if (!text) return []
  const pattern = /(?:(?:Tk\.?|৳|BDT|\$|USD)\s*)?[0-9]+(?:[,.][0-9]+)?\s*(?:crore|lakh|million|billion|MW|GW|KW|MMCFD|MMcfd|BCM|TCF|KV|KWH|%|percent)?(?:\s*(?:crore|lakh|Tk\.?|৳|BDT|\$|USD))?/gi

  const spans: FactSpan[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const matchStr = match[0].trim()
    if (!matchStr || !/[0-9]/.test(matchStr)) continue

    if (match.index > lastIndex) {
      spans.push({ text: text.slice(lastIndex, match.index), isFact: false })
    }

    const digitsOnly = matchStr.replace(/[^0-9]/g, '')
    const isTrivial = digitsOnly.length === 1 && parseInt(digitsOnly, 10) < 5 && !/(?:Tk|\$|MW|GW|MMCFD|crore|lakh|%)/i.test(matchStr)

    if (isTrivial) {
      spans.push({ text: match[0], isFact: false })
    } else {
      const isVerified = sourceAscii.includes(digitsOnly)
      const matchingFact = factTable.find((f) => {
        const fDigits = f.normalized.replace(/[^0-9]/g, '')
        return fDigits.length > 0 && (fDigits.includes(digitsOnly) || digitsOnly.includes(fDigits))
      })

      spans.push({
        text: match[0],
        isFact: true,
        isVerified,
        sourceFact: matchingFact,
        tooltip: isVerified
          ? `✓ Verified in source material${matchingFact ? ` (${matchingFact.raw})` : ''}`
          : `⚠ Discrepancy: Figure "${matchStr}" not found in source text!`,
      })
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    spans.push({ text: text.slice(lastIndex), isFact: false })
  }

  return spans
}

type StoryTab = 'body' | 'seo' | 'social' | 'preview'
const SOURCE_OPEN_KEY = 'esb-banner-studio/editorial/source-open'

export function EditorialWorkspace() {
  const source = useEditorialStore((s) => s.source)
  const draft = useEditorialStore((s) => s.draft)
  const checklist = useEditorialStore((s) => s.checklist)
  const apiKey = useEditorialStore((s) => s.apiKey)
  const siteStatus = useEditorialStore((s) => s.siteStatus)
  const staffSession = useEditorialStore((s) => s.staffSession)
  const liveArticles = useEditorialStore((s) => s.liveArticles)
  const slugStatus = useEditorialStore((s) => s.slugStatus)
  const translationProvider = useEditorialStore((s) => s.translationProvider)
  const modelUsed = useEditorialStore((s) => s.modelUsed)

  const checkConnection = useEditorialStore((s) => s.checkConnection)
  const syncFromLiveFeed = useEditorialStore((s) => s.syncFromLiveFeed)
  const loginStaff = useEditorialStore((s) => s.loginStaff)
  const logoutStaff = useEditorialStore((s) => s.logoutStaff)
  const checkSlug = useEditorialStore((s) => s.checkSlug)
  const loadLiveArticleForEdit = useEditorialStore((s) => s.loadLiveArticleForEdit)
  const setSourceArticle = useEditorialStore((s) => s.setSourceArticle)
  const updateSourceManual = useEditorialStore((s) => s.updateSourceManual)
  const setDraftField = useEditorialStore((s) => s.setDraftField)
  const setSocialCaption = useEditorialStore((s) => s.setSocialCaption)
  const toggleChecklist = useEditorialStore((s) => s.toggleChecklist)
  const setApiKey = useEditorialStore((s) => s.setApiKey)
  const setTranslationMeta = useEditorialStore((s) => s.setTranslationMeta)
  const clear = useEditorialStore((s) => s.clear)
  const bannerLink = useEditorialStore((s) => s.bannerLink)
  const deskAuto = useEditorialStore((s) => s.deskAuto)
  const setDesk = useEditorialStore((s) => s.setDesk)
  const autoDetectDesk = useEditorialStore((s) => s.autoDetectDesk)

  // Graphics Studio Banner Store Companion
  const bannerContent = useStore((s) => s.doc.content)
  const bannerImages = useStore((s) => s.images)
  const catData = CATEGORIES.find((c) => c.id === bannerContent.categoryId) || CATEGORIES[0]
  const leadSlotSrc = useStore((s) => s.doc.photos.slots[s.format][0]?.src ?? null)
  const bannerLeadImage = (leadSlotSrc && bannerImages.find((i) => i.id === leadSlotSrc)?.url) || null

  // Mode & State
  const [launcherTab, setLauncherTab] = useState<'url' | 'paste' | 'live_feed'>('url')
  const [bodyMode, setBodyMode] = useState<'review' | 'edit'>('review')
  const [sourceEditing, setSourceEditing] = useState(false)
  const [activeFactId, setActiveFactId] = useState<string | null>(null)
  const [activeSocialTab, setActiveSocialTab] = useState<'facebook' | 'x' | 'linkedin' | 'telegram'>('facebook')
  const [storyTab, setStoryTab] = useState<StoryTab>('body')
  const [leftTab, setLeftTab] = useState<'source' | 'intake'>('source')
  const [tagInput, setTagInput] = useState('')
  // The source column: open by default where there is room for three columns, remembered once chosen.
  const [sourceOpen, setSourceOpenState] = useState<boolean>(() => {
    try { const v = localStorage.getItem(SOURCE_OPEN_KEY); if (v !== null) return v === '1' } catch { /* ignore */ }
    return typeof window === 'undefined' || window.innerWidth >= 1280
  })
  const setSourceOpen = (v: boolean) => { setSourceOpenState(v); try { localStorage.setItem(SOURCE_OPEN_KEY, v ? '1' : '0') } catch { /* ignore */ } }
  const [previewDevice, setPreviewDevice] = useState<SiteDevice>('desktop')
  const [previewTheme, setPreviewTheme] = useState<SiteTheme>('white')
  const [previewHostRef, previewHostW] = useWidth<HTMLDivElement>(720)
  // The date a reader would see if the story went live now; fixed per mount so the preview does not tick.
  const [previewDate] = useState(() => new Date())

  // Intake & AI states
  const [urlInput, setUrlInput] = useState('')
  const [rawBengaliInput, setRawBengaliInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [progressStatus, setProgressStatus] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [errorDetail, setErrorDetail] = useState<{ detail: string; canPaste: boolean } | null>(null)
  const [baseAssets, setBaseAssets] = useState<Assets | null>(null)

  // Live feed filter in intake
  const [searchQuery, setSearchQuery] = useState('')

  // Modals
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [loginEmail, setLoginEmail] = useState('hamim2964@gmail.com')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginBypass, setLoginBypass] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginLoading, setLoginLoading] = useState(false)
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [publishingLive, setPublishingLive] = useState(false)
  const [publishResult, setPublishResult] = useState<{ ok?: boolean; msg?: string; url?: string } | null>(null)
  const [copiedPayload, setCopiedPayload] = useState(false)

  // Gemini API Key Modal
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const [inputApiKey, setInputApiKey] = useState(apiKey || '')
  const [testingApiKey, setTestingApiKey] = useState(false)
  const [apiKeyStatus, setApiKeyStatus] = useState<{ ok?: boolean; msg?: string } | null>(null)

  // Load Base Assets for Mock Renderers
  useEffect(() => {
    let mounted = true
    loadBaseAssets().then((assets) => {
      if (mounted) setBaseAssets(assets)
    }).catch(() => {})
    return () => { mounted = false }
  }, [])

  // Sync feed & connectivity on mount
  useEffect(() => {
    void checkConnection()
    if (liveArticles.length === 0) {
      void syncFromLiveFeed()
    }
  }, [checkConnection, syncFromLiveFeed, liveArticles.length])

  // Toast auto-clear
  const showToast = useCallback((msg: string) => {
    setToastMsg(msg)
    const timer = setTimeout(() => setToastMsg(null), 3000)
    return () => clearTimeout(timer)
  }, [])

  // Check whether desk is empty or active
  const hasStory = !!(source?.title || draft.headline.trim() || draft.body.trim())

  // Text statistics
  const wordCount = useMemo(() => {
    return draft.body.trim() ? draft.body.trim().split(/\s+/).filter(Boolean).length : 0
  }, [draft.body])
  const readTimeMin = Math.max(1, Math.ceil(wordCount / 200))
  const paragraphCount = useMemo(() => {
    return draft.body.trim() ? draft.body.trim().split(/\n\n+/).filter(Boolean).length : 0
  }, [draft.body])

  // Facts & Source Normalization
  const fullSourceText = useMemo(() => {
    return [source?.title, source?.deck, ...(source?.paragraphs || [])].filter(Boolean).join(' ')
  }, [source])

  const factTable = useMemo(() => {
    return extractFactTable(fullSourceText)
  }, [fullSourceText])

  const sourceAscii = useMemo(() => {
    return bengaliToAsciiDigits(fullSourceText)
  }, [fullSourceText])

  // Fact Clicking Interactivity
  const handleFactChipClick = (fact: FactItem) => {
    setActiveFactId(fact.id)
    const digits = fact.normalized.replace(/[^0-9]/g, '')
    const el = document.querySelector(`[data-fact-digits*="${digits}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('fact-pulse')
      setTimeout(() => el.classList.remove('fact-pulse'), 1600)
    }
  }

  const handleBodyFactClick = (digits: string) => {
    const chip = document.querySelector(`[data-source-digits*="${digits}"]`)
    if (chip) {
      chip.scrollIntoView({ behavior: 'smooth', block: 'center' })
      chip.classList.add('fact-pulse')
      setTimeout(() => chip.classList.remove('fact-pulse'), 1600)
    }
  }

  const handleNewStory = () => {
    clear()
    if (bannerLink) useStore.getState().newBanner(true)
    setUrlInput('')
    setRawBengaliInput('')
    setErrorMsg(null)
    showToast('Clean editorial desk opened')
  }

  const handleSyncFeed = async () => {
    setSyncing(true)
    try {
      await syncFromLiveFeed()
      await checkConnection()
      showToast('Synced feed from esbpowerline.com')
    } catch {
      setErrorMsg('Failed to sync feed from esbpowerline.com')
    } finally {
      setSyncing(false)
    }
  }

  // URL Scraper & Parallel Translator
  const handleFetchUrl = async (overrideUrl?: string) => {
    let cleanUrl = (overrideUrl ?? urlInput).trim()
    if (!cleanUrl) return
    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = `https://${cleanUrl}`
      setUrlInput(cleanUrl)
    }

    setLoading(true)
    setErrorMsg(null)
    setErrorDetail(null)
    setProgressStatus('Fetching article & translating to English…')

    try {
      const result = await automateNewsFromUrl(cleanUrl, (status: string) => setProgressStatus(status))

      setDraftField('headline', result.englishHeadline)
      setDraftField('deck', result.deck)
      setDraftField('body', result.body)
      setDraftField('slug', result.slug)
      setDraftField('focusKeywords', result.focusKeywords)
      setDraftField('metaTitle', result.metaTitle)
      setDraftField('metaDescription', result.metaDescription)
      setDraftField('byline', result.byline)
      setDraftField('credit', result.credit)

      setProgressStatus(null)
      const warn = result.extraction?.warnings ?? []
      showToast(warn.length ? `Story imported with ${warn.length} note${warn.length === 1 ? '' : 's'} — see the source pane` : 'Article extracted & populated in English')
    } catch (err: unknown) {
      const info = describeIntakeError(err)
      setErrorMsg(info.title)
      setErrorDetail({ detail: info.detail, canPaste: info.canPaste })
      setProgressStatus(null)
    } finally {
      setLoading(false)
    }
  }

  // Translate Raw Pasted Bengali Story
  const handleTranslateRawBengali = async () => {
    const raw = rawBengaliInput.trim()
    if (!raw) return
    setTranslating(true)
    setErrorMsg(null)
    setProgressStatus('Translating story to English…')

    try {
      const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean)
      const title = lines[0] || 'News Report'
      const paragraphs = lines.length > 1 ? lines.slice(1) : [title]
      const deck = paragraphs[0] ? paragraphs[0].slice(0, 200) : ''

      setSourceArticle(
        {
          title,
          deck,
          paragraphs,
          images: source?.images || [],
          canonicalUrl: 'pasted-text',
          rawHtmlLength: raw.length,
        },
        'pasted-text',
      )

      const translation = await translateNewsArticle(
        {
          title,
          deck,
          paragraphs,
          apiKey,
        },
        (status) => setProgressStatus(status),
      )

      setTranslationMeta(translation.provider, translation.modelUsed)
      setDraftField('headline', translation.headline)
      setDraftField('deck', translation.deck)
      setDraftField('body', translation.body)
      setDraftField('slug', translation.slug)
      setDraftField('focusKeywords', translation.focusKeywords)
      setDraftField('metaTitle', translation.metaTitle)
      setDraftField('metaDescription', translation.metaDescription)

      const detectedCat = detectCategory(`${translation.headline} ${translation.deck} ${translation.body}`) || '01'
      const hl = suggestHighlight(translation.headline)

      const socialContent = {
        headline: translation.headline,
        categoryId: detectedCat,
        cardType: 'stat' as const,
        statNumber: hl || undefined,
        statLabel: translation.headline,
      }
      setSocialCaption('facebook', generatePlatformCaption('facebook', socialContent))
      setSocialCaption('x', generatePlatformCaption('twitter', socialContent))
      setSocialCaption('linkedin', generatePlatformCaption('linkedin', socialContent))
      setSocialCaption('telegram', generatePlatformCaption('telegram', socialContent))

      useEditorialStore.getState().setDeskAuto(true)
      autoDesk(() => useStore.getState().setContent({
        categoryId: detectedCat,
        highlight: hl || useStore.getState().doc.content.highlight,
      }))

      setProgressStatus(null)
      showToast(
        translation.translationFailed
          ? 'No translation service reachable — draft still has untranslated Bengali, review before publishing'
          : 'Story translated and populated in English',
      )
    } catch (err: any) {
      setErrorMsg(err.message || 'Translation failed')
      setProgressStatus(null)
    } finally {
      setTranslating(false)
    }
  }

  // Re-translate current Source into English Draft
  const handleRetranslateSource = async () => {
    if (!source) return
    setTranslating(true)
    setErrorMsg(null)
    setProgressStatus('Re-translating story…')
    try {
      const res = await translateNewsArticle(
        {
          title: source.title,
          deck: source.deck,
          paragraphs: source.paragraphs,
          apiKey,
        },
        (status) => setProgressStatus(status),
      )
      setTranslationMeta(res.provider, res.modelUsed)
      setDraftField('headline', res.headline)
      setDraftField('deck', res.deck)
      setDraftField('body', res.body)
      setDraftField('slug', res.slug)
      setDraftField('focusKeywords', res.focusKeywords)
      setDraftField('metaTitle', res.metaTitle)
      setDraftField('metaDescription', res.metaDescription)

      showToast(
        res.translationFailed
          ? 'No translation service reachable — draft still has untranslated Bengali, review before publishing'
          : 'Re-translated source story into English',
      )
    } catch (err: any) {
      setErrorMsg(err.message || 'Re-translation failed')
    } finally {
      setTranslating(false)
      setProgressStatus(null)
    }
  }

  // Live Publish to CMS or Save Draft to Supabase
  const handleLivePublishToCms = async (targetStatus: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED') => {
    setPublishingLive(true)
    setPublishResult(null)
    try {
      const payload = buildCmsArticlePayload({
        headline: draft.headline,
        deck: draft.deck,
        body: draft.body,
        slug: draft.slug,
        category: catData.name,
        focusKeywords: draft.focusKeywords,
        metaTitle: draft.metaTitle,
        metaDescription: draft.metaDescription,
        byline: staffSession?.name || draft.byline || 'Mehedi Hasan Hamim',
        credit: draft.credit,
        imageUrl: bannerLeadImage || undefined,
        status: targetStatus,
      })

      try {
        await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      } catch {}

      const result = await insertArticleToSupabase(payload, staffSession)

      if (result.success) {
        setPublishResult({
          ok: true,
          msg:
            targetStatus === 'PUBLISHED'
              ? `Published live to esbpowerline.com! (ID: ${result.articleId})`
              : `Saved draft to esbpowerline.com CMS! (ID: ${result.articleId})`,
          url: result.liveUrl,
        })
        showToast(
          targetStatus === 'PUBLISHED'
            ? 'Story published live to esbpowerline.com!'
            : 'Story draft saved to Supabase!'
        )
        syncFromLiveFeed().catch(() => {})
      } else {
        setPublishResult({
          ok: false,
          msg: result.error || 'Failed to insert article into Supabase.',
        })
        showToast('Supabase insert error (payload copied to clipboard)')
      }
    } catch (err: any) {
      setPublishResult({ ok: false, msg: err.message || 'Publish error' })
    } finally {
      setPublishingLive(false)
    }
  }

  const handleOpenInSiteCms = () => {
    const targetUrl = `${SITE_BASE_URL}/cms/articles/new`
    if (typeof window !== 'undefined' && window.open) {
      window.open(targetUrl, '_blank')
    }
  }

  const handleCopyCmsPayload = () => {
    const payload = buildCmsArticlePayload({
      headline: draft.headline,
      deck: draft.deck,
      body: draft.body,
      slug: draft.slug,
      category: catData.name,
      focusKeywords: draft.focusKeywords,
      metaTitle: draft.metaTitle,
      metaDescription: draft.metaDescription,
      byline: staffSession?.name || draft.byline || 'Mehedi Hasan Hamim',
      credit: draft.credit,
      imageUrl: bannerLeadImage || undefined,
    })
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    setCopiedPayload(true)
    setTimeout(() => setCopiedPayload(false), 2500)
    showToast('CMS JSON copied to clipboard')
  }

  // Filtered live CMS articles
  const filteredLiveArticles = useMemo(() => {
    return liveArticles.filter((art) => {
      return (
        !searchQuery.trim() ||
        art.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        art.slug.toLowerCase().includes(searchQuery.toLowerCase())
      )
    })
  }, [liveArticles, searchQuery])

  // Extract source host for source chip
  const sourceHost = useMemo(() => {
    if (!source?.url || source.url === 'pasted-text') return 'Bengali Copy'
    try {
      return new URL(source.url).hostname.replace(/^www\./, '')
    } catch {
      return 'Source'
    }
  }, [source?.url])

  const relatedStories = useMemo(
    () => liveArticles
      .filter((a) => a.category === catData.name && a.slug !== draft.slug)
      .slice(0, 4)
      .map((a) => ({ slug: a.slug, title: a.title, excerpt: a.description, category: a.category, imageUrl: a.imageUrl, date: a.publishedAt })),
    [liveArticles, catData.name, draft.slug],
  )
  const suggestTags = () => extractFocusKeywords(draft.headline, `${draft.deck} ${draft.body}`).split(',').map((t) => t.trim()).filter(Boolean)
  const openPublish = () => { setPublishResult(null); setShowPublishModal(true) }

  // Intake form: the empty-desk launcher and the source column's "New link" tab are the same form.
  const intakeForm = (compact: boolean) => (
    <div className={'ed-intake' + (compact ? ' compact' : '')}>
      <Seg<'url' | 'paste' | 'live_feed'>
        className="block ed-intake-tabs"
        value={launcherTab}
        onChange={(t) => { setLauncherTab(t); setErrorMsg(null); setErrorDetail(null) }}
        options={[
          { value: 'url', icon: 'link', label: compact ? 'Link' : 'Paste Story Link' },
          { value: 'paste', icon: 'edit', label: compact ? 'Paste text' : 'Paste Bengali Story' },
          { value: 'live_feed', icon: 'globe', label: compact ? `Site (${liveArticles.length})` : `Site CMS Posts (${liveArticles.length})` },
        ]}
      />

      {launcherTab === 'url' && (
        <div className="ed-intake-body">
          <div className="ed-intake-url">
            <input
              type="url"
              className="input ed-url-input"
              placeholder="https://bonikbarta.net/news/… or prothomalo.com/…"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFetchUrl()}
            />
            <button type="button" className="btn primary" onClick={() => handleFetchUrl()} disabled={loading || !urlInput.trim()}>
              <Icon name={loading ? 'refresh' : 'sparkle'} size={14} />
              <span>{loading ? 'Extracting…' : 'Fetch & Auto-Translate'}</span>
            </button>
          </div>
          <p className="hint">Paste a Bengali or English news link. The article is extracted, translated and laid out as a CMS draft; the original stays on the left for checking.</p>
        </div>
      )}

      {launcherTab === 'paste' && (
        <div className="ed-intake-body">
          <textarea
            className="input ed-paste-area"
            placeholder="Paste the Bengali headline on the first line, then the story…"
            value={rawBengaliInput}
            onChange={(e) => setRawBengaliInput(e.target.value)}
          />
          <div className="ed-intake-foot">
            <span className="mono hint">{rawBengaliInput.trim().length} characters</span>
            <button type="button" className="btn primary" onClick={handleTranslateRawBengali} disabled={translating || !rawBengaliInput.trim()}>
              <Icon name={translating ? 'refresh' : 'sparkle'} size={14} />
              <span>{translating ? 'Translating…' : 'Auto-Translate & Populate'}</span>
            </button>
          </div>
        </div>
      )}

      {launcherTab === 'live_feed' && (
        <div className="ed-intake-body">
          <div className="ed-intake-url">
            <input type="text" className="input ed-url-input" placeholder="Filter stories by keyword…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            <button type="button" className="btn" onClick={handleSyncFeed} disabled={syncing}>
              <Icon name="refresh" size={13} />
              <span>{syncing ? 'Syncing…' : 'Sync'}</span>
            </button>
          </div>
          <div className="ed-feed-list">
            {filteredLiveArticles.length === 0 ? (
              <p className="hint ed-feed-empty">{liveArticles.length ? 'No published stories match that filter.' : 'No stories loaded from esbpowerline.com yet. Sync to fetch the latest.'}</p>
            ) : (
              filteredLiveArticles.slice(0, 15).map((art) => (
                <div key={art.slug} className="ed-feed-item">
                  <div className="ed-feed-text">
                    <b>{art.title}</b>
                    <span>{art.category} · {art.publishedAt || 'Published'}</span>
                  </div>
                  <button type="button" className="btn sm" onClick={() => void loadLiveArticleForEdit(art)}>Load Story</button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="callout warn ed-intake-error" role="alert">
          <Icon name="info" size={14} />
          <div className="ed-intake-error-text">
            <b>{errorMsg}</b>
            {errorDetail?.detail && <span>{errorDetail.detail}</span>}
          </div>
          <div className="ed-intake-error-actions">
            {launcherTab === 'url' && (
              <button type="button" className="btn xs" onClick={() => void handleFetchUrl()} disabled={loading}>Try again</button>
            )}
            {errorDetail?.canPaste && launcherTab !== 'paste' && (
              <button type="button" className="btn xs primary" onClick={() => { setLauncherTab('paste'); setErrorMsg(null); setErrorDetail(null) }}>Paste the text instead</button>
            )}
          </div>
        </div>
      )}
    </div>
  )

  const extractionLabel = source?.extraction
    ? source.extraction.method === 'structured' ? 'Structured data' : source.extraction.method === 'markup' ? 'Page markup' : source.extraction.method === 'page-data' ? 'Page data' : 'Metadata only'
    : null
  const languageLabel = source?.extraction
    ? source.extraction.language === 'bn' ? 'Bengali' : source.extraction.language === 'en' ? 'English' : source.extraction.language === 'mixed' ? 'Mixed' : 'Unknown language'
    : null
  const sourceUrl = source?.url && /^https?:\/\//.test(source.url) ? source.url : null
  const checksDone = [checklist.figuresChecked, checklist.namesChecked, checklist.attributionKept].filter(Boolean).length
  const tagList = draft.focusKeywords.split(',').map((t) => t.trim()).filter(Boolean)
  const setTags = (tags: string[]) => setDraftField('focusKeywords', tags.join(', '))
  const addTag = (raw: string) => {
    const t = raw.trim().replace(/^#/, '')
    if (t && !tagList.some((x) => x.toLowerCase() === t.toLowerCase())) setTags([...tagList, t])
    setTagInput('')
  }

  const menus: MenuDef[] = [
    { label: 'Story', items: [
      { label: 'New story', icon: 'plus', onClick: handleNewStory },
      { label: 'Load another link…', icon: 'link', disabled: !hasStory, onClick: () => { setSourceOpen(true); setLeftTab('intake'); setLauncherTab('url') } },
      { label: 'Re-translate the source', icon: 'refresh', disabled: !source || translating, onClick: () => void handleRetranslateSource() },
      { divider: true },
      { label: 'Copy CMS JSON', icon: 'copy', disabled: !draft.headline.trim(), onClick: handleCopyCmsPayload },
      { label: 'Review & publish…', icon: 'upload', disabled: !draft.headline.trim(), onClick: openPublish },
    ] },
    { label: 'Site', items: [
      { label: 'Sync stories from esbpowerline.com', icon: 'refresh', onClick: () => void handleSyncFeed() },
      { label: 'Open the site CMS', icon: 'externalLink', onClick: handleOpenInSiteCms },
      { divider: true },
      { label: staffSession ? `Signed in as ${staffSession.name}` : 'Staff sign-in…', icon: 'user', onClick: () => setShowLoginModal(true) },
      { label: apiKey ? 'Gemini key (active)…' : 'Gemini API key…', icon: 'sparkle', onClick: () => setShowApiKeyModal(true) },
    ] },
    { label: 'View', items: [
      { label: 'Source column', checked: sourceOpen, disabled: !hasStory, onClick: () => setSourceOpen(!sourceOpen) },
      { divider: true },
      { label: 'Story body', checked: storyTab === 'body', disabled: !hasStory, onClick: () => setStoryTab('body') },
      { label: 'SEO', checked: storyTab === 'seo', disabled: !hasStory, onClick: () => setStoryTab('seo') },
      { label: 'Social captions', checked: storyTab === 'social', disabled: !hasStory, onClick: () => setStoryTab('social') },
      { label: 'Article preview', checked: storyTab === 'preview', disabled: !hasStory, onClick: () => setStoryTab('preview') },
      { divider: true },
      { label: 'Graphics', icon: 'layers', onClick: () => useShellStore.getState().openGraphicsFrom('editorial', null) },
    ] },
  ]

  return (
    <div className={'editorial-workspace' + (hasStory && sourceOpen ? ' source-open' : '')} style={{ ['--cat' as string]: catData.accent } as CSSProperties}>
      {/* Header: the same bar Graphics uses — brand, menus, a centred tool group, quiet icon pills, one primary action. */}
      <header className="topbar ed-head">
        <div className="brand">
          <span className="logo-wrap"><img src={logoUrl} alt="ESB PowerLine" /></span>
        </div>
        <MenuBar menus={menus} />
        <span className="ed-topbar-title">Editorial Desk</span>
        <div className="spacer" />
        <div className="fmtgroup ed-head-group">
          {hasStory && (
            <button type="button" className={'pv-btn' + (sourceOpen ? ' on' : '')} onClick={() => setSourceOpen(!sourceOpen)} aria-pressed={sourceOpen} title={sourceOpen ? 'Hide the source column' : 'Show the original article'}>
              <Icon name="newspaper" size={15} />
              <span className="ed-head-host">{sourceHost}</span>
              <span className="dpc-tag">{source?.paragraphs.length ?? paragraphCount} ¶</span>
            </button>
          )}
          <button type="button" className="pv-btn ed-site-pill" onClick={() => setShowLoginModal(true)} title="Live site connection and staff sign-in">
            <span className={`site-dot ${siteStatus.connected ? 'online' : 'offline'}`} />
            <span className="site-host">esbpowerline.com</span>
            <span className="site-state">{siteStatus.connected ? `${siteStatus.latencyMs} ms` : 'offline'}</span>
          </button>
          {hasStory && source && (
            <button type="button" className="pv-btn" onClick={handleRetranslateSource} disabled={translating} title="Translate the original story again">
              <Icon name="refresh" size={14} />
              <span>{translating ? 'Translating…' : 'Re-translate'}</span>
            </button>
          )}
        </div>
        <div className="spacer" />
        {progressStatus && (
          <div className="ed-topbar-progress">
            <span className="pulse-dot" />
            <span>{progressStatus}</span>
          </div>
        )}
        <div className="pillbar">
          <IconButton icon="plus" tip="New story" onClick={handleNewStory} />
          <IconButton icon="refresh" tip="Sync stories from esbpowerline.com" onClick={handleSyncFeed} disabled={syncing} />
          <i className="pill-sep" />
          <IconButton icon="sparkle" tip={apiKey ? 'Gemini 2.5 active' : 'Configure a Gemini API key'} active={!!apiKey} onClick={() => setShowApiKeyModal(true)} />
          <IconButton icon="user" tip={staffSession ? `Signed in as ${staffSession.name}` : 'Staff sign-in'} active={!!staffSession} onClick={() => setShowLoginModal(true)} />
        </div>
        <button type="button" className="btn primary" onClick={openPublish} disabled={!draft.headline.trim()} title="Review the checklist and publish to esbpowerline.com">
          <Icon name="upload" size={15} />
          <span>Publish</span>
        </button>
      </header>

      {!hasStory ? (
        <div className="ed-launcher-wrap">
          <div className="ed-launcher-card">
            <div className="ed-launcher-hero">
              <h2>Editorial Story Desk</h2>
              <p>Translate Bengali reporting into newsroom English, check every figure against the source, and publish to esbpowerline.com.</p>
            </div>
            {intakeForm(false)}
          </div>
          {toastMsg && <div className="toast" onClick={() => setToastMsg(null)}><Icon name="info" size={15} />{toastMsg}</div>}
        </div>
      ) : (
        <div className="ed-desk">
          {/* LEFT — the original article, untouched, beside the copy made from it */}
          <aside className="left ed-src" aria-label="Original source">
            <Tabs<'source' | 'intake'>
              value={leftTab}
              onChange={setLeftTab}
              options={[{ value: 'source', icon: 'newspaper', label: 'Source' }, { value: 'intake', icon: 'link', label: 'New link' }]}
            />
            <div className="scroll ed-src-scroll">
              {leftTab === 'intake' ? (
                <div className="ed-src-intake">{intakeForm(true)}</div>
              ) : (
                <>
                  <Panel id="ed-src-link" title="Original link" sub={sourceHost} persist={false} actions={
                    <button type="button" className={'btn xs' + (sourceEditing ? ' primary' : ' ghost')} onClick={() => setSourceEditing(!sourceEditing)} title="Correct the extracted source text by hand">
                      <Icon name="edit" size={12} />
                      <span>{sourceEditing ? 'Done' : 'Edit'}</span>
                    </button>
                  }>
                    {sourceUrl ? (
                      <div className="ed-src-url">
                        <span className="mono" title={sourceUrl}>{sourceUrl.replace(/^https?:\/\/(www\.)?/, '')}</span>
                        <div className="ed-src-url-actions">
                          <a className="btn xs" href={sourceUrl} target="_blank" rel="noopener noreferrer" title="Open the original article"><Icon name="externalLink" size={12} /><span>Open</span></a>
                          <button type="button" className="btn xs" onClick={() => void handleFetchUrl(sourceUrl)} disabled={loading} title="Fetch and translate this link again"><Icon name="refresh" size={12} /><span>{loading ? 'Fetching…' : 'Re-fetch'}</span></button>
                        </div>
                      </div>
                    ) : (
                      <p className="hint">{source?.url === 'pasted-text' ? 'Pasted text — no link to return to.' : 'Loaded from the site CMS.'}</p>
                    )}
                    {source?.extraction && (
                      <div className="ed-extract-report" title={source.extraction.contentSelector ? `Story block: ${source.extraction.contentSelector}` : undefined}>
                        <span className={`ed-extract-chip method-${source.extraction.method}`}>{extractionLabel}</span>
                        <span className="ed-extract-chip">{languageLabel}</span>
                        <span className="ed-extract-chip">{source.paragraphs.length} paragraph{source.paragraphs.length === 1 ? '' : 's'}</span>
                        <span className="ed-extract-chip">{source.images.length} photo{source.images.length === 1 ? '' : 's'}</span>
                        {source.extraction.warnings.map((w) => (
                          <span key={w} className="ed-extract-warn"><Icon name="info" size={11} />{w}</span>
                        ))}
                      </div>
                    )}
                  </Panel>

                  {sourceEditing ? (
                    <Panel id="ed-src-edit" title="Edit source text" persist={false}>
                      <Field label="Original headline">
                        <input id="source-title-input" type="text" className="input" value={source?.title || ''} onChange={(e) => updateSourceManual(e.target.value, source?.deck || '', source?.paragraphs || [])} />
                      </Field>
                      <Field label="Original deck">
                        <textarea className="input ed-src-textarea" rows={3} value={source?.deck || ''} onChange={(e) => updateSourceManual(source?.title || '', e.target.value, source?.paragraphs || [])} />
                      </Field>
                      <Field label="Paragraphs (blank line between)">
                        <textarea
                          className="input ed-src-textarea tall"
                          rows={12}
                          value={source?.paragraphs.join('\n\n') || ''}
                          onChange={(e) => updateSourceManual(source?.title || '', source?.deck || '', e.target.value.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean))}
                        />
                      </Field>
                    </Panel>
                  ) : (
                    <>
                      <Panel id="ed-src-head" title="Headline & deck" sub={languageLabel ?? undefined}>
                        <div className="ed-source-reader">
                          <textarea id="source-title-input" className="source-reader-title-input" readOnly rows={2} value={source?.title || ''} title="Original headline" />
                          {source?.deck && <p className="source-reader-deck">{source.deck}</p>}
                        </div>
                      </Panel>

                      {factTable.length > 0 && (
                        <Panel id="ed-src-facts" title="Facts to check" sub={`${factTable.length}`}>
                          <div className="fact-strip">
                            {factTable.map((f) => (
                              <span
                                key={f.id}
                                className={`fact-pill ${f.kind} ${activeFactId === f.id ? 'active' : ''}`}
                                onClick={() => handleFactChipClick(f)}
                                title={`Find in the English story: ${f.normalized}`}
                                data-source-digits={f.normalized.replace(/[^0-9]/g, '')}
                              >
                                {f.normalized}
                              </span>
                            ))}
                          </div>
                          <p className="hint">Click a figure to find it in the English story.</p>
                        </Panel>
                      )}

                      <Panel id="ed-src-body" title="Original story" sub={`${source?.paragraphs.length || 0} ¶`}>
                        <div className="source-paragraphs">
                          {(source?.paragraphs || []).map((p, idx) => (
                            <p key={idx} className="source-reader-p"><span className="source-reader-n">{String(idx + 1).padStart(2, '0')}</span>{p}</p>
                          ))}
                        </div>
                      </Panel>
                    </>
                  )}
                </>
              )}
            </div>
          </aside>
          {sourceOpen && <div className="ed-src-scrim" onClick={() => setSourceOpen(false)} aria-hidden />}

          {/* CENTRE — the CMS article editor: headline & deck, then the story as its own panel */}
          <main className="ed-center scroll">
            <div className="ed-center-col">
              <section className="ed-card ed-card-headline">
                <header className="ed-card-head">
                  <Icon name="newspaper" size={16} />
                  <div className="ed-card-title">
                    <h2>Headline &amp; deck</h2>
                    <p>English copy for esbpowerline.com — review the translation against the source.</p>
                  </div>
                  <span className={'ed-state-chip ' + (translationProvider === 'offline' ? 'warn' : '')}>
                    {translationProvider === 'gemini' ? 'Gemini draft' : translationProvider === 'offline' ? 'Needs translation' : 'Machine draft'}
                  </span>
                </header>
                <div className="ed-card-body">
                  <div className="ed-field">
                    <div className="ed-field-row">
                      <label htmlFor="draft-headline">Headline</label>
                      <span className={`ed-budget-counter ${draft.headline.length > 104 ? 'over' : ''}`}>{draft.headline.length} / 104</span>
                    </div>
                    <textarea id="draft-headline" className="ed-input ed-input-headline" rows={2} placeholder="The English headline readers will see…" value={draft.headline} onChange={(e) => setDraftField('headline', e.target.value)} />
                  </div>
                  <div className="ed-field">
                    <div className="ed-field-row">
                      <label htmlFor="draft-deck">Deck / excerpt</label>
                      <span className={`ed-budget-counter ${draft.deck.length > 200 ? 'over' : ''}`}>{draft.deck.length} / 200</span>
                    </div>
                    <textarea id="draft-deck" className="ed-input ed-input-deck" rows={2} placeholder="One or two sentences that summarise the story…" value={draft.deck} onChange={(e) => setDraftField('deck', e.target.value)} />
                  </div>
                </div>
              </section>

              <section className="ed-card ed-card-story">
                <header className="ed-card-head tabs">
                  <Icon name="layers" size={16} />
                  <div className="ed-card-title">
                    <h2>Story</h2>
                    <p>{wordCount} words · ~{readTimeMin} min read · {paragraphCount} paragraph{paragraphCount === 1 ? '' : 's'}</p>
                  </div>
                  <Seg<StoryTab>
                    className="ed-story-tabs"
                    value={storyTab}
                    onChange={setStoryTab}
                    options={[
                      { value: 'body', icon: 'type', label: 'Body' },
                      { value: 'seo', icon: 'globe', label: 'SEO' },
                      { value: 'social', icon: 'quote', label: 'Social' },
                      { value: 'preview', icon: 'eye', label: 'Preview' },
                    ]}
                  />
                </header>

                {storyTab === 'body' && (
                  <div className="ed-card-body">
                    <div className="ed-body-tools">
                      <Seg<'review' | 'edit'>
                        value={bodyMode}
                        onChange={setBodyMode}
                        options={[{ value: 'review', icon: 'check', label: 'Verified view' }, { value: 'edit', icon: 'edit', label: 'Edit text' }]}
                      />
                      <span className="ed-legend"><i className="ok" />in source <i className="bad" />not found in source</span>
                    </div>
                    {bodyMode === 'review' ? (
                      <div className="ed-story-doc-view" onDoubleClick={() => setBodyMode('edit')} title="Double-click to edit">
                        {draft.body ? (
                          draft.body.split(/\n{2,}/).map((p, pIdx) => {
                            const spans = parseParagraphWithFacts(p, factTable, sourceAscii)
                            return (
                              <p key={pIdx} className="ed-story-doc-p">
                                {spans.map((sp, sIdx) => {
                                  if (!sp.isFact) return <span key={sIdx}>{sp.text}</span>
                                  const digits = sp.text.replace(/[^0-9]/g, '')
                                  return (
                                    <span key={sIdx} className={sp.isVerified ? 'fact-verified' : 'fact-unverified'} title={sp.tooltip} data-fact-digits={digits} onClick={() => handleBodyFactClick(digits)}>
                                      {sp.text}
                                    </span>
                                  )
                                })}
                              </p>
                            )
                          })
                        ) : (
                          <p className="hint">The translated story appears here, with every figure checked against the source.</p>
                        )}
                        <textarea id="draft-body" hidden readOnly value={draft.body} />
                      </div>
                    ) : (
                      <textarea id="draft-body" className="ed-input ed-input-body" placeholder="The full English story. Leave a blank line between paragraphs." value={draft.body} onChange={(e) => setDraftField('body', e.target.value)} />
                    )}
                  </div>
                )}

                {storyTab === 'seo' && (
                  <div className="ed-card-body">
                    <div className="ed-field">
                      <div className="ed-field-row"><label htmlFor="draft-meta-title">Meta title</label><span className="ed-budget-counter">{(draft.metaTitle || draft.headline).length} / 60</span></div>
                      <input id="draft-meta-title" type="text" className="ed-input" value={draft.metaTitle || ''} placeholder={draft.headline || 'Defaults to the headline'} onChange={(e) => setDraftField('metaTitle', e.target.value)} />
                    </div>
                    <div className="ed-field">
                      <div className="ed-field-row"><label htmlFor="draft-meta-desc">Meta description</label><span className="ed-budget-counter">{(draft.metaDescription || '').length} / 155</span></div>
                      <textarea id="draft-meta-desc" className="ed-input" rows={3} value={draft.metaDescription || ''} placeholder={draft.deck || 'About 155 characters for search snippets'} onChange={(e) => setDraftField('metaDescription', e.target.value)} />
                    </div>
                    <div className="ed-field">
                      <div className="ed-field-row"><label htmlFor="draft-slug">URL slug</label><span className={`ed-budget-counter ${draft.slug.length > 80 ? 'over' : ''}`}>{draft.slug.length} / 80</span></div>
                      <div className="ed-slug">
                        <span className="ed-slug-prefix">/articles/</span>
                        <input id="draft-slug" type="text" className="ed-slug-input mono" value={draft.slug} onChange={(e) => setDraftField('slug', e.target.value)} />
                        <button type="button" className="btn sm" onClick={() => void checkSlug(draft.slug)} disabled={slugStatus === 'checking' || !draft.slug}>
                          {slugStatus === 'checking' ? 'Checking…' : slugStatus === 'available' ? '✓ Available' : slugStatus === 'taken' ? 'Taken' : 'Check'}
                        </button>
                      </div>
                      <span className="hint">Generated from the headline. Edit it to customise.</span>
                    </div>
                  </div>
                )}

                {storyTab === 'social' && (
                  <div className="ed-card-body">
                    <div className="ed-body-tools">
                      <Seg<'facebook' | 'x' | 'linkedin' | 'telegram'>
                        value={activeSocialTab}
                        onChange={setActiveSocialTab}
                        options={[{ value: 'facebook', label: 'Facebook' }, { value: 'x', label: 'X' }, { value: 'linkedin', label: 'LinkedIn' }, { value: 'telegram', label: 'Telegram' }]}
                      />
                      <span className="ed-budget-counter">{(draft.social[activeSocialTab] || '').length} chars</span>
                    </div>
                    <textarea className="ed-input ed-input-social" rows={6} value={draft.social[activeSocialTab] || ''} onChange={(e) => setSocialCaption(activeSocialTab, e.target.value)} />
                    <div className="ed-card-actions">
                      <button type="button" className="btn sm" onClick={() => { void navigator.clipboard.writeText(draft.social[activeSocialTab] || ''); showToast('Caption copied') }}>
                        <Icon name="copy" size={13} />
                        <span>Copy caption</span>
                      </button>
                    </div>
                  </div>
                )}

                {storyTab === 'preview' && (
                  <div className="ed-card-body" ref={previewHostRef}>
                    <div className="ed-body-tools">
                      <Seg<SiteDevice> value={previewDevice} onChange={setPreviewDevice} options={[{ value: 'desktop', label: 'Desktop' }, { value: 'tablet', label: 'Tablet' }, { value: 'mobile', label: 'Phone' }]} />
                      <Seg<SiteTheme> value={previewTheme} onChange={setPreviewTheme} options={SITE_THEMES.map((t) => ({ value: t.id, label: t.label }))} />
                    </div>
                    <SitePreview
                      theme={previewTheme}
                      device={previewDevice}
                      availableWidth={Math.max(280, previewHostW - 32)}
                      title={draft.headline}
                      excerpt={draft.deck}
                      slug={draft.slug}
                      category={catData.name}
                      author={staffSession?.name || draft.byline || 'ESB PowerLine'}
                      date={previewDate}
                      readTime={readTimeMin}
                      heroUrl={bannerLeadImage}
                      heroCredit={draft.credit || 'ESB PowerLine'}
                      paragraphs={draft.body.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean)}
                      tags={tagList}
                      related={relatedStories}
                    />
                    <span className="hint mono">https://esbpowerline.com/articles/{draft.slug || 'story-slug'}</span>
                  </div>
                )}
              </section>
            </div>
            {toastMsg && <div className="toast" onClick={() => setToastMsg(null)}><Icon name="info" size={15} />{toastMsg}</div>}
          </main>

          {/* RIGHT — the CMS sidebar: publish, featured image, organise; then the outputs Graphics shares */}
          <aside className="right ed-side" aria-label="Publishing and image">
            <Panel id="ed-publish" title="Publish" sub={publishResult?.ok ? 'Published' : 'Draft'}>
              <dl className="ed-kv">
                <dt>Status</dt>
                <dd><span className={'ed-status ' + (publishResult?.ok ? 'live' : 'draft')}>{publishResult?.ok ? 'Published' : 'Draft · not on the site yet'}</span></dd>
                <dt>Destination</dt>
                <dd>
                  <span className={`site-dot ${siteStatus.connected ? 'online' : 'offline'}`} />
                  esbpowerline.com {siteStatus.connected ? '' : '(offline)'}
                </dd>
                <dt>Dateline</dt>
                <dd title="What the article page shows if it is published now (Dhaka time)">{formatArticleDate(previewDate).replace(/^Published on /, '')}</dd>
                <dt>Signed in</dt>
                <dd>{staffSession ? staffSession.name : <button type="button" className="btn-link" onClick={() => setShowLoginModal(true)}>Sign in</button>}</dd>
                <dt>Checks</dt>
                <dd><span className={'ed-status ' + (checksDone === 3 ? 'live' : 'draft')}>{checksDone} of 3 pre-flight checks</span></dd>
              </dl>
              <button type="button" className="btn primary ed-publish-btn" onClick={openPublish} disabled={!draft.headline.trim()}>
                <Icon name="upload" size={15} />
                <span>Review &amp; publish</span>
              </button>
              <div className="ed-publish-row">
                <button type="button" className="btn sm" onClick={handleCopyCmsPayload} disabled={!draft.headline.trim()}>
                  <Icon name={copiedPayload ? 'check' : 'copy'} size={13} />
                  <span>{copiedPayload ? 'Copied' : 'CMS JSON'}</span>
                </button>
                <button type="button" className="btn sm" onClick={handleOpenInSiteCms}>
                  <Icon name="externalLink" size={13} />
                  <span>Site CMS</span>
                </button>
              </div>
            </Panel>

            <Panel id="ed-image" title="Featured image" sub={bannerLeadImage ? 'Set' : 'None'}>
              <FeaturedImage onToast={showToast} />
            </Panel>

            <Panel id="ed-organize" title="Organize" sub={catData.name}>
              <Field label="Category">
                <div className="row">
                  <Select
                    className="ed-desk-select"
                    value={bannerContent.categoryId}
                    options={CATEGORIES.map((c) => ({ value: c.id, label: c.name, swatch: c.accent }))}
                    onChange={(id) => setDesk(String(id))}
                  />
                </div>
              </Field>
              <button
                type="button"
                className={'btn-link ed-auto-desk' + (deskAuto ? ' on' : '')}
                onClick={() => { const id = autoDetectDesk(); const c = CATEGORIES.find((x) => x.id === id); showToast(`Category set to ${c?.name ?? id} from the story`) }}
              >
                {deskAuto ? '✓ Detected from the story' : 'Detect from the story'}
              </button>
              <Field label={<span className="ed-field-row"><span>Tags</span><button type="button" className="btn-link" onClick={() => setTags(suggestTags())}>Auto-pick from story</button></span>}>
                <div className="ed-tags" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
                  {tagList.map((t) => (
                    <span key={t} className="ed-tag-pill">#{t}<button type="button" aria-label={`Remove tag ${t}`} onClick={() => setTags(tagList.filter((x) => x !== t))}><Icon name="x" size={10} /></button></span>
                  ))}
                  <input
                    type="text"
                    value={tagInput}
                    placeholder={tagList.length ? '' : 'Type and press comma…'}
                    onChange={(e) => { const v = e.target.value; if (v.endsWith(',')) addTag(v.slice(0, -1)); else setTagInput(v) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput) }
                      else if (e.key === 'Backspace' && !tagInput && tagList.length) setTags(tagList.slice(0, -1))
                    }}
                    onBlur={() => tagInput.trim() && addTag(tagInput)}
                  />
                </div>
              </Field>
              <Field label="Byline">
                <input type="text" className="input" value={draft.byline} placeholder={staffSession?.name || 'Reporter name'} onChange={(e) => setDraftField('byline', e.target.value)} />
              </Field>
            </Panel>

            <Panel id="ed-outputs" title="Outputs" sub="Banner · Web · Facebook">
              {baseAssets ? <OutputsPanel base={baseAssets} onToast={showToast} /> : <p className="hint">Loading the banner…</p>}
            </Panel>
          </aside>
        </div>
      )}

      {/* =========================================================================
          3. BOTTOM STATUS BAR — Minimal & quiet (Requirement 7)
          ========================================================================= */}
      <footer className="statusbar ed-statusbar">
        <span>
          CMS: <b>{siteStatus.connected ? 'esbpowerline.com Connected' : 'Offline Mode'}</b>
        </span>
        <div className="sep" />
        <span>
          Engine:{' '}
          <b>
            {translationProvider === 'gemini'
              ? modelUsed || 'Gemini 2.5'
              : translationProvider === 'offline'
                ? 'Offline — manual translation needed'
                : 'Neural GTX'}
          </b>
        </span>
        <div className="spacer" />
        <span>
          {wordCount} words · ~{readTimeMin} min read
        </span>
        <div className="sep" />
        <span>Editor: {staffSession?.name || 'Mehedi Hasan Hamim'}</span>
      </footer>

      {/* =========================================================================
          4. DIALOGS (Staff Login, Live Publish to CMS, Gemini Key)
          ========================================================================= */}

      {/* Staff Authentication Dialog */}
      {showLoginModal && (
        <Dialog
          title="ESB PowerLine Staff Authentication"
          kicker="CMS ACCOUNT"
          width={500}
          onClose={() => setShowLoginModal(false)}
          footer={
            <>
              <div className="spacer" />
              <button type="button" className="btn" onClick={() => setShowLoginModal(false)}>
                Close
              </button>
            </>
          }
        >
          {staffSession ? (
            <div className="stack">
              <div className="callout good">
                <Icon name="check" size={15} />
                <div>
                  <b>Signed in as {staffSession.name}</b> ({staffSession.email}) · Role:{' '}
                  <span className="ed-tag">{staffSession.role.toUpperCase()}</span>
                </div>
              </div>
              <p className="sub">
                Authenticated session valid for direct Supabase REST insertion to <code>public.Article</code>.
              </p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  logoutStaff()
                  showToast('Signed out of CMS account')
                }}
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              <Field label="Staff Email">
                <input
                  type="email"
                  className="ed-url-input"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  className="ed-url-input"
                  placeholder="Supabase staff password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                />
              </Field>
              <div className="row">
                <Check
                  checked={loginBypass}
                  onChange={() => setLoginBypass(!loginBypass)}
                  label="Verified Newsroom Bypass (hamim2964@gmail.com)"
                />
              </div>
              {loginError && (
                <div className="callout warn">
                  <Icon name="info" size={14} />
                  <span>{loginError}</span>
                </div>
              )}
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  type="button"
                  className="btn primary"
                  disabled={loginLoading}
                  onClick={async () => {
                    setLoginLoading(true)
                    setLoginError(null)
                    try {
                      const res = await loginStaff(loginEmail, loginPassword, loginBypass)
                      if (res.success) {
                        setShowLoginModal(false)
                        showToast('Signed in successfully')
                      } else {
                        setLoginError(res.error || 'Authentication failed')
                      }
                    } catch (e: any) {
                      setLoginError(e.message)
                    } finally {
                      setLoginLoading(false)
                    }
                  }}
                >
                  {loginLoading ? 'Authenticating…' : 'Sign In'}
                </button>
              </div>
            </div>
          )}
        </Dialog>
      )}

      {/* Gemini API Key Dialog */}
      {showApiKeyModal && (
        <Dialog
          title="Google Gemini AI Engine"
          kicker="API CONFIGURATION"
          width={480}
          onClose={() => setShowApiKeyModal(false)}
          footer={
            <>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  setTestingApiKey(true)
                  const res = await testGeminiApiKey(inputApiKey.trim())
                  setTestingApiKey(false)
                  setApiKeyStatus(res)
                }}
                disabled={testingApiKey || !inputApiKey.trim()}
              >
                {testingApiKey ? 'Testing…' : 'Test Key'}
              </button>
              <div className="spacer" />
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setApiKey(inputApiKey.trim())
                  setShowApiKeyModal(false)
                  showToast(inputApiKey.trim() ? 'Gemini 2.5 API key saved' : 'Switched to Neural GTX fallback')
                }}
              >
                Save
              </button>
            </>
          }
        >
          <div className="stack" style={{ gap: 10 }}>
            <p className="sub">
              Enter your Gemini API key for high-speed bilingual translations via Gemini 2.5 Flash.
            </p>
            <input
              type="password"
              className="ed-url-input"
              placeholder="AIzaSy..."
              value={inputApiKey}
              onChange={(e) => setInputApiKey(e.target.value)}
            />
            {apiKeyStatus && (
              <div className={`callout ${apiKeyStatus.ok ? 'good' : 'warn'}`}>
                <Icon name={apiKeyStatus.ok ? 'check' : 'info'} size={14} />
                <span>{apiKeyStatus.msg}</span>
              </div>
            )}
          </div>
        </Dialog>
      )}

      {/* Publish to CMS & Supabase Dialog */}
      {showPublishModal && (
        <Dialog
          title="Publish Story to esbpowerline.com"
          kicker="LIVE CMS PUBLISHING"
          width={620}
          onClose={() => setShowPublishModal(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={handleCopyCmsPayload} title="Copy formatted CMS JSON to clipboard">
                <Icon name="copy" size={14} />
                <span>{copiedPayload ? 'Copied JSON!' : 'Copy CMS JSON'}</span>
              </button>
              <button type="button" className="btn" onClick={handleOpenInSiteCms} title="Open esbpowerline.com/cms in browser">
                <Icon name="globe" size={14} />
                <span>Open CMS Editor ↗</span>
              </button>
              <div className="spacer" />
              <button
                type="button"
                className="btn"
                onClick={() => void handleLivePublishToCms('DRAFT')}
                disabled={publishingLive || !draft.headline.trim()}
                title="Save as Draft in Supabase (hidden from public, visible in CMS)"
              >
                <Icon name="check" size={14} />
                <span>Save Draft</span>
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => void handleLivePublishToCms('PUBLISHED')}
                disabled={publishingLive || !draft.headline.trim() || !(checklist.figuresChecked && checklist.namesChecked && checklist.attributionKept)}
                title={!(checklist.figuresChecked && checklist.namesChecked && checklist.attributionKept) ? 'Please tick all pre-flight verification items before publishing' : 'Directly publish live to esbpowerline.com database'}
              >
                <Icon name="upload" size={14} />
                <span>{publishingLive ? 'Publishing…' : 'Publish Live to CMS'}</span>
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="grid2 sub">
              <div>
                <span className="kicker">HEADLINE BUDGET</span>
                <div>
                  <b>{draft.headline.length} / 104 chars</b> {draft.headline.length <= 104 ? '✓' : '⚠ Over'}
                </div>
              </div>
              <div>
                <span className="kicker">DECK BUDGET</span>
                <div>
                  <b>{draft.deck.length} / 200 chars</b> {draft.deck.length <= 200 ? '✓' : '⚠ Over'}
                </div>
              </div>
              <div>
                <span className="kicker">URL SLUG</span>
                <div className="mono">
                  <b>{draft.slug || 'not-set'}</b> ({slugStatus})
                </div>
              </div>
              <div>
                <span className="kicker">STORY LENGTH</span>
                <div>
                  <b>
                    {wordCount} words · {paragraphCount} paragraphs
                  </b>
                </div>
              </div>
            </div>

            <div className="ed-preflight stack" style={{ gap: 8 }}>
              <span className="kicker">EDITORIAL VERIFICATION CHECKLIST</span>
              <Check
                checked={checklist.figuresChecked}
                onChange={() => toggleChecklist('figuresChecked')}
                label="Numbers, capacities (MW / MMCFD), and currency figures verified against source"
              />
              <Check
                checked={checklist.namesChecked}
                onChange={() => toggleChecklist('namesChecked')}
                label="Institutional names, ministries, and official designations verified"
              />
              <Check
                checked={checklist.attributionKept}
                onChange={() => toggleChecklist('attributionKept')}
                label="Original source credit and photo attribution preserved"
              />
            </div>

            {publishResult && (
              <div className={`callout ${publishResult.ok ? 'good' : 'warn'}`}>
                <Icon name={publishResult.ok ? 'check' : 'info'} size={15} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  <span>{publishResult.msg}</span>
                  {publishResult.url && (
                    <div>
                      <a
                        href={publishResult.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn small primary"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, textDecoration: 'none' }}
                      >
                        <Icon name="globe" size={12} />
                        <span>View Live Article on esbpowerline.com ↗</span>
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </Dialog>
      )}
    </div>
  )
}
