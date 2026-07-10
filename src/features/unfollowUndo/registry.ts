/**
 * Window during which a staged unfollow can be undone. The undo toast's
 * duration is kept in sync with this value.
 */
export const UNFOLLOW_UNDO_DURATION = 5e3

type PendingUnfollow = {
  /**
   * The did of the account performing the unfollow. Registry state is keyed
   * by (account, subject): the maps below are module-level and outlive the
   * account-keyed app subtree, so on account switch an entry captured under
   * the previous account - in particular a commit whose delete is still in
   * flight - must never be visible to lookups made under the next account.
   */
  accountDid: string
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

/**
 * Composite map key. A did cannot contain a space
 * (https://atproto.com/specs/did), so the join is unambiguous.
 */
function registryKey(accountDid: string, did: string): string {
  return `${accountDid} ${did}`
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
 * Commits whose network delete is still in flight, keyed by (account,
 * subject). Entries are removed when the commit settles. The account in the
 * key matters here even more than for `pending`: pending entries are
 * discarded at account teardown, but an in-flight delete cannot be recalled
 * and its entry outlives the switch - it must not be discoverable by the
 * next account, whose own follow state for the same subject is unrelated.
 */
const committing = new Map<string, InflightUnfollowCommit>()

/**
 * Stages an unfollow for `entry.did` on behalf of `entry.accountDid`,
 * committing it automatically once {@link UNFOLLOW_UNDO_DURATION} elapses.
 * If an unfollow is already staged for the same account and did (possible
 * if a stale refetch briefly flips the follow button back), it is
 * superseded: when it targets the same follow record, the old entry is
 * discarded without committing - the new staged commit performs the
 * identical delete, so committing both would delete the same record twice
 * and double-count the unfollow metric. A staged entry for a different
 * record (shouldn't occur in practice) is committed first so it isn't lost.
 */
export function stagePendingUnfollow(
  entry: Omit<PendingUnfollow, 'timeout'>,
): void {
  const key = registryKey(entry.accountDid, entry.did)
  const existing = pending.get(key)
  if (existing) {
    if (existing.followUri === entry.followUri) {
      pending.delete(key)
      clearTimeout(existing.timeout)
      existing.onDiscardToast()
    } else {
      commitPendingUnfollow(entry.accountDid, entry.did)
    }
  }
  pending.set(key, {
    ...entry,
    timeout: setTimeout(() => {
      commitPendingUnfollow(entry.accountDid, entry.did)
    }, UNFOLLOW_UNDO_DURATION),
  })
}

/**
 * Undoes the pending unfollow for `did` under `accountDid`, reverting the
 * optimistic UI without any network request. Returns true if a pending
 * unfollow existed. `accountDid` may be undefined (no signed-in account) for
 * caller convenience; nothing can be staged without one, so it never
 * matches.
 */
export function cancelPendingUnfollow(
  accountDid: string | undefined,
  did: string,
): boolean {
  if (accountDid === undefined) return false
  const key = registryKey(accountDid, did)
  const entry = pending.get(key)
  if (!entry) return false
  pending.delete(key)
  clearTimeout(entry.timeout)
  entry.onDiscardToast()
  entry.revert()
  return true
}

/**
 * Commits the pending unfollow for `did` under `accountDid` immediately.
 * No-op if none exists.
 */
export function commitPendingUnfollow(accountDid: string, did: string): void {
  const key = registryKey(accountDid, did)
  const entry = pending.get(key)
  if (!entry) return
  pending.delete(key)
  clearTimeout(entry.timeout)
  entry.onDiscardToast()
  /*
   * The identity check in the cleanup handles overlapping commits for the
   * same key (possible via the restage-supersede path): a settled older
   * commit must not delete the tracking entry of a newer one.
   */
  const inflight: InflightUnfollowCommit = {
    followUri: entry.followUri,
    result: entry
      .commit()
      .catch(() => false)
      .finally(() => {
        if (committing.get(key) === inflight) {
          committing.delete(key)
        }
      }),
  }
  committing.set(key, inflight)
}

/**
 * Returns the in-flight commit for `did` under `accountDid`, if its network
 * delete has started but not yet settled. Consumed inside the follow toggle
 * queue's mutation: a follow that runs during that window must wait for the
 * delete instead of racing it - the commit's success path re-stamps the
 * unfollowed state onto the profile shadow, which would clobber a follow
 * confirmed while the delete was still in flight and strand the UI on
 * "Follow" with a live follow record (inviting a duplicate record on the
 * next tap). Waiting inside the queue keeps taps serialized behind the
 * follow, so the `followingUri: 'pending'` sentinel never exists without an
 * active queue task. When the delete fails, `followUri` identifies the
 * surviving record to thread through as the queue's confirmed state.
 */
export function getInflightUnfollowCommit(
  accountDid: string | undefined,
  did: string,
): InflightUnfollowCommit | undefined {
  if (accountDid === undefined) return undefined
  return committing.get(registryKey(accountDid, did))
}

/**
 * Commits every pending unfollow. Called when the app backgrounds or the
 * web page is being unloaded, since in-memory timers won't reliably survive
 * either. Requires a still-authenticated agent; use
 * {@link discardAllPendingUnfollows} at account teardown instead.
 */
export function flushAllPendingUnfollows(): void {
  for (const entry of Array.from(pending.values())) {
    commitPendingUnfollow(entry.accountDid, entry.did)
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
    pending.delete(registryKey(entry.accountDid, entry.did))
    clearTimeout(entry.timeout)
    entry.onDiscardToast()
  }
}

export function hasPendingUnfollow(
  accountDid: string | undefined,
  did: string,
): boolean {
  if (accountDid === undefined) return false
  return pending.has(registryKey(accountDid, did))
}
