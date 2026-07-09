/**
 * Window during which a staged unfollow can be undone. The undo toast's
 * duration is kept in sync with this value.
 */
export const UNFOLLOW_UNDO_DURATION = 5e3

type PendingUnfollow = {
  did: string
  /**
   * The follow record captured at stage time. The commit closure must use
   * this rather than any render-derived state, since the optimistic shadow
   * update clears `profile.viewer?.following` immediately.
   */
  followUri: string
  /**
   * Performs the real network delete plus side effects. Runs after the undo
   * window expires (or on an early flush) and must handle its own errors -
   * it should never reject. Resolves true when the delete was confirmed (or
   * the page is unloading, where nothing further can run anyway), false when
   * it failed and the optimistic UI was reverted.
   */
  commit: () => Promise<boolean>
  /**
   * Restores the optimistic UI (profile shadow and follows cache) when the
   * pending unfollow is cancelled.
   */
  revert: () => void
  /**
   * Dismisses the undo toast. Called on any teardown (undo, flush,
   * supersede); must be safe to call after the toast already closed.
   */
  onDiscardToast: () => void
  timeout: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingUnfollow>()

export type InflightUnfollowCommit = {
  /**
   * The follow record the in-flight delete targets.
   */
  followUri: string
  /**
   * Resolves true when the delete was confirmed, false when it failed and
   * the optimistic UI was reverted. Never rejects.
   */
  result: Promise<boolean>
}

/**
 * Commits whose network delete is still in flight, keyed by subject did.
 * Entries are removed when the commit settles.
 */
const committing = new Map<string, InflightUnfollowCommit>()

/**
 * Stages an unfollow for `entry.did`, committing it automatically once
 * {@link UNFOLLOW_UNDO_DURATION} elapses. If an unfollow is already staged
 * for the same did (possible if a stale refetch briefly flips the follow
 * button back), it is superseded: when it targets the same follow record,
 * the old entry is discarded without committing - the new staged commit
 * performs the identical delete, so committing both would delete the same
 * record twice and double-count the unfollow metric. A staged entry for a
 * different record (shouldn't occur in practice) is committed first so it
 * isn't lost.
 */
export function stagePendingUnfollow(
  entry: Omit<PendingUnfollow, 'timeout'>,
): void {
  const existing = pending.get(entry.did)
  if (existing) {
    if (existing.followUri === entry.followUri) {
      pending.delete(entry.did)
      clearTimeout(existing.timeout)
      existing.onDiscardToast()
    } else {
      commitPendingUnfollow(entry.did)
    }
  }
  pending.set(entry.did, {
    ...entry,
    timeout: setTimeout(() => {
      commitPendingUnfollow(entry.did)
    }, UNFOLLOW_UNDO_DURATION),
  })
}

/**
 * Undoes the pending unfollow for `did`, reverting the optimistic UI without
 * any network request. Returns true if a pending unfollow existed.
 */
export function cancelPendingUnfollow(did: string): boolean {
  const entry = pending.get(did)
  if (!entry) return false
  pending.delete(did)
  clearTimeout(entry.timeout)
  entry.onDiscardToast()
  entry.revert()
  return true
}

/**
 * Commits the pending unfollow for `did` immediately. No-op if none exists.
 */
export function commitPendingUnfollow(did: string): void {
  const entry = pending.get(did)
  if (!entry) return
  pending.delete(did)
  clearTimeout(entry.timeout)
  entry.onDiscardToast()
  /*
   * The identity check in the cleanup handles overlapping commits for the
   * same did (possible via the restage-supersede path): a settled older
   * commit must not delete the tracking entry of a newer one.
   */
  const inflight: InflightUnfollowCommit = {
    followUri: entry.followUri,
    result: entry
      .commit()
      .catch(() => false)
      .finally(() => {
        if (committing.get(did) === inflight) {
          committing.delete(did)
        }
      }),
  }
  committing.set(did, inflight)
}

/**
 * Returns the in-flight commit for `did`, if its network delete has started
 * but not yet settled. Consumed inside the follow toggle queue's mutation:
 * a follow that runs during that window must wait for the delete instead of
 * racing it - the commit's success path re-stamps the unfollowed state onto
 * the profile shadow, which would clobber a follow confirmed while the
 * delete was still in flight and strand the UI on "Follow" with a live
 * follow record (inviting a duplicate record on the next tap). Waiting
 * inside the queue keeps taps serialized behind the follow, so the
 * `followingUri: 'pending'` sentinel never exists without an active queue
 * task. When the delete fails, `followUri` identifies the surviving record
 * to thread through as the queue's confirmed state.
 */
export function getInflightUnfollowCommit(
  did: string,
): InflightUnfollowCommit | undefined {
  return committing.get(did)
}

/**
 * Commits every pending unfollow. Called when the app backgrounds or the
 * web page is being unloaded, since in-memory timers won't reliably survive
 * either. Requires a still-authenticated agent; use
 * {@link discardAllPendingUnfollows} at account teardown instead.
 */
export function flushAllPendingUnfollows(): void {
  for (const did of Array.from(pending.keys())) {
    commitPendingUnfollow(did)
  }
}

/**
 * Drops every pending unfollow without committing or reverting: timers are
 * cleared and toasts dismissed, nothing else runs. Used at account teardown
 * (logout, account switch), where the captured agent's session is about to
 * be disposed and a commit could no longer authenticate. The persisted
 * write-ahead records are left in place, so the unfollows are replayed when
 * the account is next active.
 */
export function discardAllPendingUnfollows(): void {
  for (const entry of Array.from(pending.values())) {
    pending.delete(entry.did)
    clearTimeout(entry.timeout)
    entry.onDiscardToast()
  }
}

export function hasPendingUnfollow(did: string): boolean {
  return pending.has(did)
}
