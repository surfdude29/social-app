import {useCallback} from 'react'
import {type I18n} from '@lingui/core'
import {msg} from '@lingui/core/macro'
import {useLingui} from '@lingui/react/macro'

import {
  DISCOVER_FEED_URI,
  TIMELINE_SAVED_FEED,
  VIDEO_FEED_URIS,
} from '#/lib/constants'

/**
 * The minimum shape needed to name a feed. `FeedSourceInfo`,
 * `SavedFeedSourceInfo` and `app.bsky.feed.defs.GeneratorView` all satisfy it
 * structurally, so most call sites pass the feed object straight through.
 */
type FeedNameSource = {
  displayName: string
  uri: string
}

/**
 * Built-in Bluesky feeds carry an English `displayName` on their generator
 * record, so their name has to be swapped for a catalog string at render time.
 * Every other feed is user-generated and passes through untouched.
 *
 * `displayName` is expected to be sanitized already (see `sanitizeDisplayName`).
 * Never pass the return value back through `sanitizeDisplayName` - the
 * localized names are catalog strings, not user input.
 */
export function getLocalizedFeedName(feed: FeedNameSource, i18n: I18n): string {
  if (feed.uri === TIMELINE_SAVED_FEED.value) {
    return i18n._(
      msg({
        message: 'Following',
        context: 'feed-name',
        comment: 'Name of the built-in Following feed, shown as a feed title.',
      }),
    )
  }
  if (feed.uri === DISCOVER_FEED_URI) {
    return i18n._(
      msg({
        message: 'Discover',
        context: 'feed-name',
        comment: 'Name of the built-in Discover feed, shown as a feed title.',
      }),
    )
  }
  if (VIDEO_FEED_URIS.includes(feed.uri)) {
    return i18n._(
      msg({
        message: 'Video',
        context: 'feed-name',
        comment:
          'Name of the built-in Video feed, shown as a feed title. Distinct from the "Video" used to describe a video attachment.',
      }),
    )
  }
  return feed.displayName
}

/**
 * Returns a getter for a feed's localized name.
 *
 * A getter rather than a `useLocalizedFeedName(feed)` hook so it works in
 * loops, after early returns, and inside callbacks - all of which occur at
 * existing call sites.
 */
export function useGetLocalizedFeedName() {
  const {i18n} = useLingui()
  /*
   * Kept referentially stable because consumers place it in `useCallback`
   * dependency arrays, e.g. the `renderItem` in Explore.
   */
  return useCallback(
    (feed: FeedNameSource) => getLocalizedFeedName(feed, i18n),
    [i18n],
  )
}
