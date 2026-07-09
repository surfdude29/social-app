import {useEffect} from 'react'
import {Trans, useLingui} from '@lingui/react/macro'
import {useQueryClient} from '@tanstack/react-query'

import {useOnAppStateChange} from '#/lib/appState'
import {logger} from '#/logger'
import {updateProfileShadow} from '#/state/cache/profile-shadow'
import {useAgent, useSession} from '#/state/session'
import * as userActionHistory from '#/state/userActionHistory'
import * as Toast from '#/components/Toast'
import {IS_WEB} from '#/env'
import {takePersistedPendingUnfollows} from './persistence'
import {
  discardAllPendingUnfollows,
  flushAllPendingUnfollows,
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
    const onPageShow = () => {
      pageUnloading = false
    }
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])
  useEffect(() => {
    /*
     * Replay unfollows persisted by a previous session whose commit never
     * completed (page refresh/close, app kill). Attempted once each and
     * dropped: on failure the UI already reflects server truth, and the
     * delete is idempotent server-side, so an entry whose commit actually
     * landed before the app died is safe to fire again. No undo toast and no
     * metric - the metric fired at original commit time.
     */
    const accountDid = currentAccount?.did
    if (!accountDid) return
    for (const {did, followUri} of takePersistedPendingUnfollows(accountDid)) {
      agent
        .deleteFollow(followUri)
        .then(() => {
          userActionHistory.unfollow([did])
          updateProfileShadow(queryClient, did, {followingUri: undefined})
        })
        .catch(e => {
          logger.error('Failed to replay persisted unfollow', {safeMessage: e})
        })
    }
  }, [agent, currentAccount?.did, queryClient])
  return null
}
