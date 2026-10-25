// Editorial Desk — the ESB PowerLine CMS article editor, with the source beside it and the banner behind it.
//   Left: the original article (link, extraction report, Bengali headline/deck, figures to check, paragraphs) and a
//         "New link" tab for the next story.
//   Centre: the CMS editor — "Headline & deck", then "Story" as its own panel (Body · SEO · Social · Preview).
//   Right: the CMS sidebar — Publish, Featured image (the banner's photo slot, editable here or in Graphics),
//          Organize (category, tags, byline), and Outputs (Banner · Web article · Facebook).
//   Empty desk: a centred intake card (link / pasted Bengali / site CMS posts).

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { CSSProperties } from 'react'
import './editorial.css'
import { useEditorialStore } from './editorialStore'
import { BannerCard } from './BannerCard'
import { useWidth } from '../ui/useWidth'
import { Splitter } from '../ui/layout'
import { BN_FONTS, useBnFont } from './bnFont'
import { useBannerImage } from './useBannerImage'
import { useHeroMode } from './heroMode'
import { SeoPanel } from './SeoPanel'
import { SignInSheet } from './SignInSheet'
import { StoryQueueList } from './StoryQueueList'
import { useStoryQueue } from './storyQueue'
import { canUploadToSite, uploadBannerToSite } from './siteConnect'
import { renderBanner } from '../export'
import { suggestKeyphrases } from './seo'
import { FeaturedImage } from './FeaturedImage'
import { SitePreview, SITE_THEMES } from './SitePreview'
import type { SiteDevice, SiteTheme } from './SitePreview'
import { useShellStore } from '../shell/shellStore'
import { WorkspaceSwitcher } from '../shell/WorkspaceRail'
import { Icon } from '../ui/Icon'
import { Field, Select, Check, IconButton, MenuBar, Panel, Seg, Tabs } from '../ui/controls'
import type { MenuDef } from '../ui/controls'
import { useStore } from '../store'
import { CATEGORIES } from '../core/tokens'
import type { Assets } from '../core/render'
import { loadBaseAssets } from '../core/assets'
import { describeIntakeError, automateNewsFromUrl } from './automation'
import { autoDesk } from './deskFlag'
import { detectCategory, suggestHighlight } from '../core/newsroom'
import { extractFactTable, type FactItem } from './facts'
import { bengaliToAsciiDigits } from './bengali'
import { translateNewsArticle } from './translator'
import { AiSettingsDialog } from './AiSettingsDialog'
import { TranslateProgress } from './TranslateProgress'
import { useJobLog } from './jobLog'
import { PublishDialog } from './PublishDialog'
import type { PublishOutcome } from './PublishDialog'
import { FacebookDialog } from './FacebookDialog'
import { EngineStatus } from './EngineStatus'
import { commentOnPost, getFacebook, postBannerToFacebook } from './facebook'
import { sanitizeFacebook } from './facebookCaption'
import { openArticleForEdit } from './liveEdit'
import { aiFor, providerMeta, roleProvider } from './aiProviders'
import type { AiProviderId } from './aiProviders'
import { aiCaptions, aiSeo, articleUrl, storyCaptions, xLength } from './aiDesk'
import {
  buildCmsArticlePayload,
  insertArticleToSupabase,
  findArticle,
  siteFetch,
  SITE_BASE_URL,
  ensureFreshSession,
  openSiteCms,
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
const COLS_KEY = 'esb-banner-studio/editorial/columns'
const COLS_DEFAULT = { src: 312, side: 340 }

export function EditorialWorkspace() {
  const source = useEditorialStore((s) => s.source)
  const draft = useEditorialStore((s) => s.draft)
  const siteStatus = useEditorialStore((s) => s.siteStatus)
  const staffSession = useEditorialStore((s) => s.staffSession)
  const liveArticles = useEditorialStore((s) => s.liveArticles)
  const slugStatus = useEditorialStore((s) => s.slugStatus)
  const translationProvider = useEditorialStore((s) => s.translationProvider)

  const checkConnection = useEditorialStore((s) => s.checkConnection)
  const syncFromLiveFeed = useEditorialStore((s) => s.syncFromLiveFeed)
  const checkSlug = useEditorialStore((s) => s.checkSlug)
  const setSourceArticle = useEditorialStore((s) => s.setSourceArticle)
  const updateSourceManual = useEditorialStore((s) => s.updateSourceManual)
  const setDraftField = useEditorialStore((s) => s.setDraftField)
  const setSocialCaption = useEditorialStore((s) => s.setSocialCaption)
  const setTranslationMeta = useEditorialStore((s) => s.setTranslationMeta)
  const bannerLink = useEditorialStore((s) => s.bannerLink)
  const deskAuto = useEditorialStore((s) => s.deskAuto)
  const setDesk = useEditorialStore((s) => s.setDesk)
  const autoDetectDesk = useEditorialStore((s) => s.autoDetectDesk)

  // Graphics Studio Banner Store Companion
  const bannerContent = useStore((s) => s.doc.content)
  const theme = useStore((s) => s.theme)
  const bnFont = useBnFont((s) => s.id)
  const setBnFont = useBnFont((s) => s.set)
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
  const [leftTab, setLeftTab] = useState<'source' | 'intake' | 'stories'>('source')
  const storyCount = useStoryQueue((s) => s.stories.length)
  const [tagInput, setTagInput] = useState('')
  // A translation problem worth more than a 3-second toast: shown on the Headline & deck panel until dismissed.
  const [draftNotice, setDraftNotice] = useState<string | null>(null)
  // The source column: open by default where there is room for three columns, remembered once chosen.
  const [sourceOpen, setSourceOpenState] = useState<boolean>(() => {
    try { const v = localStorage.getItem(SOURCE_OPEN_KEY); if (v !== null) return v === '1' } catch { /* ignore */ }
    return typeof window === 'undefined' || window.innerWidth >= 1280
  })
  const setSourceOpen = (v: boolean) => { setSourceOpenState(v); try { localStorage.setItem(SOURCE_OPEN_KEY, v ? '1' : '0') } catch { /* ignore */ } }
  // Column widths, dragged like Graphics' side panels and remembered between launches.
  const [cols, setCols] = useState<{ src: number; side: number }>(() => {
    try { const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null'); if (v && typeof v.src === 'number' && typeof v.side === 'number') return v } catch { /* ignore */ }
    return COLS_DEFAULT
  })
  const wsRef = useRef<HTMLDivElement>(null)
  const deskRef = useRef<HTMLDivElement>(null)
  const liveCol = (k: 'src' | 'side') => (v: number) => deskRef.current?.style.setProperty(k === 'src' ? '--ed-src-px' : '--ed-side-px', v + 'px')
  const commitCol = (k: 'src' | 'side') => (v: number) => setCols((c) => { const n = { ...c, [k]: v }; try { localStorage.setItem(COLS_KEY, JSON.stringify(n)) } catch { /* ignore */ } return n })
  const [heroMode, setHeroMode] = useHeroMode()
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
  const webBannerUrl = useBannerImage(storyTab === 'preview' && heroMode === 'banner' ? baseAssets : null, 'web')

  // Live feed filter in intake
  const [searchQuery, setSearchQuery] = useState('')

  // Modals
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [publishingLive, setPublishingLive] = useState(false)
  const [publishResult, setPublishResult] = useState<PublishOutcome | null>(null)
  const [showFbDialog, setShowFbDialog] = useState(false)
  const [publishJobId, setPublishJobId] = useState<number | null>(null)
  const [fbCfg, setFbCfg] = useState(() => getFacebook())
  const [fbOn, setFbOn] = useState(false)
  const [editingLive, setEditingLive] = useState<string | null>(null)
  const [lastPublish, setLastPublish] = useState<{ story: string | null; ok: boolean; at: number; text: string } | null>(null)
  // the site article this story is linked to (published from here, or opened for editing) - Publish then updates it
  const activeStory = useStoryQueue((q) => q.stories.find((x) => x.id === q.activeId) ?? null)
  const linkedSlug = activeStory?.publishedSlug ?? activeStory?.publishedUrl?.match(/\/articles\/([^/?#]+)/)?.[1] ?? null
  const linked = linkedSlug ? { slug: linkedSlug, url: activeStory?.publishedUrl } : null
  const [copiedPayload, setCopiedPayload] = useState(false)

  // AI settings dialog (provider, key, model, prompt)
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const ai = useEditorialStore((s) => s.ai)
  // each job calls only the provider chosen for it, and only when that provider has a key
  const mainAi = aiFor('main', ai)
  const seoAi = aiFor('seo', ai)
  const socialAi = aiFor('social', ai)
  const aiName = providerMeta(ai.provider).name
  const aiModelLabel = ai.models[ai.provider] === 'auto' ? providerMeta(ai.provider).autoLabel.replace(/^Auto — /, '') : ai.models[ai.provider]
  const isAiProvider = (p: string | null): p is AiProviderId => !!p && p !== 'neural' && p !== 'offline'
  const [aiBusy, setAiBusy] = useState<null | 'seo' | 'social'>(null)

  // SEO and captions by the chosen provider — sanitised in aiDesk.ts to the same rules the hand-built fields follow
  const runAi = async (job: 'seo' | 'social') => {
    const active = job === 'seo' ? seoAi : socialAi
    if (!active) { setShowApiKeyModal(true); return }
    const who = providerMeta(active.provider).name
    setAiBusy(job)
    const log = useJobLog.getState()
    const jobId = log.begin(job, job === 'seo' ? 'SEO' : 'Social captions', 'Choosing the model')
    const onStep = (label: string) => log.step(jobId, label)
    try {
      const d = useEditorialStore.getState().draft
      const story = { headline: d.headline, deck: d.deck, body: d.body }
      if (job === 'seo') {
        const r = await aiSeo(active, story, onStep)
        setDraftField('focusKeyphrase', r.focusKeyphrase)
        setDraftField('focusKeywords', r.focusKeywords)
        setDraftField('metaTitle', r.metaTitle)
        setDraftField('metaDescription', r.metaDescription)
        setDraftField('slug', r.slug)
        log.finish(jobId, { by: `${who} · ${r.model}` })
        showToast(`SEO written by ${who} · ${r.model} — review it before publishing`)
      } else {
        const desk = CATEGORIES.find((c) => c.id === useStore.getState().doc.content.categoryId)?.name ?? 'Energy'
        const r = await aiCaptions(active, { ...story, slug: d.slug, desk }, onStep)
        for (const k of ['facebook', 'x', 'linkedin', 'telegram'] as const) setSocialCaption(k, r[k])
        log.finish(jobId, { by: `${who} · ${r.model}` })
        showToast(`Captions written by ${who} · ${r.model} — each links to the article`)
      }
    } catch (e) {
      log.finish(jobId, { by: who, error: (e as Error).message })
      showToast(`${who} could not finish: ${(e as Error).message}`)
    } finally {
      setAiBusy(null)
    }
  }
  const handleAiSeo = () => runAi('seo')
  const handleAiCaptions = () => runAi('social')

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
  // a story with no source yet (a headline typed in Graphics, a draft written by hand) opens the left column on the
  // link intake rather than on an empty "Original story"
  const hasSource = !!source
  useEffect(() => { if (hasStory && !hasSource) setLeftTab((t) => (t === 'source' ? 'intake' : t)) }, [hasStory, hasSource])

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
    // the story on the desk stays in the queue; the editor opens empty
    useStoryQueue.getState().newStory()
    if (bannerLink) useStore.getState().newBanner(true)
    setUrlInput('')
    setRawBengaliInput('')
    setErrorMsg(null)
    showToast('New story — the previous one is kept under Stories')
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
  const handleFetchUrl = async (overrideUrl?: string, inPlace = false) => {
    let cleanUrl = (overrideUrl ?? urlInput).trim()
    if (!cleanUrl) return
    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = `https://${cleanUrl}`
      setUrlInput(cleanUrl)
    }

    // Re-fetch of the story's own link refreshes that story; a different link starts a new one
    useStoryQueue.getState().beginStory({ inPlace })
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
      setDraftField('focusKeyphrase', (result.focusKeywords || '').split(',')[0]?.trim() ?? '')
      setDraftField('metaTitle', result.metaTitle)
      setDraftField('metaDescription', result.metaDescription)
      setDraftField('byline', result.byline)
      setDraftField('credit', result.credit)
      // the translation call also wrote the Facebook caption; X, LinkedIn and Telegram stay templated until Social > Write with AI

      setProgressStatus(null)
      const warn = result.extraction?.warnings ?? []
      setDraftNotice(result.translationNote ?? null)
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
    useStoryQueue.getState().beginStory()
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
        },
        (status) => setProgressStatus(status),
      )

      setTranslationMeta(translation.provider, translation.modelUsed)
      setDraftField('headline', translation.headline)
      setDraftField('deck', translation.deck)
      setDraftField('body', translation.body)
      setDraftField('slug', translation.slug)
      setDraftField('focusKeywords', translation.focusKeywords)
      setDraftField('focusKeyphrase', (translation.focusKeywords || '').split(',')[0]?.trim() ?? '')
      setDraftField('metaTitle', translation.metaTitle)
      setDraftField('metaDescription', translation.metaDescription)

      const detectedCat = detectCategory(`${translation.headline} ${translation.deck} ${translation.body}`) || '01'
      const hl = suggestHighlight(translation.headline)

      const templated = storyCaptions({ headline: translation.headline, deck: translation.deck, categoryId: detectedCat, slug: translation.slug })
      for (const k of ['facebook', 'x', 'linkedin', 'telegram'] as const) setSocialCaption(k, k === 'facebook' && translation.facebook ? translation.facebook : templated[k])

      useEditorialStore.getState().setDeskAuto(true)
      autoDesk(() => useStore.getState().setContent({
        categoryId: detectedCat,
        highlight: hl || useStore.getState().doc.content.highlight,
      }))

      setProgressStatus(null)
      setDraftNotice(translation.translationFailed ? 'Part of the story could not be translated — the Bengali is left in place for you to translate.' : translation.coverageWarning ?? null)
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
        },
        (status) => setProgressStatus(status),
      )
      setTranslationMeta(res.provider, res.modelUsed)
      setDraftField('headline', res.headline)
      setDraftField('deck', res.deck)
      setDraftField('body', res.body)
      setDraftField('slug', res.slug)
      setDraftField('focusKeywords', res.focusKeywords)
      setDraftField('focusKeyphrase', (res.focusKeywords || '').split(',')[0]?.trim() ?? '')
      setDraftField('metaTitle', res.metaTitle)
      setDraftField('metaDescription', res.metaDescription)
      if (res.facebook) setSocialCaption('facebook', res.facebook)

      setDraftNotice(res.translationFailed ? 'Part of the story could not be translated — the Bengali is left in place for you to translate.' : res.coverageWarning ?? null)
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
    // the whole publish is one timed job (banner upload -> site -> Facebook); its tick is red if any part failed
    const jobLog = useJobLog.getState()
    const jobId = jobLog.begin('publish', linked ? 'Updating article' : targetStatus === 'DRAFT' ? 'Saving draft' : 'Publishing', 'Checking the sign-in')
    setPublishJobId(jobId)
    let jobError: string | undefined
    let jobBy = 'esbpowerline.com'
    try {
      // a token older than an hour is renewed first, so a long editing session does not fail at the last step
      const fresh = await ensureFreshSession(staffSession)
      if (!fresh) jobError = 'Not signed in to esbpowerline.com'

      // The article's image is the 16:9 Web banner the desk made, uploaded to the site's media library — one
      // ~1920×1080 JPEG per publish, well inside Vercel's 4.5 MB body limit. When that cannot happen (browser
      // preview, photo hero chosen, upload refused) the original photo's link is used and the result says so.
      let imageUrl = bannerLeadImage || undefined
      let imageNote = ''
      if (heroMode === 'banner' && baseAssets && fresh && canUploadToSite()) {
        jobLog.step(jobId, 'Rendering the web banner')
        const blob = await renderBanner(useStore.getState().doc, 'web', baseAssets, 1, 'jpeg', 0.9).catch(() => null)
        jobLog.step(jobId, 'Uploading the banner to the media library')
        const up = blob ? await uploadBannerToSite(fresh, blob, draft.slug) : { ok: false as const, error: 'The banner could not be rendered.' }
        if (up.ok) { imageUrl = up.url; imageNote = ' Image: the Web banner, uploaded to the media library.' }
        else imageNote = ` Banner upload failed (${up.error}) — used the original photo instead.`
      } else if (heroMode === 'banner' && !canUploadToSite()) {
        imageNote = ' The browser preview cannot upload the banner, so the original photo was used.'
      }
      if (imageUrl && !/^https:\/\//.test(imageUrl)) {
        imageUrl = undefined
        imageNote = heroMode === 'banner' && !canUploadToSite()
          ? ' The browser preview cannot upload the banner and the photo is a local file, so no image was attached — add one in the CMS.'
          : ' The photo is a local file the site cannot reach, so no image was attached — add one in the CMS.'
      }

      const payload = buildCmsArticlePayload({
        headline: draft.headline,
        deck: draft.deck,
        body: draft.body,
        slug: draft.slug,
        category: catData.name,
        focusKeywords: draft.focusKeywords,
        focusKeyphrase: draft.focusKeyphrase,
        metaTitle: draft.metaTitle,
        metaDescription: draft.metaDescription,
        byline: staffSession?.name || draft.byline,
        postAsNewsDesk: draft.postAsNewsDesk,
        credit: draft.credit,
        imageAlt: draft.imageAlt,
        imageCaption: draft.imageCaption,
        imageUrl,
        status: targetStatus,
      })

      try {
        await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      } catch {}

      // A story linked to an article already on the site updates that article (its id is looked up by slug when
      // only the slug is known) instead of inserting a second row with the same slug.
      const q = useStoryQueue.getState()
      const cur = q.stories.find((x) => x.id === q.activeId)
      let updateId = cur?.publishedId
      const lookup = cur?.publishedSlug ?? cur?.publishedUrl?.match(/\/articles\/([^/?#]+)/)?.[1]
      if (!updateId && lookup) {
        updateId = (await findArticle({ slug: lookup }, fresh))?.id
        if (!updateId) {
          jobError = `The linked article "${lookup}" was not found on the site (it may have been deleted, or this account cannot read it). Open the story fresh, or change the slug to publish a new article.`
          setPublishResult({ ok: false, msg: jobError })
          return
        }
      }
      jobLog.step(jobId, updateId ? 'Updating the article on esbpowerline.com' : targetStatus === 'DRAFT' ? 'Saving the draft to esbpowerline.com' : 'Publishing the article to esbpowerline.com')
      const result = await insertArticleToSupabase(payload, fresh, { updateId })

      if (result.success) {
        const did = result.updated ? 'Updated' : targetStatus === 'PUBLISHED' ? 'Published' : 'Saved as draft'
        let fbNote = ''
        let fbUrl: string | undefined
        if (targetStatus === 'PUBLISHED' && result.liveUrl) {
          // arrival: the public page answers (a few tries - the site may take a moment to serve a new page)
          jobLog.step(jobId, 'Checking the article is live on the site')
          let live = false
          for (let i = 0; i < 4 && !live; i++) { live = (await siteFetch(`${result.liveUrl}?_=${Date.now()}`, 6000)).ok; if (!live) await new Promise((r) => setTimeout(r, 1500)) }
          imageNote += live ? ' The page is live.' : ' Saved, but the public page did not answer yet — it can take a minute to appear.'
        }
        if (targetStatus === 'PUBLISHED' && fbOn && fbCfg && baseAssets) {
          jobLog.step(jobId, 'Rendering the Facebook banner')
          const photo = await renderBanner(useStore.getState().doc, 'fb45', baseAssets, 1, 'jpeg', 0.9).catch(() => null)
          const link = result.liveUrl ?? ''
          // the caption carries no link (a link-free, short caption is the point); the article link is the first comment
          const caption = sanitizeFacebook(draft.social.facebook, draft.headline).trim() || draft.headline
          const post = photo ? await postBannerToFacebook(fbCfg, photo, caption) : { ok: false as const, error: 'The banner could not be rendered.' }
          fbNote = post.ok ? ` Posted to Facebook (${fbCfg.pageName || 'your Page'}).` : ` Facebook post failed: ${post.error}`
          if (post.ok) {
            jobBy += ' + Facebook'
            fbUrl = post.url
            if (link) {
              jobLog.step(jobId, 'Adding the article link as a comment')
              const c = await commentOnPost(fbCfg, post.postId, `Full story: ${link}`)
              fbNote += c.ok ? ' Link added as the first comment — pin it on Facebook.' : ` The link comment failed: ${c.error}`
              if (!c.ok) jobError = `Posted to Facebook, but the link comment failed: ${c.error}`
            }
          } else jobError = `The site was saved, but Facebook failed: ${post.error}`
        } else if (targetStatus === 'PUBLISHED') {
          fbNote = fbCfg ? ' Facebook: not posted (the Facebook switch was off).' : ' Facebook: not connected.'
        }
        setPublishResult({ ok: !jobError, msg: `${did} on esbpowerline.com.` + imageNote + fbNote, url: result.liveUrl, fbUrl })
        setLastPublish({ story: useStoryQueue.getState().activeId, ok: !jobError, at: Date.now(), text: `${did} on the site` + (fbNote.includes('Posted') ? ' · posted to Facebook' : fbNote.includes('failed') ? ' · Facebook failed' : fbNote.includes('not') ? ' · not on Facebook' : '') })
        showToast(targetStatus === 'PUBLISHED' ? `Story ${result.updated ? 'updated' : 'published'} on esbpowerline.com` : 'Draft saved to esbpowerline.com')
        if (targetStatus === 'PUBLISHED') useStoryQueue.getState().markPublished({ url: result.liveUrl, id: result.articleId, slug: result.slug })
        else if (result.updated) useStoryQueue.getState().linkArticle({ url: result.liveUrl, id: result.articleId, slug: result.slug ?? draft.slug })
        syncFromLiveFeed().catch(() => {})
      } else {
        const taken = /already exists/i.test(result.error ?? '')
        const existing = taken && !updateId ? await findArticle({ slug: payload.slug }, fresh) : null
        jobError = result.error || 'The article could not be saved to esbpowerline.com.'
        setPublishResult({ ok: false, msg: jobError, existingSlug: existing?.slug })
        setLastPublish({ story: useStoryQueue.getState().activeId, ok: false, at: Date.now(), text: 'Not saved — ' + jobError })
        showToast('The site refused the article - see the publish sheet')
      }
    } catch (err: any) {
      jobError = err.message || 'Publish error'
      setPublishResult({ ok: false, msg: jobError ?? 'Publish error' })
    } finally {
      jobLog.finish(jobId, { by: jobBy, error: jobError })
      setPublishingLive(false)
    }
  }

  // Open an article that is already on the site for editing: its real body and SEO, linked so Publish updates it
  const handleEditLive = async (art: Parameters<typeof openArticleForEdit>[0]) => {
    setEditingLive(art.slug)
    try {
      const r = await openArticleForEdit(art)
      if (bannerLink) useEditorialStore.getState().applyDraftToBanner()
      setLeftTab('source')
      showToast(r.exact ? 'Opened for editing - Publish will update this article' : 'Opened from the public page (sign in to load the full record) - Publish will update this article')
    } finally {
      setEditingLive(null)
    }
  }

  // The site status is live: re-checked every 20 s, when the window returns, and when the network changes
  useEffect(() => {
    const run = () => { if (document.visibilityState !== 'hidden') void checkConnection() }
    const t = setInterval(run, 20000)
    window.addEventListener('online', run); window.addEventListener('offline', run); window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', run)
    return () => { clearInterval(t); window.removeEventListener('online', run); window.removeEventListener('offline', run); window.removeEventListener('focus', run); document.removeEventListener('visibilitychange', run) }
  }, [checkConnection])
  // signing in or out changes what the database check can prove
  useEffect(() => { void checkConnection() }, [staffSession?.token, checkConnection])

  const handleOpenInSiteCms = () => {
    void openSiteCms(staffSession, '/cms/articles/new').then((how) => showToast(how === 'signed-in' ? 'Opened the CMS — signed in as you' : 'Opened the CMS in your browser'))
  }

  const handleCopyCmsPayload = () => {
    const payload = buildCmsArticlePayload({
      headline: draft.headline,
      deck: draft.deck,
      body: draft.body,
      slug: draft.slug,
      category: catData.name,
      focusKeywords: draft.focusKeywords,
      focusKeyphrase: draft.focusKeyphrase,
      metaTitle: draft.metaTitle,
      metaDescription: draft.metaDescription,
      byline: staffSession?.name || draft.byline || 'Mehedi Hasan Hamim',
      postAsNewsDesk: draft.postAsNewsDesk,
      credit: draft.credit,
      imageAlt: draft.imageAlt,
      imageCaption: draft.imageCaption,
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
    if (!source) return 'No source yet'
    if (!source.url || source.url === 'pasted-text') return 'Pasted text'
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
  const suggestTags = () => suggestKeyphrases(draft.headline, draft.deck, draft.body, 6).map((k) => k.phrase)
  const openPublish = () => { setPublishResult(null); setPublishJobId(null); setFbCfg(getFacebook()); setFbOn(!linked && !!getFacebook()); setShowPublishModal(true) }

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
                  <button type="button" className="btn sm" onClick={() => void handleEditLive(art)} disabled={editingLive === art.slug}>{editingLive === art.slug ? 'Opening…' : 'Edit'}</button>
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
      { label: 'Load another link', icon: 'link', disabled: !hasStory, onClick: () => { setSourceOpen(true); setLeftTab('intake'); setLauncherTab('url') } },
      { label: 'Re-translate the source', icon: 'refresh', disabled: !source || translating, onClick: () => void handleRetranslateSource() },
      { divider: true },
      { label: 'Copy CMS JSON', icon: 'copy', disabled: !draft.headline.trim(), onClick: handleCopyCmsPayload },
      { label: 'Review & publish', icon: 'upload', disabled: !draft.headline.trim(), onClick: openPublish },
    ] },
    { label: 'Site', items: [
      { label: 'Sync stories from esbpowerline.com', icon: 'refresh', onClick: () => void handleSyncFeed() },
      { label: 'Open the site CMS', icon: 'externalLink', onClick: handleOpenInSiteCms },
      { divider: true },
      { label: staffSession ? `Signed in as ${staffSession.name}` : 'Staff sign-in', icon: 'user', onClick: () => setShowLoginModal(true) },
      { label: mainAi ? `AI: ${aiName} (on)` : 'AI keys and roles', icon: 'sparkle', onClick: () => setShowApiKeyModal(true) },
    ] },
    { label: 'View', items: [
      { label: 'Source column', checked: sourceOpen, disabled: !hasStory, onClick: () => setSourceOpen(!sourceOpen) },
      { divider: true },
      { label: 'Story body', checked: storyTab === 'body', disabled: !hasStory, onClick: () => setStoryTab('body') },
      { label: 'SEO', checked: storyTab === 'seo', disabled: !hasStory, onClick: () => setStoryTab('seo') },
      { label: 'Social captions', checked: storyTab === 'social', disabled: !hasStory, onClick: () => setStoryTab('social') },
      { label: 'Article preview', checked: storyTab === 'preview', disabled: !hasStory, onClick: () => setStoryTab('preview') },
      { label: 'Open the banner in Graphics', icon: 'layers', onClick: () => useShellStore.getState().openGraphicsFrom('editorial', null) },
      { divider: true },
      { heading: 'Appearance' },
      { label: 'Light', icon: 'sun', checked: theme !== 'dark', onClick: () => useStore.getState().setTheme('light') },
      { label: 'Dark', icon: 'moon', checked: theme === 'dark', onClick: () => useStore.getState().setTheme('dark') },
      { divider: true },
      { heading: 'Bengali reading font' },
      ...BN_FONTS.map((f) => ({ label: f.label, hint: f.note, checked: bnFont === f.id, onClick: () => setBnFont(f.id) })),
    ] },
  ]

  return (
    <div ref={wsRef} className={'editorial-workspace' + (hasStory && sourceOpen ? ' source-open' : '')} style={{ ['--cat' as string]: catData.accent, ['--cat-ink' as string]: catData.chipText } as CSSProperties}>
      {/* Header: the same bar Graphics uses — brand, menus, a centred tool group, quiet icon pills, one primary action. */}
      <header className="topbar ed-head">
        <WorkspaceSwitcher />
        <MenuBar menus={menus} />
        <div className="spacer" />
        <div className="fmtgroup ed-head-group">
          <IconButton icon="refresh" tip={syncing ? 'Syncing…' : 'Sync published stories from esbpowerline.com'} onClick={handleSyncFeed} disabled={syncing} className={syncing ? 'spin' : ''} />
          {hasStory && (
            <button type="button" className={'pv-btn' + (sourceOpen ? ' on' : '')} onClick={() => setSourceOpen(!sourceOpen)} aria-pressed={sourceOpen} data-tip={sourceOpen ? `Hide the source column — ${sourceHost}` : `Show the original article — ${sourceHost}`}>
              <Icon name="newspaper" size={15} />
              <span className="ed-head-host">{sourceHost}</span>
              <span className="dpc-tag">{source?.paragraphs.length ?? paragraphCount} ¶</span>
            </button>
          )}
          {hasStory && source && (
            <button type="button" className="pv-btn" onClick={handleRetranslateSource} disabled={translating} aria-label="Re-translate" data-tip={mainAi ? `Translate the original story again with ${aiName} · ${aiModelLabel}` : 'Translate the original story again (free machine translation — add an AI key for better results)'}>
              <Icon name="refresh" size={14} />
              <span className="ed-retranslate-label">{translating ? 'Translating…' : 'Re-translate'}</span>
            </button>
          )}
        </div>
        <div className="spacer" />
        <TranslateProgress status={progressStatus} />
        <button type="button" className={'ed-ai-chip' + (mainAi ? ' on' : '')} data-provider={ai.provider} onClick={() => setShowApiKeyModal(true)} aria-label="AI keys and roles" data-tip={mainAi ? `Main: ${aiName} · ${aiModelLabel}${seoAi ? ` — SEO: ${providerMeta(seoAi.provider).name}` : ''}${socialAi ? ` — Social: ${providerMeta(socialAi.provider).name}` : ''}. Click to change` : 'AI is off — add a Gemini, Claude, OpenAI or OpenRouter key'}>
          <Icon name={mainAi ? 'sparkle' : 'link'} size={14} />
          <span className="ed-ai-label">{mainAi ? aiName : 'Connect AI'}</span>
        </button>
        <button type="button" className={'ed-account' + (staffSession ? ' in' : '')} onClick={() => setShowLoginModal(true)} aria-label={staffSession ? 'Staff sign-in' : 'Staff sign-in'} data-tip={staffSession ? `${staffSession.name} · ${staffSession.email} — account and connection check` : 'Sign in with your esbpowerline.com newsroom account'}>
          {staffSession
            ? <><span className="ed-avatar">{(staffSession.name || staffSession.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')}</span></>
            : <><Icon name="user" size={14} /><span className="ed-account-label">Sign in</span></>}
        </button>
        <button type="button" className="btn primary" onClick={openPublish} disabled={!draft.headline.trim()} data-tip="Review the checklist and publish to esbpowerline.com">
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
          {storyCount > 0 && (
            <div className="ed-launcher-card ed-launcher-queue">
              <div className="ed-launcher-qhead"><h3>Continue a story</h3><span>{storyCount} on the desk</span></div>
              <StoryQueueList compact />
            </div>
          )}
          {toastMsg && <div className="toast" onClick={() => setToastMsg(null)}><Icon name="info" size={15} />{toastMsg}</div>}
        </div>
      ) : (
        <div ref={deskRef} className="ed-desk" style={{ ['--ed-src-px' as string]: cols.src + 'px', ['--ed-side-px' as string]: cols.side + 'px' } as CSSProperties}>
          {/* LEFT — the original article, untouched, beside the copy made from it */}
          <aside className="left ed-src" aria-label="Original source">
            <Tabs<'source' | 'intake' | 'stories'>
              value={leftTab}
              onChange={setLeftTab}
              options={[{ value: 'source', icon: 'newspaper', label: 'Source' }, { value: 'stories', icon: 'layers', label: storyCount > 1 ? `Stories · ${storyCount}` : 'Stories' }, { value: 'intake', icon: 'link', label: 'New link' }]}
            />
            <div className="scroll ed-src-scroll">
              {leftTab === 'intake' ? (
                <div className="ed-src-intake">{intakeForm(true)}</div>
              ) : leftTab === 'stories' ? (
                <div className="ed-src-intake"><StoryQueueList /></div>
              ) : (
                <>
                  <Panel id="ed-src-link" icon="link" defaultOpen={false} title="Original link" sub={sourceHost} persist={false} actions={
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
                          <button type="button" className="btn xs" onClick={() => void handleFetchUrl(sourceUrl, true)} disabled={loading} title="Fetch and translate this link again"><Icon name="refresh" size={12} /><span>{loading ? 'Fetching…' : 'Re-fetch'}</span></button>
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
                    <Panel id="ed-src-edit" icon="edit" title="Edit source text" persist={false}>
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
                      <Panel id="ed-src-head" icon="newspaper" defaultOpen={false} title="Headline & deck" sub={languageLabel ?? undefined}>
                        <div className="ed-source-reader">
                          <textarea id="source-title-input" className="source-reader-title-input" readOnly rows={2} value={source?.title || ''} title="Original headline" />
                          {source?.deck && <p className="source-reader-deck">{source.deck}</p>}
                        </div>
                      </Panel>

                      {factTable.length > 0 && (
                        <Panel id="ed-src-facts" icon="check" defaultOpen={false} title="Facts to check" sub={`${factTable.length}`}>
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

                      <Panel id="ed-src-body" icon="type" title="Original story" sub={`${source?.paragraphs.length || 0} ¶`}>
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
            <Splitter axis="vert" side="r" label="Resize the source column" value={cols.src} min={264} max={520} reset={COLS_DEFAULT.src} onLive={liveCol('src')} onCommit={commitCol('src')} root={() => wsRef.current} />
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
                    {isAiProvider(translationProvider) ? `${providerMeta(translationProvider).name} draft` : translationProvider === 'offline' ? 'Needs translation' : 'Machine draft'}
                  </span>
                </header>
                <div className="ed-card-body">
                  {draftNotice && (
                    <div className="callout warn ed-draft-notice" role="status">
                      <Icon name="info" size={14} />
                      <span>{draftNotice}</span>
                      <button type="button" className="btn-link" onClick={() => setDraftNotice(null)}>Dismiss</button>
                    </div>
                  )}
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
                  <SeoPanel hasImage={!!bannerLeadImage} slugStatus={slugStatus} onCheckSlug={() => void checkSlug(draft.slug)} onAiSeo={() => void handleAiSeo()} aiBusy={aiBusy === 'seo'} aiProvider={seoAi?.provider ?? null} />
                )}

                {storyTab === 'social' && (
                  <div className="ed-card-body ed-social">
                    <div className="ed-social-link">
                      <Icon name="link" size={14} />
                      <span className="ed-social-url" title={articleUrl(draft.slug)}>{articleUrl(draft.slug)}</span>
                      <button type="button" className="btn sm" onClick={() => { void navigator.clipboard.writeText(articleUrl(draft.slug)); showToast('Article link copied') }} data-tip="Copy the article's link on esbpowerline.com">
                        <Icon name="copy" size={13} /><span>Copy link</span>
                      </button>
                    </div>
                    {!draft.slug.trim() && <p className="hint">Set the slug under SEO first — every caption links to this address.</p>}
                    <div className="ed-body-tools">
                      <Seg<'facebook' | 'x' | 'linkedin' | 'telegram'>
                        value={activeSocialTab}
                        onChange={setActiveSocialTab}
                        options={[{ value: 'facebook', label: 'Facebook' }, { value: 'x', label: 'X' }, { value: 'linkedin', label: 'LinkedIn' }, { value: 'telegram', label: 'Telegram' }]}
                      />
                      <span className={'ed-budget-counter' + (activeSocialTab === 'x' && xLength(draft.social.x || '') > 280 ? ' over' : '')}>
                        {activeSocialTab === 'x' ? `${xLength(draft.social.x || '')} / 280` : `${(draft.social[activeSocialTab] || '').length} chars`}
                      </span>
                      <div className="spacer" />
                      <button type="button" className="btn sm ai-btn" data-provider={socialAi?.provider} onClick={() => void handleAiCaptions()} disabled={!!aiBusy || !draft.headline.trim()} data-tip={socialAi ? `Write all four captions with ${providerMeta(socialAi.provider).name}, from the story, each ending with the article link` : `Add a ${providerMeta(roleProvider(ai, 'social')).name} key to write captions from the story`}>
                        <Icon name="sparkle" size={13} className={aiBusy === 'social' ? 'spin' : ''} />
                        <span>{aiBusy === 'social' ? 'Writing…' : 'Write with AI'}</span>
                      </button>
                    </div>
                    <textarea className="ed-input ed-input-social" rows={7} value={draft.social[activeSocialTab] || ''} onChange={(e) => setSocialCaption(activeSocialTab, e.target.value)} />
                    <div className="ed-card-actions">
                      {!(draft.social[activeSocialTab] || '').includes(articleUrl(draft.slug)) && draft.slug.trim() && (
                        <button type="button" className="btn sm" onClick={() => setSocialCaption(activeSocialTab, `${(draft.social[activeSocialTab] || '').trim()}\n\n${articleUrl(draft.slug)}`.trim())} data-tip="Add the article link to the end of this caption">
                          <Icon name="link" size={13} /><span>Add link</span>
                        </button>
                      )}
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
                      <Seg<'banner' | 'photo'> value={heroMode} onChange={setHeroMode} options={[{ value: 'banner', label: 'Hero: Web banner' }, { value: 'photo', label: 'Hero: photo' }]} />
                    </div>
                    <SitePreview
                      theme={previewTheme}
                      device={previewDevice}
                      availableWidth={Math.max(280, previewHostW - 32)}
                      title={draft.headline}
                      excerpt={draft.deck}
                      slug={draft.slug}
                      category={catData.name}
                      author={draft.postAsNewsDesk ? 'ESB News Desk' : (staffSession?.name || draft.byline || 'ESB PowerLine')}
                      date={previewDate}
                      readTime={readTimeMin}
                      heroUrl={heroMode === 'banner' ? webBannerUrl : bannerLeadImage}
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
            <Splitter axis="vert" side="l" label="Resize the sidebar" value={cols.side} min={280} max={560} reset={COLS_DEFAULT.side} onLive={liveCol('side')} onCommit={commitCol('side')} root={() => wsRef.current} />
            <div className="scroll ed-side-scroll">
            <section className="ed-card">
              <header className="ed-card-h"><span className="ed-card-ic"><Icon name="upload" size={15} /></span><h3>Publish</h3><span className={'ed-card-tag ' + (linked ? 'live' : '')}>{linked ? 'Live' : 'Draft'}</span></header>
              <dl className="ed-kv">
                <dt>Website</dt>
                <dd><span className={`site-dot ${siteStatus.connected ? 'online' : 'offline'}`} />{linked ? 'Live — Publish will update it' : siteStatus.connected ? 'Ready to publish' : 'Offline'}</dd>
                <dt>Facebook</dt>
                <dd><span className={`site-dot ${fbCfg ? 'online' : 'offline'}`} />{fbCfg ? fbCfg.pageName || 'Connected' : <button type="button" className="btn-link" onClick={() => setShowFbDialog(true)}>Connect a Page</button>}</dd>
                <dt>Signed in</dt>
                <dd>{staffSession ? staffSession.name : <button type="button" className="btn-link" onClick={() => setShowLoginModal(true)}>Sign in</button>}</dd>
              </dl>
              {lastPublish && lastPublish.story === (activeStory?.id ?? null) && (
                <p className={'ed-last ' + (lastPublish.ok ? 'ok' : 'bad')}><Icon name={lastPublish.ok ? 'check' : 'info'} size={12} /><span>{lastPublish.text} · {new Date(lastPublish.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></p>
              )}
              <button type="button" className="btn primary ed-publish-btn" onClick={openPublish} disabled={!draft.headline.trim()}>
                <Icon name="upload" size={15} />
                <span>{linked ? 'Review & update' : 'Review & publish'}</span>
              </button>
            </section>

            <section className="ed-card">
              <header className="ed-card-h"><span className="ed-card-ic"><Icon name="image" size={15} /></span><h3>Banner</h3></header>
              <BannerCard base={baseAssets} heroMode={heroMode} onHeroMode={setHeroMode} onToast={showToast} />
              <details className="ed-more">
                <summary>Photo, credit &amp; alt text</summary>
                <FeaturedImage onToast={showToast} />
              </details>
            </section>

            <section className="ed-card">
              <header className="ed-card-h"><span className="ed-card-ic"><Icon name="folder" size={15} /></span><h3>Details</h3><span className="ed-card-tag">{catData.name}</span></header>
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
              <Check checked={!!draft.postAsNewsDesk} onChange={(v) => setDraftField('postAsNewsDesk', v)} label="Post as ESB News Desk" hint="Credited to the desk instead of the signed-in editor." />
            </section>
            </div>
          </aside>
        </div>
      )}

      {/* =========================================================================
          3. BOTTOM STATUS BAR — Minimal & quiet (Requirement 7)
          ========================================================================= */}
      <footer className="statusbar ed-statusbar">
        <button type="button" className={'sb-cms ' + (siteStatus.connected ? 'on' : 'off')} onClick={() => setShowLoginModal(true)}
          data-tip={`${siteStatus.statusText || (siteStatus.connected ? 'Connected' : 'Not reachable')} · checked ${siteStatus.lastChecked || 'now'} — open the connection check`}>
          <span className="sb-k">CMS</span>
          <span className="sb-pill"><i className="sb-dot" aria-hidden />{siteStatus.connected ? `Connected as ${staffSession?.name || 'Mehedi Hasan Hamim'} · ${siteStatus.latencyMs} ms` : 'Disconnected'}</span>
        </button>
        <div className="sep" />
        <EngineStatus ai={ai} offline={translationProvider === 'offline'} onAddKey={() => setShowApiKeyModal(true)} />
        <div className="spacer" />
        <span>
          {wordCount} words · ~{readTimeMin} min read
        </span>
      </footer>

      {/* =========================================================================
          4. DIALOGS (Staff Login, Live Publish to CMS, AI settings)
          ========================================================================= */}

      {/* Staff Authentication Dialog */}
      {showLoginModal && <SignInSheet onClose={() => setShowLoginModal(false)} onToast={showToast} />}

      {showApiKeyModal && <AiSettingsDialog onClose={() => setShowApiKeyModal(false)} onToast={showToast} />}

      {/* Review & publish */}
      {showPublishModal && (
        <PublishDialog
          draft={draft}
          words={wordCount}
          paragraphs={paragraphCount}
          slugStatus={slugStatus}
          base={baseAssets}
          heroMode={heroMode}
          onHeroMode={setHeroMode}
          photoUrl={bannerLeadImage}
          updating={linked}
          busy={publishingLive}
          result={publishResult}
          jobId={publishJobId}
          fbPage={fbCfg ? fbCfg.pageName || fbCfg.pageId : null}
          fbOn={fbOn}
          onFbOn={setFbOn}
          onFbConnect={() => setShowFbDialog(true)}
          onCopyJson={handleCopyCmsPayload}
          copied={copiedPayload}
          onOpenCms={handleOpenInSiteCms}
          onPublish={(st) => void handleLivePublishToCms(st)}
          onUpdateExisting={(slug) => { useStoryQueue.getState().linkArticle({ slug, url: `${SITE_BASE_URL}/articles/${slug}` }); void handleLivePublishToCms('PUBLISHED') }}
          onClose={() => setShowPublishModal(false)}
        />
      )}
      {showFbDialog && <FacebookDialog onClose={() => setShowFbDialog(false)} onChange={(on) => { setFbCfg(getFacebook()); setFbOn(on && !linked) }} />}
    </div>
  )
}
