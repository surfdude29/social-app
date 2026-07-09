import {account as accountStorage} from '#/storage'

export type PersistedPendingUnfollow = {
  /**
   * The did of the unfollowed profile (not the account performing the
   * unfollow).
   */
  did: string
  followUri: string
}

/*
 * Pending unfollows are persisted as a write-ahead log so that a commit
 * cancelled mid-flight (page refresh/close on web, app kill on native) is
 * replayed on the next launch instead of being silently dropped. Entries are
 * written at stage time and removed when the delete commits, the user undoes,
 * or the commit fails while the app is still alive.
 */

/**
 * Records a staged unfollow for `accountDid`. Replaces any existing entry for
 * the same subject did (restaging supersedes the earlier stage).
 */
export function persistPendingUnfollow(
  accountDid: string,
  entry: PersistedPendingUnfollow,
): void {
  const existing = accountStorage.get([accountDid, 'pendingUnfollows']) ?? []
  accountStorage.set(
    [accountDid, 'pendingUnfollows'],
    [...existing.filter(e => e.did !== entry.did), entry],
  )
}

/**
 * Removes the persisted entry for `did`, if any. Safe to call when no entry
 * exists.
 */
export function unpersistPendingUnfollow(
  accountDid: string,
  did: string,
): void {
  const existing = accountStorage.get([accountDid, 'pendingUnfollows'])
  if (!existing?.length) return
  const next = existing.filter(e => e.did !== did)
  if (next.length) {
    accountStorage.set([accountDid, 'pendingUnfollows'], next)
  } else {
    accountStorage.remove([accountDid, 'pendingUnfollows'])
  }
}

/**
 * Returns all persisted entries for `accountDid` and clears them. Used by the
 * launch-time replay; entries are attempted once and not re-queued.
 */
export function takePersistedPendingUnfollows(
  accountDid: string,
): PersistedPendingUnfollow[] {
  const existing = accountStorage.get([accountDid, 'pendingUnfollows']) ?? []
  if (existing.length) {
    accountStorage.remove([accountDid, 'pendingUnfollows'])
  }
  return existing
}
