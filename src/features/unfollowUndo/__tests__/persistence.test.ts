import {
  persistPendingUnfollow,
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

function entry(did = 'did:plc:alice', rkey = 'abc') {
  return {did, followUri: `at://${did}/app.bsky.graph.follow/${rkey}`}
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
