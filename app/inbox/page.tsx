'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Inbox, Check, Trash2, ExternalLink, Loader2, ArrowUpDown, Search, X, Folder, ChevronDown } from 'lucide-react'
import * as Select from '@radix-ui/react-select'
import BookmarkCard from '@/components/bookmark-card'
import type { BookmarkWithMedia, BookmarksResponse, Category } from '@/lib/types'

const PAGE_SIZE = 20

function tweetUrlFor(b: BookmarkWithMedia): string {
  return b.authorHandle && b.authorHandle !== 'unknown'
    ? `https://twitter.com/${b.authorHandle}/status/${b.tweetId}`
    : `https://twitter.com/i/web/status/${b.tweetId}`
}

/** Tell the nav badge the inbox count changed by `delta`. */
function notifyInboxDelta(delta: number) {
  window.dispatchEvent(new CustomEvent('siftly:inbox-change', { detail: { delta } }))
}

function TriageItem({
  bookmark,
  onDecided,
}: {
  bookmark: BookmarkWithMedia
  onDecided: (id: string) => void
}) {
  const [busy, setBusy] = useState<'kept' | 'deleted' | null>(null)

  async function decide(triageState: 'kept' | 'deleted') {
    if (busy) return
    setBusy(triageState)
    // Optimistically remove + update badge; roll back on failure.
    onDecided(bookmark.id)
    notifyInboxDelta(-1)
    try {
      const res = await fetch(`/api/bookmarks/${bookmark.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triageState }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      console.error('Triage failed:', err)
      // Roll back the badge; the item will reappear on next refetch.
      notifyInboxDelta(1)
      alert('Could not update this bookmark. Please try again.')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <BookmarkCard bookmark={bookmark} />
      <div className="flex items-center gap-2">
        <a
          href={tweetUrlFor(bookmark)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-400 hover:text-zinc-100 hover:border-zinc-700 transition-all"
          title="Open on X to review — stays in inbox"
        >
          <ExternalLink size={14} />
          <span className="hidden sm:inline">Review on X</span>
        </a>
        <button
          onClick={() => decide('kept')}
          disabled={!!busy}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-sm font-medium text-emerald-300 hover:bg-emerald-500/20 hover:border-emerald-500/40 disabled:opacity-50 transition-all"
          title="Keep — archive into your library"
        >
          {busy === 'kept' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Keep
        </button>
        <button
          onClick={() => decide('deleted')}
          disabled={!!busy}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-sm font-medium text-red-300 hover:bg-red-500/20 hover:border-red-500/40 disabled:opacity-50 transition-all"
          title="Delete — remove from your library"
        >
          {busy === 'deleted' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          Delete
        </button>
      </div>
    </div>
  )
}

export default function InboxPage() {
  const [bookmarks, setBookmarks] = useState<BookmarkWithMedia[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [sort, setSort] = useState<'oldest' | 'newest'>('oldest')
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load the collection list for the filter dropdown
  useEffect(() => {
    fetch('/api/categories')
      .then((r) => r.json())
      .then((d: { categories?: Category[] }) => setCategories(d.categories ?? []))
      .catch(() => {})
  }, [])

  function updateSearch(q: string) {
    setSearchInput(q)
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => setQuery(q.trim()), 300)
  }

  function clearSearch() {
    if (searchRef.current) clearTimeout(searchRef.current)
    setSearchInput('')
    setQuery('')
  }

  function clearFilters() {
    clearSearch()
    setCategory('')
  }

  const fetchPage = useCallback(async (p: number, sortOrder: 'oldest' | 'newest', q: string, cat: string) => {
    const params = new URLSearchParams({
      triageState: 'inbox',
      sort: sortOrder,
      page: String(p),
      limit: String(PAGE_SIZE),
    })
    if (q) params.set('q', q)
    if (cat) params.set('category', cat)
    const res = await fetch(`/api/bookmarks?${params.toString()}`)
    if (!res.ok) throw new Error('Failed to fetch inbox')
    const data: BookmarksResponse = await res.json()
    return data
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchPage(1, sort, query, category)
      .then((data) => {
        if (cancelled) return
        setBookmarks(data.bookmarks)
        setTotal(data.total)
        setPage(1)
      })
      .catch((err) => {
        if (cancelled) return
        console.error(err)
        setBookmarks([])
        setTotal(0)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchPage, sort, query, category])

  function handleDecided(id: string) {
    setBookmarks((prev) => prev.filter((b) => b.id !== id))
    setTotal((prev) => Math.max(0, prev - 1))
  }

  async function loadMore() {
    setLoadingMore(true)
    try {
      const next = page + 1
      const data = await fetchPage(next, sort, query, category)
      // Guard against duplicates if items shifted after triage
      setBookmarks((prev) => {
        const seen = new Set(prev.map((b) => b.id))
        return [...prev, ...data.bookmarks.filter((b) => !seen.has(b.id))]
      })
      setTotal(data.total)
      setPage(next)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingMore(false)
    }
  }

  const hasMore = bookmarks.length < total
  const activeCategory = categories.find((c) => c.slug === category) ?? null
  const hasFilter = !!query || !!category
  const controlsVisible = total > 0 || hasFilter

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-zinc-950/90 backdrop-blur-lg border-b border-zinc-800/60">
        <div className="px-6 md:px-8 py-4 max-w-3xl mx-auto w-full">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
              <Inbox size={16} className="text-indigo-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-zinc-100 leading-tight">Inbox</h1>
              <p className="text-xs text-zinc-500 truncate">
                {loading
                  ? 'Loading…'
                  : hasFilter
                    ? `${total.toLocaleString()} match${total !== 1 ? 'es' : ''}${activeCategory ? ` in ${activeCategory.name}` : ''}${query ? ` for "${query}"` : ''}`
                    : total > 0
                      ? `${total.toLocaleString()} to triage`
                      : 'Nothing to triage'}
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="relative mt-3">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
            <input
              type="text"
              placeholder="Search inbox…"
              value={searchInput}
              onChange={(e) => updateSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 text-sm focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20 transition-all"
            />
            {searchInput && (
              <button
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors"
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Controls: collection filter + sort */}
          {controlsVisible && (
            <div className="flex items-center gap-2 mt-3">
              <Select.Root value={category || '_all'} onValueChange={(v) => setCategory(v === '_all' ? '' : v)}>
                <Select.Trigger className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-all min-w-[150px]">
                  <Folder size={13} className="shrink-0" style={activeCategory ? { color: activeCategory.color } : undefined} />
                  <Select.Value placeholder="All collections" />
                  <Select.Icon className="ml-auto">
                    <ChevronDown size={12} className="text-zinc-600" />
                  </Select.Icon>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content className="z-50 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl shadow-black/50 overflow-hidden max-h-[320px]">
                    <Select.Viewport className="p-1">
                      <Select.Item
                        value="_all"
                        className="flex items-center px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 rounded-lg cursor-pointer outline-none transition-colors data-[highlighted]:bg-zinc-800 data-[highlighted]:text-zinc-100"
                      >
                        <Select.ItemText>All collections</Select.ItemText>
                      </Select.Item>
                      {categories.map((cat) => (
                        <Select.Item
                          key={cat.slug}
                          value={cat.slug}
                          className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 rounded-lg cursor-pointer outline-none transition-colors data-[highlighted]:bg-zinc-800 data-[highlighted]:text-zinc-100"
                        >
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                          <Select.ItemText>{cat.name}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>

              {category && (
                <button
                  onClick={() => setCategory('')}
                  className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-300 hover:bg-indigo-500/20 transition-all shrink-0"
                  title="Clear collection filter"
                >
                  <X size={11} />
                </button>
              )}

              <button
                onClick={() => setSort((s) => (s === 'oldest' ? 'newest' : 'oldest'))}
                className="ml-auto flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-all shrink-0"
                title={`Sort: ${sort === 'oldest' ? 'Oldest first' : 'Newest first'}`}
              >
                <ArrowUpDown size={13} />
                <span className="hidden sm:inline">{sort === 'oldest' ? 'Oldest first' : 'Newest first'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 md:px-8 py-6 max-w-3xl mx-auto w-full">
        {loading && (
          <div className="flex items-center justify-center py-24 text-zinc-600">
            <Loader2 size={20} className="animate-spin" />
          </div>
        )}

        {!loading && bookmarks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-5">
              {hasFilter ? <Search size={26} className="text-zinc-700" /> : <Inbox size={26} className="text-zinc-700" />}
            </div>
            {hasFilter ? (
              <>
                <h3 className="text-base font-semibold text-zinc-400 mb-2">No matches</h3>
                <p className="text-zinc-600 text-sm max-w-xs mb-5">
                  No inbox bookmarks{activeCategory ? ` in ${activeCategory.name}` : ''}{query ? ` match “${query}”` : ''}.
                </p>
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-xl transition-colors border border-zinc-800"
                >
                  <X size={13} />
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold text-zinc-400 mb-2">Inbox zero 🎉</h3>
                <p className="text-zinc-600 text-sm max-w-xs">
                  Nothing left to triage. New bookmarks you import will show up here.
                </p>
              </>
            )}
          </div>
        )}

        {!loading && bookmarks.length > 0 && (
          <div className="flex flex-col gap-6">
            {bookmarks.map((bookmark) => (
              <TriageItem key={bookmark.id} bookmark={bookmark} onDecided={handleDecided} />
            ))}
          </div>
        )}

        {!loading && hasMore && (
          <div className="flex justify-center mt-8">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-xl transition-colors border border-zinc-800 disabled:opacity-50"
            >
              {loadingMore && <Loader2 size={14} className="animate-spin" />}
              Load more ({total - bookmarks.length} left)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
