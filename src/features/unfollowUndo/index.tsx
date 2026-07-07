import {useEffect} from 'react'
import {Trans, useLingui} from '@lingui/react/macro'

import {useOnAppStateChange} from '#/lib/appState'
import * as Toast from '#/components/Toast'
import {IS_WEB} from '#/env'
import {flushAllPendingUnfollows, UNFOLLOW_UNDO_DURATION} from './registry'

export * from './registry'

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
 * pending unfollows are flushed when the app backgrounds, and on unmount
 * (logout or account switch). Unmount cleanup runs before the session
 * provider disposes the previous agent, so the captured-agent commits still
 * authenticate.
 */
export function PendingUnfollowsFlusher() {
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
    return () => flushAllPendingUnfollows()
  }, [])
  useEffect(() => {
    if (!IS_WEB) return
    /*
     * AppState 'background' maps to visibility on web, which doesn't fire
     * for Cmd+W / window close while the tab is visible. Flushing on
     * pagehide is best effort: the atproto agent doesn't expose
     * keepalive/sendBeacon semantics, so the browser may still cancel the
     * in-flight request on a full unload. Same accepted-risk shape as a
     * native force-kill skipping 'background'; the UI self-heals to server
     * truth on next load.
     */
    const flush = () => flushAllPendingUnfollows()
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])
  return null
}
