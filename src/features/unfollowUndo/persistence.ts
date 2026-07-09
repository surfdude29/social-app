import {account as accountStorage} from '#/storage'
import {UNFOLLOW_UNDO_DURATION} from './registry'

export type PersistedPendingUnfollow = {
  /**
   * The did of the unfollowed profile (not the account performing the
   * unfollow).
   */
  did: string
  followUri: string
  /**
   * Epoch ms at which the unfollow was staged. Always written; optional only
   * so entries persisted before this field existed remain readable (they are
   * treated as very old, i.e. immediately replayable). Preserved verbatim
   * when an entry is re-persisted by the replay.
   */
  stagedAt?: number
}

/**
 * Minimum age before a persisted entry is eligible for replay: the undo
 * window plus slack for the commit's network round trip. Below this age the
 * staging context (this tab before a reload, or another tab on web - the
 * storage is shared across tabs there) may still be driving the entry
 * through its normal lifecycle, committing it or removing it via undo, and
 * a replay would race that. In particular, replaying a young entry while
 * its Undo toast is still live in another tab would delete the record out
 * from under the undo.
 */
export const REPLAY_MIN_AGE = UNFOLLOW_UNDO_DURATION + 10e3

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
 * Returns all persisted entries for `accountDid` and clears them. The replay
 * re-persists any entry it cannot safely fire yet (too young, still in
 * flight locally) or whose delete failed with a network error.
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

/**
 * Splits entries into those old enough to replay now and those that must be
 * deferred (re-persisted) because their staging context may still be driving
 * them. `retryDelayMs` is the time until the next deferred entry becomes
 * eligible, so a caller can schedule exactly one follow-up pass; undefined
 * when nothing was deferred.
 */
export function partitionReplayablePendingUnfollows(
  entries: PersistedPendingUnfollow[],
  now: number,
): {
  replayable: PersistedPendingUnfollow[]
  deferred: PersistedPendingUnfollow[]
  retryDelayMs: number | undefined
} {
  const replayable: PersistedPendingUnfollow[] = []
  const deferred: PersistedPendingUnfollow[] = []
  let retryDelayMs: number | undefined
  for (const entry of entries) {
    const age = now - (entry.stagedAt ?? 0)
    if (age >= REPLAY_MIN_AGE) {
      replayable.push(entry)
    } else {
      deferred.push(entry)
      const remaining = REPLAY_MIN_AGE - age
      if (retryDelayMs === undefined || remaining < retryDelayMs) {
        retryDelayMs = remaining
      }
    }
  }
  return {replayable, deferred, retryDelayMs}
}
