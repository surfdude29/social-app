import {useCallback, useEffect, useRef} from 'react'
import {type AtpAgent} from '@atproto/api'
import {Trans, useLingui} from '@lingui/react/macro'
import {type QueryClient, useQueryClient} from '@tanstack/react-query'

import {useOnAppStateChange} from '#/lib/appState'
import {isNetworkError, isTransientServerError} from '#/lib/strings/errors'
import {logger} from '#/logger'
import {updateProfileShadow} from '#/state/cache/profile-shadow'
import {removeProfileFromFollowsCache} from '#/state/queries/profile-follows'
import {useAgent, useSession} from '#/state/session'
import * as userActionHistory from '#/state/userActionHistory'
import * as Toast from '#/components/Toast'
import {IS_WEB} from '#/env'
import {
  getPersistedPendingUnfollows,
  partitionReplayablePendingUnfollows,
  unpersistPendingUnfollow,
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
 * The did whose account subtree is currently mounted, maintained by
 * {@link PendingUnfollowsFlusher}. Undefined while no account is active,
 * including the moment between unmounting one account and mounting the
 * next.
 */
let activeAccountDid: string | undefined

/**
 * Whether `accountDid` is still the active account. Commit closures use
 * this to tell a delete settling after an account switch from one settling
 * normally: post-switch, the UI (and the global toast outlet) belong to
 * another account, so a failure must not revert shadows, surface an error
 * toast, or remove the persisted entry - keeping the entry lets the replay
 * fire the delete when this account is next active.
 */
export function isAccountActive(accountDid: string): boolean {
  return activeAccountDid === accountDid
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
 * Replay deletes currently on the wire from this app instance, keyed by
 * `accountDid + ' ' + did` (a space cannot occur in a did). Because entries
 * stay persisted until their delete settles, a retry pass or a bfcache
 * `pageshow` replay would otherwise see a still-persisted entry and fire it
 * a second time. Another *tab* can still double-fire an aged entry - that
 * is fine, the delete is idempotent server-side.
 */
const inflightReplays = new Set<string>()

/**
 * Fires the network delete for every persisted unfollow whose commit never
 * completed (page refresh/close, app kill, or a page frozen into the bfcache
 * mid-commit). The delete is idempotent server-side, so an entry whose
 * commit actually landed before the app died is safe to fire again. No undo
 * toast and no metric - the metric fired at original commit time.
 *
 * Entries are never removed from storage until their outcome is known: the
 * entry must survive the app dying again while the replayed delete is in
 * flight. Success (or a definitive failure, which is logged and dropped so
 * a poison entry can't retry forever) removes the entry; a network failure
 * (e.g. relaunched offline) or a transient server failure (5xx/rate limit)
 * leaves it in place for the next launch/pageshow. A failure landing after
 * an account switch is also kept: the switch disposed the agent the delete
 * was riding on, so the error may just be the dispose - the account's next
 * activation replays the entry with a fresh agent and reclassifies any
 * genuine poison then.
 *
 * Not every entry fires: young entries are skipped without touching
 * storage, since their staging context - this tab, or on web another tab
 * sharing the storage - may still be driving them through commit or undo,
 * and replaying would race that (worst case deleting the record out from
 * under a live Undo toast in another tab). The owning context removes the
 * entry from the shared store on commit or undo, which is what makes
 * deferral safe - and is also why the deferral must not rewrite storage:
 * removing and re-persisting would open a window in which that owner's undo
 * finds nothing to remove and the entry is resurrected afterwards.
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
  const {replayable, retryDelayMs} = partitionReplayablePendingUnfollows(
    getPersistedPendingUnfollows(accountDid),
    Date.now(),
  )
  for (const entry of replayable) {
    const replayKey = `${accountDid} ${entry.did}`
    if (inflightReplays.has(replayKey)) continue
    /*
     * Even an old entry can still be owned by this tab: after a bfcache
     * restore the original commit's fetch may still be settling, or a retry
     * pass may find the unfollow staged in the registry again. Their own
     * handlers will remove the entry or revert the UI; leave it to them
     * rather than racing them with a second delete.
     */
    if (
      hasPendingUnfollow(accountDid, entry.did) ||
      getInflightUnfollowCommit(accountDid, entry.did)
    ) {
      continue
    }
    inflightReplays.add(replayKey)
    agent
      .deleteFollow(entry.followUri)
      .then(() => {
        unpersistPendingUnfollow(accountDid, entry)
        /*
         * A delete that settles after an account switch must skip the side
         * effects that belong to the active account: userActionHistory is
         * shared module state, and the shadow update only touches the
         * retired account's query client anyway.
         */
        if (!isAccountActive(accountDid)) return
        userActionHistory.unfollow([entry.did])
        updateProfileShadow(queryClient, entry.did, {followingUri: undefined})
        /*
         * Mirrors the commit path: a follows list fetched while this delete
         * was in flight still contains the profile and would keep it until
         * the next refetch.
         */
        removeProfileFromFollowsCache(queryClient, accountDid, entry.did)
      })
      .catch(e => {
        if (isNetworkError(e) || isTransientServerError(e)) {
          /*
           * Couldn't reach the server, or the server was momentarily
           * unhealthy (5xx/rate limit) - both common right at relaunch and
           * neither a verdict on the delete itself. Keep the entry; it is
           * retried on the next launch/pageshow. Nothing is written, so a
           * newer unfollow staged for the same did meanwhile keeps the WAL
           * slot undisturbed.
           */
          return
        }
        /*
         * A failure after an account switch is unreliable evidence: the
         * switch disposed the agent this delete was riding on, so the error
         * may just be the dispose. Keep the entry - the replay reclassifies
         * it with a fresh agent when this account is next active.
         */
        if (!isAccountActive(accountDid)) return
        unpersistPendingUnfollow(accountDid, entry)
        logger.error('Failed to replay persisted unfollow', {safeMessage: e})
      })
      .finally(() => {
        inflightReplays.delete(replayKey)
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
    /*
     * Track the active account for isAccountActive(). React runs this
     * cleanup before the next account's mount effect, so across a switch
     * the flag is never stale - at worst briefly undefined, which reads as
     * "not active" and errs on the safe side.
     */
    activeAccountDid = accountDid
    return () => {
      activeAccountDid = undefined
    }
  }, [accountDid])
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
