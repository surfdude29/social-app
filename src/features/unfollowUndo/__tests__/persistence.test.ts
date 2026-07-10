import {account as accountStorage} from '#/storage'
import {
  getPersistedPendingUnfollows,
  partitionReplayablePendingUnfollows,
  persistPendingUnfollow,
  REPLAY_MIN_AGE,
  unpersistPendingUnfollow,
} from '../persistence'

jest.mock('#/storage', () => {
  const store = new Map<string, unknown>()
  return {
    account: {
      get: (scopes: string[]) => store.get(scopes.join(':')),
      set: (scopes: string[], data: unknown) =>
        store.set(scopes.join(':'), data),
      remove: (scopes: string[]) => store.delete(scopes.join(':')),
      removeAll: () => store.clear(),
    },
  }
})

const ACCOUNT = 'did:plc:me'

function entry(did = 'did:plc:alice', rkey = 'abc', stagedAt = 1_000_000) {
  return {did, followUri: `at://${did}/app.bsky.graph.follow/${rkey}`, stagedAt}
}

describe('unfollowUndo persistence', () => {
  afterEach(() => {
    accountStorage.removeAll()
  })

  it('persists and reads entries without clearing them', () => {
    const alice = entry('did:plc:alice')
    const bob = entry('did:plc:bob')
    persistPendingUnfollow(ACCOUNT, alice)
    persistPendingUnfollow(ACCOUNT, bob)

    /* reading is a peek: entries stay until their outcome removes them */
    expect(getPersistedPendingUnfollows(ACCOUNT)).toEqual([alice, bob])
    expect(getPersistedPendingUnfollows(ACCOUNT)).toEqual([alice, bob])
  })

  it('replaces an existing entry for the same did', () => {
    persistPendingUnfollow(ACCOUNT, entry('did:plc:alice', 'abc'))
    persistPendingUnfollow(ACCOUNT, entry('did:plc:alice', 'def'))

    expect(getPersistedPendingUnfollows(ACCOUNT)).toEqual([
      entry('did:plc:alice', 'def'),
    ])
  })

  it('unpersists a matching entry and leaves the rest', () => {
    const alice = entry('did:plc:alice')
    const bob = entry('did:plc:bob')
    persistPendingUnfollow(ACCOUNT, alice)
    persistPendingUnfollow(ACCOUNT, bob)

    unpersistPendingUnfollow(ACCOUNT, alice)

    expect(getPersistedPendingUnfollows(ACCOUNT)).toEqual([bob])
  })

  it('unpersist matches on did and followUri, ignoring stagedAt', () => {
    persistPendingUnfollow(ACCOUNT, entry('did:plc:alice', 'abc', 1_000_000))

    /* a same-record restage refreshed the timestamp; still the same delete */
    unpersistPendingUnfollow(ACCOUNT, entry('did:plc:alice', 'abc', 2_000_000))

    expect(getPersistedPendingUnfollows(ACCOUNT)).toEqual([])
  })

  it('unpersist leaves an entry for the same did with a different followUri', () => {
    const original = entry('did:plc:alice', 'abc')
    const restaged = entry('did:plc:alice', 'def')
    persistPendingUnfollow(ACCOUNT, original)
    /* the user refollowed and unfollowed again: a new record owns the slot */
    persistPendingUnfollow(ACCOUNT, restaged)

    /* the old record's delete settling must not clear the newer entry */
    unpersistPendingUnfollow(ACCOUNT, original)

    expect(getPersistedPendingUnfollows(ACCOUNT)).toEqual([restaged])
  })

  it('unpersist is a no-op when nothing is stored', () => {
    expect(() =>
      unpersistPendingUnfollow(ACCOUNT, entry('did:plc:alice')),
    ).not.toThrow()
    expect(getPersistedPendingUnfollows(ACCOUNT)).toEqual([])
  })

  it('scopes entries by account', () => {
    const alice = entry('did:plc:alice')
    persistPendingUnfollow(ACCOUNT, alice)

    expect(getPersistedPendingUnfollows('did:plc:other')).toEqual([])
    expect(getPersistedPendingUnfollows(ACCOUNT)).toEqual([alice])
  })
})

describe('partitionReplayablePendingUnfollows', () => {
  const NOW = 10_000_000

  it('marks entries at or past the minimum age as replayable', () => {
    const old = entry('did:plc:alice', 'abc', NOW - REPLAY_MIN_AGE)
    const older = entry('did:plc:bob', 'def', NOW - REPLAY_MIN_AGE * 2)

    expect(partitionReplayablePendingUnfollows([old, older], NOW)).toEqual({
      replayable: [old, older],
      deferred: [],
      retryDelayMs: undefined,
    })
  })

  it('defers young entries and reports the time until the youngest ages in', () => {
    const justStaged = entry('did:plc:alice', 'abc', NOW)
    const halfway = entry('did:plc:bob', 'def', NOW - REPLAY_MIN_AGE / 2)

    expect(
      partitionReplayablePendingUnfollows([justStaged, halfway], NOW),
    ).toEqual({
      replayable: [],
      deferred: [justStaged, halfway],
      retryDelayMs: REPLAY_MIN_AGE / 2,
    })
  })

  it('splits mixed lists', () => {
    const old = entry('did:plc:alice', 'abc', NOW - REPLAY_MIN_AGE - 1)
    const young = entry('did:plc:bob', 'def', NOW - 1)

    expect(partitionReplayablePendingUnfollows([old, young], NOW)).toEqual({
      replayable: [old],
      deferred: [young],
      retryDelayMs: REPLAY_MIN_AGE - 1,
    })
  })

  it('treats entries without stagedAt as replayable', () => {
    const legacy = {
      did: 'did:plc:alice',
      followUri: 'at://did:plc:alice/app.bsky.graph.follow/abc',
    }

    expect(partitionReplayablePendingUnfollows([legacy], NOW)).toEqual({
      replayable: [legacy],
      deferred: [],
      retryDelayMs: undefined,
    })
  })

  it('handles empty input', () => {
    expect(partitionReplayablePendingUnfollows([], NOW)).toEqual({
      replayable: [],
      deferred: [],
      retryDelayMs: undefined,
    })
  })
})
