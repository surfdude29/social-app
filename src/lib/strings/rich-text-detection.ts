import {type UriString} from '@atproto/lex'
import {type Facet, type RichText as RichTextAPI} from '@bsky/sdk/richtext'

import {app} from '#/lexicons'
import {isValidDomain} from './url-helpers'

/*
 * A single domain label, per RFC 1035: alphanumeric at both ends, hyphens
 * allowed in between.
 *
 * `URL_REGEX` in `@bsky/sdk/richtext` matches the first label as
 * `[a-z][a-z0-9]*` and the rest as `[a-z0-9]+`, so a bare domain that starts
 * with a digit (404media.co, 9to5mac.com) or contains a hyphen (e-flux.com)
 * never matches and is rendered as plain text.
 */
const DOMAIN_LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?'
const DOMAIN = `${DOMAIN_LABEL}(?:\\.${DOMAIN_LABEL})+`

/**
 * Matches an `http(s)` URL or a bare domain. Mirrors `URL_REGEX` from
 * `@bsky/sdk/richtext`, but with the domain rules above.
 */
export const URL_REGEX = new RegExp(
  `(^|\\s|\\()((https?:\\/\\/[\\S]+)|((?<domain>${DOMAIN})[\\S]*))`,
  'gim',
)

interface DetectedLink {
  link: string
}
type DetectedLinkable = string | DetectedLink
export function detectLinkables(text: string): DetectedLinkable[] {
  const re = new RegExp(
    `((^|\\s|\\()@[a-z0-9.-]*)|((^|\\s|\\()https?:\\/\\/[\\S]+)|((^|\\s|\\()(?<domain>${DOMAIN})[\\S]*)`,
    'gi',
  )
  const segments = []
  let match
  let start = 0
  while ((match = re.exec(text))) {
    let matchIndex = match.index
    let matchValue = match[0]

    if (match.groups?.domain && !isValidDomain(match.groups?.domain)) {
      continue
    }

    if (/\s|\(/.test(matchValue)) {
      // HACK
      // skip the starting space
      // we have to do this because RN doesnt support negative lookaheads
      // -prf
      matchIndex++
      matchValue = matchValue.slice(1)
    }

    // strip ending punctuation
    if (/[.,;!?]$/.test(matchValue)) {
      matchValue = matchValue.slice(0, -1)
    }
    if (/[)]$/.test(matchValue) && !matchValue.includes('(')) {
      matchValue = matchValue.slice(0, -1)
    }

    if (start !== matchIndex) {
      segments.push(text.slice(start, matchIndex))
    }
    segments.push({link: matchValue})
    start = matchIndex + matchValue.length
  }
  if (start < text.length) {
    segments.push(text.slice(start))
  }
  return segments
}

/**
 * Adds the link facets that `RichText.detectFacets()` and
 * `RichText.detectFacetsWithoutResolution()` skip.
 *
 * Profile bios and feed/list descriptions carry no facets on the record, so
 * the client detects them at render time. The SDK's detection rejects bare
 * domains that start with a digit or contain a hyphen, which is why a bio
 * reading "like and subscribe: 404media.co" renders with no link at all.
 * Re-scan the text with `URL_REGEX` above and fill in the spans it skipped.
 * Facets the SDK already produced - links, mentions and tags alike - are left
 * untouched, so a domain that is part of a handle or hashtag is not relinked.
 *
 * This can go away once the domain pattern is fixed upstream in `@bsky/sdk`.
 */
export function detectMissedLinkFacets(rt: RichTextAPI): void {
  const text = rt.unicodeText
  const existing = rt.facets ?? []
  const added: Facet[] = []
  // `URL_REGEX` is global, so clone it rather than share its `lastIndex`
  const re = new RegExp(URL_REGEX)
  let match

  while ((match = re.exec(text.utf16))) {
    let uri = match[2]
    if (!uri.startsWith('http')) {
      const domain = match.groups?.domain
      if (!domain || !isValidDomain(domain)) {
        continue
      }
      uri = `https://${uri}`
    }

    const start = text.utf16.indexOf(match[2], match.index)
    let end = start + match[2].length
    // strip ending punctuation
    if (/[.,;:!?]$/.test(uri)) {
      uri = uri.slice(0, -1)
      end--
    }
    if (/[)]$/.test(uri) && !uri.includes('(')) {
      uri = uri.slice(0, -1)
      end--
    }

    const byteStart = text.utf16IndexToUtf8Index(start)
    const byteEnd = text.utf16IndexToUtf8Index(end)
    const overlapsExisting = existing.some(
      facet =>
        facet.index.byteStart < byteEnd && byteStart < facet.index.byteEnd,
    )
    if (overlapsExisting) {
      continue
    }

    added.push(
      app.bsky.richtext.facet.$build({
        index: {byteStart, byteEnd},
        features: [
          app.bsky.richtext.facet.link.$build({
            // boundary: detected text, format verified by `URL_REGEX`
            uri: uri as UriString,
          }),
        ],
      }),
    )
  }

  if (added.length) {
    rt.facets = [...existing, ...added].sort(
      (a, b) => a.index.byteStart - b.index.byteStart,
    )
  }
}
