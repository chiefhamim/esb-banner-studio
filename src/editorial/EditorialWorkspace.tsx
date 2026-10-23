// Quiet Studio — Official Newsroom Editorial Desk for ESB PowerLine
// Reimagined Story Document Architecture:
//   Left Column: Source Reader (Bengali Hind Siliguri, inline fact tokens, media, optional edit mode)
//   Center Column: Story Document (Headline 26px semibold, Deck 15px, Body 15/1.65 68ch with inline green/amber fact verification, collapsed Story Details)
//   Right Rail: Companion Live Preview (Tabs: Banner 4:5 · Web Article · Facebook Feed)
//   Empty State: Focused Intake Launcher Card (URL / Paste Bengali / Site CMS Posts) -> Collapses to Source Chip in topbar once loaded.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useEditorialStore } from './editorialStore'
import { GraphicsRail } from './GraphicsRail'
import { Icon } from '../ui/Icon'
import { Field, Select, Check, Dialog, IconButton } from '../ui/controls'
import { useStore } from '../store'
import { CATEGORIES } from '../core/tokens'
import type { Assets } from '../core/render'
import { loadBaseAssets } from '../core/assets'
import { describeIntakeError, automateNewsFromUrl, importImageToBanner } from './automation'
import { autoDesk } from './deskFlag'
import { detectCategory, generatePlatformCaption, suggestHighlight } from '../core/newsroom'
import { extractFactTable, type FactItem } from './facts'
import { bengaliToAsciiDigits } from './bengali'
import {
  translateNewsArticle,
  balanceHeadlineBreaks,
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

  // Sector Desk Options
  const deskOptions = useMemo(
    () => CATEGORIES.map((c) => ({ value: c.id, label: `${c.id} · ${c.name}` })),
    [],
  )

  // Trucent headline word & break calculations
  const headlineWords = useMemo(() => {
    return draft.headline ? draft.headline.split(/\s+/).filter(Boolean) : []
  }, [draft.headline])

  const headlineBreaks = useMemo(() => {
    const breaks: number[] = []
    if (!draft.headline) return breaks
    const rawLines = draft.headline.split('\n')
    let wordIndex = 0
    for (let i = 0; i < rawLines.length - 1; i++) {
      const count = rawLines[i].trim().split(/\s+/).filter(Boolean).length
      wordIndex += count
      if (wordIndex > 0) {
        breaks.push(wordIndex - 1)
      }
    }
    return breaks
  }, [draft.headline])

  const handleToggleBreakAt = (wordIdx: number) => {
    const words = draft.headline.replace(/\n/g, ' ').split(/\s+/).filter(Boolean)
    if (words.length <= 1) return

    const currentBreaks = new Set(headlineBreaks)
    if (currentBreaks.has(wordIdx)) {
      currentBreaks.delete(wordIdx)
    } else {
      currentBreaks.add(wordIdx)
    }

    let reconstructed = ''
    words.forEach((w, idx) => {
      reconstructed += w
      if (idx < words.length - 1) {
        reconstructed += currentBreaks.has(idx) ? '\n' : ' '
      }
    })
    setDraftField('headline', reconstructed)
  }

  const handleAutoBalance = () => {
    const balanced = balanceHeadlineBreaks(draft.headline)
    setDraftField('headline', balanced)
    showToast('Headline line breaks auto-balanced')
  }

  const handleClearBreaks = () => {
    const flat = draft.headline.replace(/\r/g, '').replace(/\n+/g, ' ').trim()
    setDraftField('headline', flat)
    showToast('Headline reset to flat line')
  }

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

  return (
    <div className="editorial-workspace">
      {/* =========================================================================
          1. TOP BAR — Minimal, quiet, and uncluttered
          ========================================================================= */}
      <header className="ed-topbar">
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <div className="row" style={{ gap: 6 }}>
            <span className="ed-topbar-title">Editorial Desk</span>
          </div>

          {/* Telemetry pill */}
          <div
            className="ed-site-pill"
            onClick={() => setShowLoginModal(true)}
            title="Click to view live site connection status or sign in"
          >
            <span className={`site-dot ${siteStatus.connected ? 'online' : 'offline'}`} />
            <span className="site-host">esbpowerline.com</span>
            <span className="site-state">
              {siteStatus.connected ? `${siteStatus.latencyMs}ms` : 'offline'}
            </span>
          </div>

          {/* Source Chip when story is loaded */}
          {hasStory && (
            <div className="ed-source-chip">
              <Icon name="newspaper" size={13} />
              <span><b>{sourceHost}</b></span>
              <span>· {paragraphCount} paras</span>
              {source?.images && source.images.length > 0 && (
                <span>· {source.images.length} photos</span>
              )}
              <button
                type="button"
                className="btn xs ghost"
                onClick={handleRetranslateSource}
                disabled={translating}
                title="Re-translate original story into English"
              >
                {translating ? 'Translating…' : 'Re-translate'}
              </button>
            </div>
          )}
        </div>

        {/* Progress or Toast notifications */}
        {progressStatus && (
          <div className="ed-topbar-progress">
            <span className="pulse-dot" />
            <span>{progressStatus}</span>
          </div>
        )}

        {toastMsg && (
          <div className="ed-toast">
            <span>{toastMsg}</span>
          </div>
        )}

        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <IconButton
            icon="plus"
            tip="Start a new story intake"
            onClick={handleNewStory}
          />
          <IconButton
            icon="refresh"
            tip="Sync articles from esbpowerline.com"
            onClick={handleSyncFeed}
            disabled={syncing}
          />
          <IconButton
            icon="sparkle"
            tip={apiKey ? 'Gemini 2.5 Active' : 'Configure Gemini API Key'}
            active={!!apiKey}
            onClick={() => setShowApiKeyModal(true)}
          />
          <IconButton
            icon="user"
            tip={staffSession ? `Signed in as ${staffSession.name}` : 'Staff Login'}
            active={!!staffSession}
            onClick={() => setShowLoginModal(true)}
          />

          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setPublishResult(null)
              setShowPublishModal(true)
            }}
            disabled={!draft.headline.trim()}
            title="Review editorial checklist and publish to esbpowerline.com CMS"
          >
            <Icon name="upload" size={14} />
            <span>Publish</span>
          </button>
        </div>
      </header>

      {/* =========================================================================
          2. WORKSPACE BODY — Empty Launcher State OR 3-Column Desk
          ========================================================================= */}
      {!hasStory ? (
        /* -------------------------------------------------------------
           EMPTY DESK: Focused Intake Launcher Card
           ------------------------------------------------------------- */
        <div className="ed-launcher-wrap">
          <div className="ed-launcher-card">
            <div className="ed-launcher-hero">
              <h2>Editorial Story Desk</h2>
              <p>
                Translate Bengali reporting into natural newsroom English, verify technical facts,
                and publish directly to esbpowerline.com CMS.
              </p>
            </div>

            {/* Launcher Intake Tabs */}
            <div className="ed-launcher-tabs">
              <button
                type="button"
                className={`ed-launcher-tab-btn ${launcherTab === 'url' ? 'active' : ''}`}
                onClick={() => setLauncherTab('url')}
              >
                <Icon name="link" size={14} />
                <span>Paste Story Link</span>
              </button>
              <button
                type="button"
                className={`ed-launcher-tab-btn ${launcherTab === 'paste' ? 'active' : ''}`}
                onClick={() => setLauncherTab('paste')}
              >
                <Icon name="edit" size={14} />
                <span>Paste Bengali Story</span>
              </button>
              <button
                type="button"
                className={`ed-launcher-tab-btn ${launcherTab === 'live_feed' ? 'active' : ''}`}
                onClick={() => setLauncherTab('live_feed')}
              >
                <Icon name="globe" size={14} />
                <span>Site CMS Posts ({liveArticles.length})</span>
              </button>
            </div>

            {/* Tab 1: URL Intake */}
            {launcherTab === 'url' && (
              <div className="stack" style={{ gap: 14 }}>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    type="url"
                    className="ed-url-input"
                    style={{ height: 42, fontSize: 14 }}
                    placeholder="https://bonikbarta.net/news/... or prothomalo.com/..."
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleFetchUrl()}
                  />
                  <button
                    type="button"
                    className="btn primary"
                    style={{ height: 42, padding: '0 20px', fontSize: 13 }}
                    onClick={() => handleFetchUrl()}
                    disabled={loading || !urlInput.trim()}
                  >
                    <Icon name={loading ? 'refresh' : 'sparkle'} size={14} />
                    <span>{loading ? 'Extracting…' : 'Fetch & Auto-Translate'}</span>
                  </button>
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <span className="kicker" style={{ alignSelf: 'center', marginRight: 4 }}>SAMPLE NEWS:</span>
                  <button
                    type="button"
                    className="btn xs ghost"
                    onClick={() => {
                      setUrlInput('https://bonikbarta.net/home/news_description/365518/drilling-two-new-wells')
                      void handleFetchUrl('https://bonikbarta.net/home/news_description/365518/drilling-two-new-wells')
                    }}
                  >
                    Bonik Barta
                  </button>
                  <button
                    type="button"
                    className="btn xs ghost"
                    onClick={() => {
                      setUrlInput('https://www.prothomalo.com/business/petrobangla-gas-well-drilling')
                      void handleFetchUrl('https://www.prothomalo.com/business/petrobangla-gas-well-drilling')
                    }}
                  >
                    Prothom Alo
                  </button>
                  <button
                    type="button"
                    className="btn xs ghost"
                    onClick={() => {
                      setUrlInput('https://www.thedailystar.net/business/economy/gas-exploration-drilling')
                      void handleFetchUrl('https://www.thedailystar.net/business/economy/gas-exploration-drilling')
                    }}
                  >
                    Daily Star
                  </button>
                </div>
              </div>
            )}

            {/* Tab 2: Bengali Story Paste */}
            {launcherTab === 'paste' && (
              <div className="stack" style={{ gap: 12 }}>
                <textarea
                  className="ed-paste-area"
                  style={{ minHeight: 180, fontSize: 14 }}
                  placeholder="Paste Bengali headline and body here..."
                  value={rawBengaliInput}
                  onChange={(e) => setRawBengaliInput(e.target.value)}
                />
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {rawBengaliInput.trim().length} characters
                  </span>
                  <button
                    type="button"
                    className="btn primary"
                    style={{ height: 38, padding: '0 18px' }}
                    onClick={handleTranslateRawBengali}
                    disabled={translating || !rawBengaliInput.trim()}
                  >
                    <Icon name={translating ? 'refresh' : 'sparkle'} size={14} />
                    <span>{translating ? 'Translating…' : 'Auto-Translate & Populate'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Tab 3: Site CMS Posts */}
            {launcherTab === 'live_feed' && (
              <div className="stack" style={{ gap: 10, maxHeight: 380, overflowY: 'auto' }}>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    type="text"
                    className="ed-url-input"
                    placeholder="Filter stories by keyword..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <button type="button" className="btn sm" onClick={handleSyncFeed} disabled={syncing}>
                    Sync Feed
                  </button>
                </div>
                {filteredLiveArticles.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-3)' }}>
                    No published stories found matching query.
                  </div>
                ) : (
                  filteredLiveArticles.slice(0, 15).map((art) => (
                    <div
                      key={art.slug}
                      style={{
                        padding: '10px 14px',
                        background: 'var(--bg-1)',
                        border: '1px solid var(--line-2)',
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <b style={{ fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {art.title}
                        </b>
                        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          {art.category} · {art.publishedAt || 'Published'}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => void loadLiveArticleForEdit(art)}
                      >
                        Load Story
                      </button>
                    </div>
                  ))
                )}
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
        </div>
      ) : (
        /* -------------------------------------------------------------
           ACTIVE DESK: 3-Column Layout
           Left: Source Reader · Center: Story Document · Right: Companion Preview Rail
           ------------------------------------------------------------- */
        <div className="ed-body-split">
          {/* =========================================================
              COLUMN 1: SOURCE READER (Bengali Hind Siliguri)
              ========================================================= */}
          <aside className="ed-pane ed-source-pane" style={{ maxWidth: 380 }}>
            <div className="ed-pane-header">
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="kicker">ORIGINAL SOURCE</span>
                <span className="source-meta">({sourceHost})</span>
              </div>
              <button
                type="button"
                className={`btn xs ${sourceEditing ? 'primary' : 'ghost'}`}
                onClick={() => setSourceEditing(!sourceEditing)}
                title="Toggle manual editing of source text"
              >
                <Icon name="edit" size={12} />
                <span>{sourceEditing ? 'Done' : 'Edit Source'}</span>
              </button>
            </div>
            {source?.extraction && (
              <div className="ed-extract-report" title={source.extraction.contentSelector ? `Story block: ${source.extraction.contentSelector}` : undefined}>
                <span className={`ed-extract-chip method-${source.extraction.method}`}>
                  {source.extraction.method === 'structured' ? 'Structured data' : source.extraction.method === 'markup' ? 'Page markup' : source.extraction.method === 'page-data' ? 'Page data' : 'Metadata only'}
                </span>
                <span className="ed-extract-chip">{source.extraction.language === 'bn' ? 'Bengali' : source.extraction.language === 'en' ? 'English' : source.extraction.language === 'mixed' ? 'Mixed' : 'Unknown language'}</span>
                <span className="ed-extract-chip">{source.paragraphs.length} paragraph{source.paragraphs.length === 1 ? '' : 's'}</span>
                <span className="ed-extract-chip">{source.images.length} photo{source.images.length === 1 ? '' : 's'}</span>
                {source.extraction.warnings.map((w) => (
                  <span key={w} className="ed-extract-warn"><Icon name="info" size={11} />{w}</span>
                ))}
              </div>
            )}

            <div className="ed-pane-scroll">
              {sourceEditing ? (
                /* Editable Source Mode (Rare fallback) */
                <div className="stack" style={{ gap: 12 }}>
                  <Field label="Original Headline">
                    <input
                      id="source-title-input"
                      type="text"
                      className="ed-url-input"
                      value={source?.title || ''}
                      onChange={(e) => updateSourceManual(e.target.value, source?.deck || '', source?.paragraphs || [])}
                    />
                  </Field>
                  <Field label="Original Deck / Summary">
                    <textarea
                      className="ed-deck-input"
                      rows={3}
                      value={source?.deck || ''}
                      onChange={(e) => updateSourceManual(source?.title || '', e.target.value, source?.paragraphs || [])}
                    />
                  </Field>
                  <Field label="Paragraphs (separated by blank lines)">
                    <textarea
                      className="ed-body-input"
                      rows={10}
                      value={source?.paragraphs.join('\n\n') || ''}
                      onChange={(e) =>
                        updateSourceManual(
                          source?.title || '',
                          source?.deck || '',
                          e.target.value.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
                        )
                      }
                    />
                  </Field>
                </div>
              ) : (
                /* Clean Reader View in Hind Siliguri */
                <div className="ed-source-reader">
                  {/* Bengali Headline (Unboxed reader title input) */}
                  <input
                    id="source-title-input"
                    className="source-reader-title-input"
                    readOnly
                    value={source?.title || ''}
                    title="Original Bengali Headline"
                  />

                  {/* Bengali Deck */}
                  {source?.deck && <p className="source-reader-deck">{source.deck}</p>}

                  {/* Fact Chips Bar */}
                  {factTable.length > 0 && (
                    <div className="fact-strip">
                      <span className="fact-strip-label">EXTRACTED FACTS ({factTable.length}):</span>
                      {factTable.map((f) => (
                        <span
                          key={f.id}
                          className={`fact-pill ${f.kind} ${activeFactId === f.id ? 'active' : ''}`}
                          onClick={() => handleFactChipClick(f)}
                          title={`Click to scroll to match in English story: ${f.normalized}`}
                          data-source-digits={f.normalized.replace(/[^0-9]/g, '')}
                          style={{ cursor: 'pointer' }}
                        >
                          {f.normalized}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Media Strip */}
                  {source?.images && source.images.length > 0 && (
                    <div className="source-images-tray" style={{ marginTop: 8 }}>
                      <span className="kicker">PHOTOS ({source.images.length})</span>
                      <div className="source-images-grid">
                        {source.images.map((img, idx) => (
                          <div key={idx} className="source-img-card">
                            <img src={img.src} alt={img.caption || 'Source photo'} />
                            <div className="img-actions-overlay">
                              <button
                                type="button"
                                className="img-btn-banner"
                                onClick={() => void importImageToBanner(img.src, `lead-${idx}.jpg`, { slotIndex: 0 })}
                              >
                                Set as Lead Photo
                              </button>
                              {img.caption && <span className="img-cap">{img.caption}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Bengali Story Paragraphs */}
                  <div className="source-paragraphs" style={{ marginTop: 10 }}>
                    <span className="kicker">SOURCE STORY BODY ({source?.paragraphs.length || 0} PARAS)</span>
                    {(source?.paragraphs || []).map((p, idx) => (
                      <div key={idx} className="source-reader-p">
                        <span style={{ fontSize: 10, color: 'var(--text-3)', display: 'block', marginBottom: 2 }}>
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span>{p}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>

          {/* =========================================================
              COLUMN 2: STORY DOCUMENT (English Page View)
              ========================================================= */}
          <main className="ed-pane" style={{ flex: 1, overflowY: 'auto' }}>
            <div className="ed-story-document">
              {/* Document Header Bar */}
              <div className="ed-story-header-bar">
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="swatch-dot" style={{ background: catData.accent }} />
                  <Select
                    value={bannerContent.categoryId}
                    options={deskOptions}
                    onChange={(nextId) => setDesk(String(nextId))}
                  />
                  {!deskAuto && (
                    <button
                      type="button"
                      className="btn xs ghost"
                      onClick={() => {
                        autoDetectDesk()
                        showToast('Desk auto-detected from story')
                      }}
                      title="Auto-detect desk"
                    >
                      Auto
                    </button>
                  )}
                </div>

                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                    {wordCount} words · ~{readTimeMin} min read
                  </span>
                  <div className="seg-ctl">
                    <button
                      type="button"
                      className={bodyMode === 'review' ? 'on' : ''}
                      onClick={() => setBodyMode('review')}
                      title="Fact verification view with inline green/amber marks"
                    >
                      <Icon name="check" size={12} />
                      <span>Verified View</span>
                    </button>
                    <button
                      type="button"
                      className={bodyMode === 'edit' ? 'on' : ''}
                      onClick={() => setBodyMode('edit')}
                      title="Edit story body text"
                    >
                      <Icon name="edit" size={12} />
                      <span>Edit Text</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 1. English Headline */}
              <div className="ed-headline-wrap">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="draft-headline" className="kicker" style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>
                    English headline
                  </label>
                  <span className={`ed-budget-counter ${draft.headline.length > 104 ? 'over' : ''}`}>
                    {draft.headline.length} / 104 chars
                  </span>
                </div>
                <textarea
                  id="draft-headline"
                  className="ed-story-headline"
                  rows={2}
                  placeholder="Type or edit the English newsroom headline…"
                  value={draft.headline}
                  onChange={(e) => setDraftField('headline', e.target.value)}
                />

                {/* Banner Line Breaker Tool */}
                <div className="ed-headline-breaker-wrap">
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span className="kicker" title="Click a gap between words to break the banner headline there">
                      Banner line breaks
                    </span>
                    <div className="row" style={{ gap: 4 }}>
                      <button type="button" className="btn xs ghost" onClick={handleAutoBalance} title="Auto-balance line lengths for banner">
                        Auto-Balance
                      </button>
                      {headlineBreaks.length > 0 && (
                        <button type="button" className="btn xs ghost" onClick={handleClearBreaks} title="Remove line breaks">
                          Flat
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="ed-headline-flow">
                    {headlineWords.map((word, idx) => (
                      <span key={idx} className="ed-trucent-word-item">
                        <span className="ed-headline-word">{word}</span>
                        {idx < headlineWords.length - 1 && (
                          <span
                            className={`word-break-gap ${headlineBreaks.includes(idx) ? 'has-break' : ''}`}
                            onClick={() => handleToggleBreakAt(idx)}
                            title={headlineBreaks.includes(idx) ? 'Click to remove break' : 'Click to break line here'}
                          >
                            <span className="gap-marker">↵</span>
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* 2. English Deck / Sub-Headline */}
              <div className="ed-deck-wrap" style={{ marginTop: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                  <label htmlFor="draft-deck" className="kicker">
                    STORY DECK / SUMMARY
                  </label>
                  <span className={`ed-budget-counter ${draft.deck.length > 200 ? 'over' : ''}`}>
                    {draft.deck.length} / 200 chars
                  </span>
                </div>
                <textarea
                  id="draft-deck"
                  className="ed-story-deck"
                  rows={2}
                  placeholder="Standfirst or deck summarising the story for readers…"
                  value={draft.deck}
                  onChange={(e) => setDraftField('deck', e.target.value)}
                />
              </div>

              {/* 3. English Story Body (15px / 1.65 / 68ch measure) with Inline Fact Verification */}
              <div className="ed-story-body-wrap">
                {bodyMode === 'review' ? (
                  /* Formatted Document View with Inline Green/Amber Underlines */
                  <div
                    className="ed-story-doc-view"
                    onDoubleClick={() => setBodyMode('edit')}
                    title="Double-click to edit story copy"
                  >
                    {draft.body ? (
                      draft.body.split(/\n{2,}/).map((p, pIdx) => {
                        const spans = parseParagraphWithFacts(p, factTable, sourceAscii)
                        return (
                          <p key={pIdx} className="ed-story-doc-p">
                            {spans.map((sp, sIdx) => {
                              if (!sp.isFact) return <span key={sIdx}>{sp.text}</span>
                              const digits = sp.text.replace(/[^0-9]/g, '')
                              return (
                                <span
                                  key={sIdx}
                                  className={sp.isVerified ? 'fact-verified' : 'fact-unverified'}
                                  title={sp.tooltip}
                                  data-fact-digits={digits}
                                  onClick={() => handleBodyFactClick(digits)}
                                >
                                  {sp.text}
                                </span>
                              )
                            })}
                          </p>
                        )
                      })
                    ) : (
                      <p style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>
                        Story body will render here with inline fact verification highlights…
                      </p>
                    )}
                  </div>
                ) : (
                  /* Clean Unboxed Textarea */
                  <textarea
                    id="draft-body"
                    className="ed-story-body-input"
                    rows={12}
                    placeholder="Full translated English article body text…"
                    value={draft.body}
                    onChange={(e) => setDraftField('body', e.target.value)}
                  />
                )}

                {/* Keep hidden draft-body in DOM when in review mode so tests / forms read value */}
                {bodyMode === 'review' && (
                  <textarea
                    id="draft-body"
                    style={{ display: 'none' }}
                    readOnly
                    value={draft.body}
                  />
                )}
              </div>

              {/* 4. Collapsed "Story Details & Metadata" Accordion (Requirement 1) */}
              <details className="ed-story-details">
                <summary className="ed-details-summary">
                  <Icon name="sliders" size={13} />
                  <span>Story details & metadata (byline, slug, SEO & social)</span>
                </summary>
                <div className="ed-details-content">
                  <div className="grid2">
                    <Field label="Author / Byline">
                      <input
                        type="text"
                        className="ed-url-input"
                        value={draft.byline || staffSession?.name || 'Mehedi Hasan Hamim'}
                        onChange={(e) => setDraftField('byline', e.target.value)}
                      />
                    </Field>
                    <Field label="Source / Photo Credit">
                      <input
                        type="text"
                        className="ed-url-input"
                        value={draft.credit || 'ESB PowerLine'}
                        onChange={(e) => setDraftField('credit', e.target.value)}
                      />
                    </Field>
                  </div>

                  <Field label="CMS Permalink Slug">
                    <div className="permalink-row">
                      <span className="permalink-prefix">esbpowerline.com/articles/</span>
                      <input
                        id="draft-slug"
                        type="text"
                        className="ed-slug-input"
                        value={draft.slug}
                        onChange={(e) => setDraftField('slug', e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => void checkSlug(draft.slug)}
                        disabled={slugStatus === 'checking'}
                      >
                        {slugStatus === 'checking' ? 'Checking…' : slugStatus === 'available' ? '✓ Available' : 'Check'}
                      </button>
                    </div>
                  </Field>

                  {/* SEO Fields */}
                  <div className="stack" style={{ gap: 8 }}>
                    <span className="kicker">SEARCH ENGINE OPTIMIZATION</span>
                    <Field label="Meta Title">
                      <input
                        type="text"
                        className="ed-url-input"
                        value={draft.metaTitle || ''}
                        onChange={(e) => setDraftField('metaTitle', e.target.value)}
                      />
                    </Field>
                    <Field label="Meta Description">
                      <textarea
                        className="ed-deck-input"
                        rows={2}
                        value={draft.metaDescription || ''}
                        onChange={(e) => setDraftField('metaDescription', e.target.value)}
                      />
                    </Field>
                    <Field label="Focus Keywords">
                      <input
                        type="text"
                        className="ed-url-input"
                        value={draft.focusKeywords || ''}
                        onChange={(e) => setDraftField('focusKeywords', e.target.value)}
                      />
                    </Field>
                  </div>

                  {/* Social Captions */}
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="kicker">SOCIAL CAPTIONS</span>
                      <div className="seg-ctl">
                        <button
                          type="button"
                          className={activeSocialTab === 'facebook' ? 'on' : ''}
                          onClick={() => setActiveSocialTab('facebook')}
                        >
                          FB
                        </button>
                        <button
                          type="button"
                          className={activeSocialTab === 'x' ? 'on' : ''}
                          onClick={() => setActiveSocialTab('x')}
                        >
                          X
                        </button>
                        <button
                          type="button"
                          className={activeSocialTab === 'linkedin' ? 'on' : ''}
                          onClick={() => setActiveSocialTab('linkedin')}
                        >
                          LI
                        </button>
                        <button
                          type="button"
                          className={activeSocialTab === 'telegram' ? 'on' : ''}
                          onClick={() => setActiveSocialTab('telegram')}
                        >
                          TG
                        </button>
                      </div>
                    </div>
                    <textarea
                      className="ed-body-input"
                      rows={3}
                      value={draft.social[activeSocialTab] || ''}
                      onChange={(e) => setSocialCaption(activeSocialTab, e.target.value)}
                    />
                    <div style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn xs"
                        onClick={() => {
                          navigator.clipboard.writeText(draft.social[activeSocialTab] || '')
                          showToast(`Copied ${activeSocialTab.toUpperCase()} caption`)
                        }}
                      >
                        Copy Caption
                      </button>
                    </div>
                  </div>
                </div>
              </details>
            </div>
          </main>

          {/* =========================================================
              COLUMN 3: COMPANION PREVIEW RAIL ("At Your Shoulder")
              Tabs: Banner 4:5 · Web Article · Facebook Feed (Requirement 5)
              ========================================================= */}
          {baseAssets && <GraphicsRail base={baseAssets} onToast={showToast} />}
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
