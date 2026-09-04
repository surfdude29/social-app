import {beforeAll, describe, expect, it} from '@jest/globals'
import {i18n} from '@lingui/core'

import {
  DISCOVER_FEED_URI,
  STAGING_VIDEO_FEED_URI,
  TIMELINE_SAVED_FEED,
  VIDEO_FEED_URI,
} from '#/lib/constants'
import {getLocalizedFeedName} from '../feed-names'

/*
 * `getLocalizedFeedName` returns translated copy, so a locale has to be active.
 * With no catalog loaded, Lingui falls back to the source message.
 */
beforeAll(() => {
  i18n.loadAndActivate({locale: 'en', messages: {}})
})

describe('getLocalizedFeedName', () => {
  it('names the Following timeline from its uri', () => {
    expect(
      getLocalizedFeedName(
        {uri: TIMELINE_SAVED_FEED.value, displayName: 'ignored'},
        i18n,
      ),
    ).toEqual('Following')
  })

  it('names the Discover feed from its uri', () => {
    expect(
      getLocalizedFeedName(
        {uri: DISCOVER_FEED_URI, displayName: 'ignored'},
        i18n,
      ),
    ).toEqual('Discover')
  })

  it('names the video feed from its uri', () => {
    expect(
      getLocalizedFeedName({uri: VIDEO_FEED_URI, displayName: 'Video'}, i18n),
    ).toEqual('Video')
  })

  it('names the staging video feed from its uri', () => {
    expect(
      getLocalizedFeedName(
        {uri: STAGING_VIDEO_FEED_URI, displayName: 'Video'},
        i18n,
      ),
    ).toEqual('Video')
  })

  it('passes a user-generated feed name through unchanged', () => {
    expect(
      getLocalizedFeedName(
        {
          uri: 'at://did:plc:abc123/app.bsky.feed.generator/cool-feed',
          displayName: 'Cool feed',
        },
        i18n,
      ),
    ).toEqual('Cool feed')
  })

  it('leaves a user-generated feed named after a built-in one alone', () => {
    expect(
      getLocalizedFeedName(
        {
          uri: 'at://did:plc:abc123/app.bsky.feed.generator/whatever',
          displayName: 'Discover',
        },
        i18n,
      ),
    ).toEqual('Discover')
  })

  it('does not match a different DID publishing the same rkey', () => {
    expect(
      getLocalizedFeedName(
        {
          uri: 'at://did:plc:abc123/app.bsky.feed.generator/thevids',
          displayName: 'My vids',
        },
        i18n,
      ),
    ).toEqual('My vids')
  })

  it('passes an empty display name through unchanged', () => {
    expect(
      getLocalizedFeedName(
        {uri: 'at://did:plc:abc123/app.bsky.feed.generator/x', displayName: ''},
        i18n,
      ),
    ).toEqual('')
  })
})
