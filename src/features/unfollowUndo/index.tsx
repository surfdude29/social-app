import {useCallback, useEffect, useRef} from 'react'
import {type AtpAgent} from '@atproto/api'
import {Trans, useLingui} from '@lingui/react/macro'
import {type QueryClient, useQueryClient} from '@tanstack/react-query'

import {useOnAppStateChange} from '#/lib/appState'
import {isNetworkError} from '#/lib/strings/errors'
import {logger} from '#/logger'
import {updateProfileShadow} from '#/state/cache/profile-shadow'
import {useAgent, useSession} from '#/state/session'
import * as userActionHistory from '#/state/userActionHistory'
import * as Toast from '#/components/Toast'
import {IS_WEB} from '#/env'
import {
  partitionReplayablePendingUnfollows,
  persistPendingUnfollow,
  takePersistedPendingUnfollows,
} from './persistence'
import {
  discardAllPendingUnfollows,
  flushAllPendingUnfollows,
  getInflightUnfollowCommit,
  hasPendingUnfollow,
  UNFOLLOW_UNDO_DURATION,
} from './registry'

export * from './persistence'
export * from './registry'

/**
 * True while the web page is being unloaded (refresh, close, navigation
 * away). Commit closures use this to tell a fetch cancelled by the unload -
 * where the persisted entry must survive for replay on next launch - from a
 * real failure that should revert the UI and unpersist. Always false on
 * native.
 */
let pageUnloading = false

export function isPageUnloading(): boolean {
  return pageUnloading
}

/**
 * Shows the centralized "No longer following X" toast with an Undo action.
 * Returns the toast id so the pending-unfollow registry can dismiss it if
 * the unfollow is flushed before the toast expires.
 */
export function showUnfollowUndoToast({
  displayName,
  onUndo,
}: {
  /**
   * Pre-sanitized (and moderation-aware, where available) display name of
   * the unfollowed profile.
   */
  displayName: string
  onUndo: () => void
}): string {
  return Toast.show(
    <UnfollowUndoToast displayName={displayName} onUndo={onUndo} />,
    {duration: UNFOLLOW_UNDO_DURATION},
  )
}

function UnfollowUndoToast({
  displayName,
  onUndo,
}: {
  displayName: string
  onUndo: () => void
}) {
  const {t: l} = useLingui()
  return (
    <Toast.Outer>
      <Toast.Icon />
      <Toast.Text>
        <Trans>No longer following {displayName}</Trans>
      </Toast.Text>
      <Toast.Action label={l`Undo`} onPress={onUndo}>
        <Trans>Undo</Trans>
      </Toast.Action>
    </Toast.Outer>
  )
}

/**
 * Fires the network delete for every persisted unfollow whose commit never
 * completed (page refresh/close, app kill, or a page frozen into the bfcache
 * mid-commit). The delete is idempotent server-side, so an entry whose
 * commit actually landed before the app died is safe to fire again. No undo
 * toast and no metric - the metric fired at original commit time.
 *
 * Not every entry fires: young entries are re-persisted untouched, since
 * their staging context - this tab, or on web another tab sharing the
 * storage - may still be driving them through commit or undo, and replaying
 * would race that (worst case deleting the record out from under a live
 * Undo toast in another tab). The owning context removes the entry from the
 * shared store on commit or undo, which is what makes deferral safe.
 * Entries whose delete fails with a network error (e.g. relaunched offline)
 * are also re-persisted so the unfollow isn't silently lost; any other
 * failure is logged and dropped so a poison entry can't retry forever.
 *
 * Returns the ms until the next deferred entry becomes replayable, so the
 * caller can schedule a follow-up pass; undefined when nothing was
 * deferred.
 */
function replayPersistedUnfollows(
  agent: AtpAgent,
  queryClient: QueryClient,
  accountDid: string,
): number | undefined {
  const {replayable, deferred, retryDelayMs} =
    partitionReplayablePendingUnfollows(
      takePersistedPendingUnfollows(accountDid),
      Date.now(),
    )
  for (const entry of deferred) {
    persistPendingUnfollow(accountDid, entry)
  }
  for (const entry of replayable) {
    /*
     * Even an old entry can still be owned by this tab: after a bfcache
     * restore the original commit's fetch may still be settling, or a retry
     * pass may find the unfollow staged in the registry again. Their own
     * handlers will unpersist the record or revert the UI. Re-persist and
     * let them win rather than racing them with a second delete.
     */
    if (hasPendingUnfollow(entry.did) || getInflightUnfollowCommit(entry.did)) {
      persistPendingUnfollow(accountDid, entry)
      continue
    }
    agent
      .deleteFollow(entry.followUri)
      .then(() => {
        userActionHistory.unfollow([entry.did])
        updateProfileShadow(queryClient, entry.did, {followingUri: undefined})
      })
      .catch(e => {
        /*
         * The pending/inflight re-check guards the rare case where the user
         * refollowed and re-unfollowed this did while the delete was in
         * flight: that newer stage owns the WAL slot now, and re-persisting
         * the old entry would clobber it.
         */
        if (
          isNetworkError(e) &&
          !hasPendingUnfollow(entry.did) &&
          !getInflightUnfollowCommit(entry.did)
        ) {
          persistPendingUnfollow(accountDid, entry)
        } else {
          logger.error('Failed to replay persisted unfollow', {safeMessage: e})
        }
      })
  }
  return retryDelayMs
}

