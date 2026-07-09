import {
  partitionReplayablePendingUnfollows,
  persistPendingUnfollow,
  REPLAY_MIN_AGE,
  takePersistedPendingUnfollows,
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
    },
  }
})

const ACCOUNT = 'did:plc:me'

function entry(did = 'did:plc:alice', rkey = 'abc', stagedAt = 1_000_000) {
  return {did, followUri: `at://${did}/app.bsky.graph.follow/${rkey}`, stagedAt}
}

describe('unfollowUndo persistence', () => {
  afterEach(() => {
    takePersistedPendingUnfollows(ACCOUNT)
  })

  it('persists and takes entries, clearing them', () => {
    const alice = entry('did:plc:alice')
    const bob = entry('did:plc:bob')
    persistPendingUnfollow(ACCOUNT, alice)
    persistPendingUnfollow(ACCOUNT, bob)

    expect(takePersistedPendingUnfollows(ACCOUNT)).toEqual([alice, bob])
    expect(takePersistedPendingUnfollows(ACCOUNT)).toEqual([])
  })

  it('replaces an existing entry for the same did', () => {
    persistPendingUnfollow(ACCOUNT, entry('did:plc:alice', 'abc'))
    persistPendingUnfollow(ACCOUNT, entry('did:plc:alice', 'def'))

    expect(takePersistedPendingUnfollows(ACCOUNT)).toEqual([
      entry('did:plc:alice', 'def'),
    ])
  })

  it('unpersists a single did and leaves the rest', () => {
    const alice = entry('did:plc:alice')
    const bob = entry('did:plc:bob')
    persistPendingUnfollow(ACCOUNT, alice)
    persistPendingUnfollow(ACCOUNT, bob)

    unpersistPendingUnfollow(ACCOUNT, alice.did)

    expect(takePersistedPendingUnfollows(ACCOUNT)).toEqual([bob])
  })

  it('unpersist is a no-op when nothing is stored', () => {
    expect(() =>
      unpersistPendingUnfollow(ACCOUNT, 'did:plc:alice'),
    ).not.toThrow()
    expect(takePersistedPendingUnfollows(ACCOUNT)).toEqual([])
  })

  it('scopes entries by account', () => {
    const alice = entry('did:plc:alice')
    persistPendingUnfollow(ACCOUNT, alice)

    expect(takePersistedPendingUnfollows('did:plc:other')).toEqual([])
    expect(takePersistedPendingUnfollows(ACCOUNT)).toEqual([alice])
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
