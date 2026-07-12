import {XRPCError} from '@atproto/api'
import {t} from '@lingui/core/macro'

export function cleanError(str: any): string {
  if (!str) {
    return ''
  }
  if (typeof str !== 'string') {
    str = str.toString()
  }
  if (isNetworkError(str)) {
    return t`Unable to connect. Please check your internet connection and try again.`
  }
  if (
    str.includes('Upstream Failure') ||
    str.includes('NotEnoughResources') ||
    str.includes('pipethrough network error')
  ) {
    return t`The server appears to be experiencing issues. Please try again in a few moments.`
  }
  /**
   * @see https://github.com/bluesky-social/atproto/blob/255cfcebb54332a7129af768a93004e22c6858e3/packages/pds/src/actor-store/preference/transactor.ts#L24
   */
  if (
    str.includes('Do not have authorization to set preferences') &&
    str.includes('app.bsky.actor.defs#personalDetailsPref')
  ) {
    return t`You cannot update your birthdate while using an app password. Please sign in with your main password to update your birthdate.`
  }
  if (str.includes('Bad token scope') || str.includes('Bad token method')) {
    return t`This feature is not available while using an App Password. Please sign in with your main password.`
  }
  if (str.includes('Account has been suspended')) {
    return t`Account has been suspended`
  }
  if (str.includes('Account is deactivated')) {
    return t`Account is deactivated`
  }
  if (str.includes('Profile not found')) {
    return t`Profile not found`
  }
  if (str.includes('Unable to resolve handle')) {
    return t`Unable to resolve handle`
  }
  if (str.startsWith('Error: ')) {
    return str.slice('Error: '.length)
  }
  return str
}

const NETWORK_ERRORS = [
  'Abort',
  'Network request failed',
  'Failed to fetch',
  'Load failed',
  'Upstream service unreachable',
  'NetworkError when attempting to fetch resource',
]

export function isNetworkError(e: unknown) {
  const str = String(e)
  for (const err of NETWORK_ERRORS) {
    if (str.includes(err)) {
      return true
    }
  }
  return false
}

/**
 * Whether an XRPC failure is a transient server-side condition (5xx, e.g.
 * `UpstreamFailure` or `InternalServerError`, or a 429 rate limit) rather
 * than a definitive rejection of the request. Such a request is worth
 * retrying: it may succeed unchanged once the upstream recovers. Note this
 * is disjoint from {@link isNetworkError}, which matches failures where the
 * request never got a response at all.
 */
export function isTransientServerError(e: unknown): boolean {
  if (!(e instanceof XRPCError)) return false
  /*
   * ResponseType is a numeric enum of HTTP statuses; unknown 5xx codes are
   * mapped into its 5xx members, so a plain numeric range check is exact.
   */
  const status: number = e.status
  return status >= 500 || status === 429
}

export function isErrorMaybeAppPasswordPermissions(e: unknown) {
  if (e instanceof XRPCError && e.error === 'TokenInvalid') {
    return true
  }
  const str = String(e)
  return str.includes('Bad token scope') || str.includes('Bad token method')
}

/**
 * Intended to capture "User cancelled" or "Crop cancelled" errors
 * that we often get from expo modules such @bsky.app/expo-image-crop-tool
 *
 * The exact name has changed in the past so let's just see if the string
 * contains "cancel"
 */
export function isCancelledError(e: unknown) {
  const str = String(e).toLowerCase()
  return str.includes('cancel')
}