/**
 * Runs the replay, and when it defers young entries, chains exactly one
 * timer (held in `timeoutRef`, so the owner can cancel it) to run again once
 * the next entry becomes old enough. This is what keeps "refresh
 * mid-window" replays landing in the reloaded tab instead of waiting for a
 * future cold launch that may never come.
 */
function replayPersistedUnfollowsWithRetry(
  agent: AtpAgent,
  queryClient: QueryClient,
  accountDid: string,
  timeoutRef: {current: ReturnType<typeof setTimeout> | undefined},
) {
  if (timeoutRef.current !== undefined) {
    clearTimeout(timeoutRef.current)
    timeoutRef.current = undefined
  }
  const retryDelayMs = replayPersistedUnfollows(agent, queryClient, accountDid)
  if (retryDelayMs !== undefined) {
    timeoutRef.current = setTimeout(() => {
      replayPersistedUnfollowsWithRetry(
        agent,
        queryClient,
        accountDid,
        timeoutRef,
      )
    }, retryDelayMs)
  }
}

/**
 * Renders nothing. Mounted once inside the account-keyed app subtree so that
 * pending unfollows are flushed when the app backgrounds and discarded on
 * unmount (logout or account switch). Unmount must discard, not commit: the
 * session provider disposes the previous agent right after the teardown pass
 * (session/index.tsx `prevAgent.dispose()`), and although the unmount cleanup
 * starts first, everything past the commit's first await - including where
 * XRPC reads the access token - runs on the microtask queue after dispose, so
 * the delete would fail with an auth error. The persisted records survive the
 * discard, and the mount-time replay below commits them with a fresh agent
 * when the account is next active.
 */
export function PendingUnfollowsFlusher() {
  const agent = useAgent()
  const queryClient = useQueryClient()
  const {currentAccount} = useSession()
  const accountDid = currentAccount?.did
  const replayRetryTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  /*
   * useCallback (rather than relying on the compiler) because the effects
   * below list this in their dependency arrays.
   */
  const replayWithRetry = useCallback(
    (did: string) => {
      replayPersistedUnfollowsWithRetry(
        agent,
        queryClient,
        did,
        replayRetryTimeout,
      )
    },
    [agent, queryClient],
  )

  useOnAppStateChange(state => {
    /*
     * Flush on 'background' only, matching feed-feedback. 'inactive' fires
     * for app-switcher/control-center peeks on iOS where the user usually
     * returns, and committing then would leave a visible Undo button that no
     * longer works.
     */
    if (state === 'background') {
      flushAllPendingUnfollows()
    }
  })
  useEffect(() => {
    return () => discardAllPendingUnfollows()
  }, [])
  useEffect(() => {
    if (!IS_WEB) return
    /*
     * AppState 'background' maps to visibility on web, which doesn't fire
     * for Cmd+W / window close while the tab is visible, so also flush on
     * pagehide. The browser may still cancel the in-flight request on a full
     * unload (the atproto agent doesn't expose keepalive/sendBeacon
     * semantics) - the pageUnloading flag keeps the persisted entry alive in
     * that case so the unfollow is replayed on next launch. pageshow covers
     * the page being revived from the bfcache instead of unloaded.
     */
    const onPageHide = () => {
      pageUnloading = true
      flushAllPendingUnfollows()
    }
    /*
     * pageshow with `persisted` means the page was revived from the bfcache
     * instead of unloaded, so the "replay on next launch" that the pagehide
     * flush counted on may be a long way off (the tab keeps living without
     * a cold load). Replay any records whose delete the browser cancelled
     * at freeze time right away.
     */
    const onPageShow = (e: PageTransitionEvent) => {
      pageUnloading = false
      if (e.persisted && accountDid) {
        replayWithRetry(accountDid)
      }
    }
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [accountDid, replayWithRetry])
  useEffect(() => {
    /*
     * Replay unfollows persisted by a previous session whose commit never
     * completed (page refresh/close, app kill).
     */
    if (!accountDid) return
    replayWithRetry(accountDid)
    return () => {
      if (replayRetryTimeout.current !== undefined) {
        clearTimeout(replayRetryTimeout.current)
        replayRetryTimeout.current = undefined
      }
    }
  }, [accountDid, replayWithRetry])
  return null
}
