import {
  cancelPendingUnfollow,
  commitPendingUnfollow,
  discardAllPendingUnfollows,
  flushAllPendingUnfollows,
  getInflightUnfollowCommit,
  hasPendingUnfollow,
  stagePendingUnfollow,
  UNFOLLOW_UNDO_DURATION,
} from '../registry'

const ACCOUNT = 'did:plc:me'
const OTHER_ACCOUNT = 'did:plc:other'

describe('unfollowUndo registry', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    flushAllPendingUnfollows()
    jest.useRealTimers()
  })

  function createEntry(did = 'did:plc:alice', rkey = 'abc') {
    const entry = {
      accountDid: ACCOUNT,
      did,
      followUri: `at://${did}/app.bsky.graph.follow/${rkey}`,
      commit: jest.fn(() => Promise.resolve(true)),
      revert: jest.fn(),
      onDiscardToast: jest.fn(),
    }
    return entry
  }

  it('commits after the undo window expires', () => {
    const entry = createEntry()
    stagePendingUnfollow(entry)
    expect(hasPendingUnfollow(ACCOUNT, entry.did)).toBe(true)
    expect(entry.commit).not.toHaveBeenCalled()

    jest.advanceTimersByTime(UNFOLLOW_UNDO_DURATION)

    expect(entry.commit).toHaveBeenCalledTimes(1)
    expect(entry.onDiscardToast).toHaveBeenCalledTimes(1)
    expect(entry.revert).not.toHaveBeenCalled()
    expect(hasPendingUnfollow(ACCOUNT, entry.did)).toBe(false)
  })

  it('cancel reverts and never commits', () => {
    const entry = createEntry()
    stagePendingUnfollow(entry)

    expect(cancelPendingUnfollow(ACCOUNT, entry.did)).toBe(true)
    expect(entry.revert).toHaveBeenCalledTimes(1)
    expect(entry.onDiscardToast).toHaveBeenCalledTimes(1)
    expect(hasPendingUnfollow(ACCOUNT, entry.did)).toBe(false)

    jest.advanceTimersByTime(UNFOLLOW_UNDO_DURATION * 2)
    expect(entry.commit).not.toHaveBeenCalled()
  })

  it('flushAllPendingUnfollows commits everything immediately', () => {
    const alice = createEntry('did:plc:alice')
    const bob = createEntry('did:plc:bob')
    stagePendingUnfollow(alice)
    stagePendingUnfollow(bob)

    flushAllPendingUnfollows()

    expect(alice.commit).toHaveBeenCalledTimes(1)
    expect(bob.commit).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(UNFOLLOW_UNDO_DURATION * 2)
    expect(alice.commit).toHaveBeenCalledTimes(1)
    expect(bob.commit).toHaveBeenCalledTimes(1)
  })

  it('discardAllPendingUnfollows dismisses toasts without committing or reverting', () => {
    const alice = createEntry('did:plc:alice')
    const bob = createEntry('did:plc:bob')
    stagePendingUnfollow(alice)
    stagePendingUnfollow(bob)

    discardAllPendingUnfollows()

    expect(alice.onDiscardToast).toHaveBeenCalledTimes(1)
    expect(bob.onDiscardToast).toHaveBeenCalledTimes(1)
    expect(hasPendingUnfollow(ACCOUNT, alice.did)).toBe(false)
    expect(hasPendingUnfollow(ACCOUNT, bob.did)).toBe(false)

    jest.advanceTimersByTime(UNFOLLOW_UNDO_DURATION * 2)
    expect(alice.commit).not.toHaveBeenCalled()
    expect(bob.commit).not.toHaveBeenCalled()
    expect(alice.revert).not.toHaveBeenCalled()
    expect(bob.revert).not.toHaveBeenCalled()
  })

  it('cancel after commit returns false and has no side effects', () => {
    const entry = createEntry()
    stagePendingUnfollow(entry)
    commitPendingUnfollow(ACCOUNT, entry.did)

    expect(cancelPendingUnfollow(ACCOUNT, entry.did)).toBe(false)
    expect(entry.commit).toHaveBeenCalledTimes(1)
    expect(entry.revert).not.toHaveBeenCalled()
  })

  it('staging the same did and followUri twice discards the first entry without committing', () => {
    const first = createEntry()
    const second = createEntry()
    stagePendingUnfollow(first)
    stagePendingUnfollow(second)

    /*
     * The staged deletes target the same record, so committing both would
     * delete it twice; the first entry is dropped and only its toast is
     * dismissed.
     */
    expect(first.onDiscardToast).toHaveBeenCalledTimes(1)
    expect(first.commit).not.toHaveBeenCalled()

    jest.advanceTimersByTime(UNFOLLOW_UNDO_DURATION)
    expect(first.commit).not.toHaveBeenCalled()
    expect(second.commit).toHaveBeenCalledTimes(1)
  })

  it('staging the same did with a different followUri commits the first entry', () => {
    const first = createEntry('did:plc:alice', 'abc')
    const second = createEntry('did:plc:alice', 'def')
    stagePendingUnfollow(first)
    stagePendingUnfollow(second)

    expect(first.commit).toHaveBeenCalledTimes(1)
    expect(second.commit).not.toHaveBeenCalled()

    jest.advanceTimersByTime(UNFOLLOW_UNDO_DURATION)
    expect(first.commit).toHaveBeenCalledTimes(1)
    expect(second.commit).toHaveBeenCalledTimes(1)
  })

  it('undo still works after a same-record restage', () => {
    const first = createEntry()
    const second = createEntry()
    stagePendingUnfollow(first)
    stagePendingUnfollow(second)

    expect(cancelPendingUnfollow(ACCOUNT, second.did)).toBe(true)
    expect(second.revert).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(UNFOLLOW_UNDO_DURATION * 2)
    expect(first.commit).not.toHaveBeenCalled()
    expect(second.commit).not.toHaveBeenCalled()
  })

  it('tracks multiple dids independently', () => {
    const alice = createEntry('did:plc:alice')
    const bob = createEntry('did:plc:bob')
    stagePendingUnfollow(alice)
    stagePendingUnfollow(bob)

    expect(cancelPendingUnfollow(ACCOUNT, alice.did)).toBe(true)

    jest.advanceTimersByTime(UNFOLLOW_UNDO_DURATION)
    expect(alice.commit).not.toHaveBeenCalled()
    expect(bob.commit).toHaveBeenCalledTimes(1)
  })

  it('scopes pending unfollows by account', () => {
    const entry = createEntry()
    stagePendingUnfollow(entry)

    expect(hasPendingUnfollow(OTHER_ACCOUNT, entry.did)).toBe(false)
    expect(hasPendingUnfollow(undefined, entry.did)).toBe(false)
    expect(cancelPendingUnfollow(OTHER_ACCOUNT, entry.did)).toBe(false)
    expect(cancelPendingUnfollow(undefined, entry.did)).toBe(false)
    expect(entry.revert).not.toHaveBeenCalled()

    expect(hasPendingUnfollow(ACCOUNT, entry.did)).toBe(true)
    expect(cancelPendingUnfollow(ACCOUNT, entry.did)).toBe(true)
  })

  it('stages the same did independently under two accounts', () => {
    const mine = createEntry()
    const other = {...createEntry(), accountDid: OTHER_ACCOUNT}
    stagePendingUnfollow(mine)
    stagePendingUnfollow(other)

    /* not a restage-supersede: the accounts differ */
    expect(mine.onDiscardToast).not.toHaveBeenCalled()

    expect(cancelPendingUnfollow(ACCOUNT, mine.did)).toBe(true)
    expect(hasPendingUnfollow(OTHER_ACCOUNT, other.did)).toBe(true)

    jest.advanceTimersByTime(UNFOLLOW_UNDO_DURATION)
    expect(mine.commit).not.toHaveBeenCalled()
    expect(other.commit).toHaveBeenCalledTimes(1)
  })

  describe('getInflightUnfollowCommit', () => {
    it('returns undefined when no commit is in flight', () => {
      const entry = createEntry()
      stagePendingUnfollow(entry)
      /* staged but not yet committed */
      expect(getInflightUnfollowCommit(ACCOUNT, entry.did)).toBeUndefined()

      cancelPendingUnfollow(ACCOUNT, entry.did)
      /* undone, so no commit ever started */
      expect(getInflightUnfollowCommit(ACCOUNT, entry.did)).toBeUndefined()
    })

    it('exposes the commit while in flight and resolves with its result', async () => {
      let resolveCommit!: (committed: boolean) => void
      const entry = {
        ...createEntry(),
        commit: jest.fn(
          () =>
            new Promise<boolean>(resolve => {
              resolveCommit = resolve
            }),
        ),
      }
      stagePendingUnfollow(entry)
      commitPendingUnfollow(ACCOUNT, entry.did)

      const inflight = getInflightUnfollowCommit(ACCOUNT, entry.did)
      expect(inflight).toBeDefined()
      expect(inflight?.followUri).toBe(entry.followUri)

      resolveCommit(true)
      await expect(inflight?.result).resolves.toBe(true)
      /* settled commits are cleaned up */
      expect(getInflightUnfollowCommit(ACCOUNT, entry.did)).toBeUndefined()
    })

    it('resolves false when the commit reports failure', async () => {
      const entry = {
        ...createEntry(),
        commit: jest.fn(() => Promise.resolve(false)),
      }
      stagePendingUnfollow(entry)
      commitPendingUnfollow(ACCOUNT, entry.did)

      const inflight = getInflightUnfollowCommit(ACCOUNT, entry.did)
      expect(inflight?.followUri).toBe(entry.followUri)
      await expect(inflight?.result).resolves.toBe(false)
      expect(getInflightUnfollowCommit(ACCOUNT, entry.did)).toBeUndefined()
    })

    it('is scoped by account', async () => {
      let resolveCommit!: (committed: boolean) => void
      const entry = {
        ...createEntry(),
        commit: jest.fn(
          () =>
            new Promise<boolean>(resolve => {
              resolveCommit = resolve
            }),
        ),
      }
      stagePendingUnfollow(entry)
      commitPendingUnfollow(ACCOUNT, entry.did)

      /*
       * The delete is in flight for ACCOUNT; another account looking at the
       * same subject did must not see it (an account switch mid-flight
       * would otherwise let the next account adopt this commit's outcome).
       */
      expect(getInflightUnfollowCommit(OTHER_ACCOUNT, entry.did)).toBe(
        undefined,
      )
      expect(getInflightUnfollowCommit(undefined, entry.did)).toBe(undefined)
      expect(getInflightUnfollowCommit(ACCOUNT, entry.did)).toBeDefined()

      resolveCommit(true)
      await getInflightUnfollowCommit(ACCOUNT, entry.did)?.result
    })

    it('tracks the same did under two accounts independently', async () => {
      let resolveMine!: (committed: boolean) => void
      let resolveOther!: (committed: boolean) => void
      const mine = {
        ...createEntry(),
        commit: jest.fn(
          () =>
            new Promise<boolean>(resolve => {
              resolveMine = resolve
            }),
        ),
      }
      const other = {
        ...createEntry(),
        accountDid: OTHER_ACCOUNT,
        commit: jest.fn(
          () =>
            new Promise<boolean>(resolve => {
              resolveOther = resolve
            }),
        ),
      }
      stagePendingUnfollow(mine)
      stagePendingUnfollow(other)
      commitPendingUnfollow(ACCOUNT, mine.did)
      commitPendingUnfollow(OTHER_ACCOUNT, other.did)

      const inflightMine = getInflightUnfollowCommit(ACCOUNT, mine.did)
      const inflightOther = getInflightUnfollowCommit(OTHER_ACCOUNT, other.did)
      expect(inflightMine).toBeDefined()
      expect(inflightOther).toBeDefined()

      resolveMine(true)
      await expect(inflightMine?.result).resolves.toBe(true)
      expect(getInflightUnfollowCommit(ACCOUNT, mine.did)).toBeUndefined()
      /* settling one account's commit must not drop the other's */
      expect(getInflightUnfollowCommit(OTHER_ACCOUNT, other.did)).toBe(
        inflightOther,
      )

      resolveOther(false)
      await expect(inflightOther?.result).resolves.toBe(false)
      expect(getInflightUnfollowCommit(OTHER_ACCOUNT, other.did)).toBe(
        undefined,
      )
    })
  })
})
