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
 * Removes the persisted entry matching `entry`'s did and followUri, if any.
 * Safe to call when no such entry exists. Matching on the followUri too (and
 * not just the did) means a settling delete for an old record can never
 * remove the entry of a newer unfollow staged for the same did after the
 * user refollowed - only that newer stage's own outcome may clear its slot.
 * `stagedAt` is deliberately ignored: restaging the same record refreshes
 * the timestamp without changing which delete the entry stands for.
 */
export function unpersistPendingUnfollow(
  accountDid: string,
  entry: Pick<PersistedPendingUnfollow, 'did' | 'followUri'>,
): void {
  const existing = accountStorage.get([accountDid, 'pendingUnfollows'])
  if (!existing?.length) return
  const next = existing.filter(
    e => e.did !== entry.did || e.followUri !== entry.followUri,
  )
  if (next.length === existing.length) return
  if (next.length) {
    accountStorage.set([accountDid, 'pendingUnfollows'], next)
  } else {
    accountStorage.remove([accountDid, 'pendingUnfollows'])
  }
}

/**
 * Returns all persisted entries for `accountDid` without modifying storage.
 * Entries are only ever removed once their outcome is known - commit/replay
 * success, undo, or a definitive failure - via
 * {@link unpersistPendingUnfollow}. The replay must not clear entries up
 * front: an entry whose replayed delete is still in flight has to survive
 * the app dying again, and on web a young entry must stay visible to the
 * tab that staged it (storage is shared across tabs) so its undo can still
 * find and remove it.
 */
export function getPersistedPendingUnfollows(
  accountDid: string,
): PersistedPendingUnfollow[] {
  return accountStorage.get([accountDid, 'pendingUnfollows']) ?? []
}

/**
 * Splits entries into those old enough to replay now and those that must be
 * deferred (left in storage untouched) because their staging context may
 * still be driving them. `retryDelayMs` is the time until the next deferred
 * entry becomes eligible, so a caller can schedule exactly one follow-up
 * pass; undefined when nothing was deferred.
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
