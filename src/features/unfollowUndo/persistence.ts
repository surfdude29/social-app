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
 * or the commit fails while the app is still alive. Entries also double as
 * cross-tab ownership tokens for live commits: a commit only fires while its
 * entry is still persisted, so an Undo (or an earlier commit) in one tab
 * stands another tab's timer down for the same record.
 *
 * Known limitation: on web the backing store is shared localStorage, and the
 * helpers below read-modify-write one array per account with no cross-tab
 * locking. Two tabs mutating the same account's entries within the same few
 * milliseconds (the synchronous get-to-set gap plus the browser's
 * cross-process replication lag) can therefore lose one write: an entry can
 * be dropped, degrading to the pre-buffering behavior where an interrupted
 * unfollow is simply lost, or an entry another tab just removed can be
 * resurrected, in which case an undone unfollow replays later - visibly,
 * since the replay re-stamps the profile shadow. Closing the race means
 * per-(account, did) storage keys or async cross-tab locking; both are
 * storage-layer refactors deliberately deferred, since every writer is a
 * user action or a network settlement and the collision odds are tiny.
 */

/**
 * Records a staged unfollow for `accountDid`. Replaces any existing entry for
 * the same subject did (restaging supersedes the earlier stage) - which also
 * transfers ownership: a superseded context's commit finds its entry gone at
 * fire time and stands down.
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
 * Removes entries matching `predicate` for `accountDid`, dropping the
 * storage key when the last entry goes. Safe to call when nothing matches.
 */
function unpersistMatching(
  accountDid: string,
  predicate: (e: PersistedPendingUnfollow) => boolean,
): void {
  const existing = accountStorage.get([accountDid, 'pendingUnfollows'])
  if (!existing?.length) return
  const next = existing.filter(e => !predicate(e))
  if (next.length === existing.length) return
  if (next.length) {
    accountStorage.set([accountDid, 'pendingUnfollows'], next)
  } else {
    accountStorage.remove([accountDid, 'pendingUnfollows'])
  }
}

/**
 * Removes the persisted entry exactly matching `entry` - did, followUri AND
 * stagedAt - if any. Safe to call when no such entry exists. This is the
 * settlement remover: a settling delete (commit or replay, success or
 * definitive failure) may remove only the entry it started with. Restaging
 * the same record refreshes `stagedAt` and hands the slot to the newer
 * staging, so an older delete settling later must leave that entry to its
 * own outcome - clearing it would make the newer staging's commit find its
 * slot empty and stand down, wrongly restoring "Following" for a record the
 * settled delete may just have removed. Matching the followUri guards the
 * refollow case the same way: after the user refollowed and unfollowed
 * again, a new record owns the slot. For an explicit Undo, which recalls the
 * record's staging whichever context wrote it, use
 * {@link unpersistPendingUnfollowRecord} instead.
 */
export function unpersistPendingUnfollow(
  accountDid: string,
  entry: Pick<PersistedPendingUnfollow, 'did' | 'followUri' | 'stagedAt'>,
): void {
  unpersistMatching(
    accountDid,
    e =>
      e.did === entry.did &&
      e.followUri === entry.followUri &&
      e.stagedAt === entry.stagedAt,
  )
}

/**
 * Removes the persisted entry for `entry`'s did and followUri regardless of
 * which staging wrote it (`stagedAt` is ignored). This is the explicit-Undo
 * remover: an Undo recalls the unfollow of this record no matter which
 * context most recently restaged it - on web another tab's restage may hold
 * the slot with a fresher timestamp, and emptying the slot is what stands
 * every tab's commit down. Settlement paths must not use this; they remove
 * only their own entry via {@link unpersistPendingUnfollow}.
 */
export function unpersistPendingUnfollowRecord(
  accountDid: string,
  entry: Pick<PersistedPendingUnfollow, 'did' | 'followUri'>,
): void {
  unpersistMatching(
    accountDid,
    e => e.did === entry.did && e.followUri === entry.followUri,
  )
}

/**
 * Returns all persisted entries for `accountDid` without modifying storage.
 * Entries are only ever removed once their outcome is known - commit/replay
 * success or a definitive failure via {@link unpersistPendingUnfollow}, or
 * an undo via {@link unpersistPendingUnfollowRecord}. The replay must not
 * clear entries up front: an entry whose replayed delete is still in flight
 * has to survive the app dying again, and on web a young entry must stay
 * visible to the tab that staged it (storage is shared across tabs) so its
 * undo can still find and remove it.
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
