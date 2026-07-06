import {
  cancelPendingUnfollow,
  commitPendingUnfollow,
  flushAllPendingUnfollows,
  hasPendingUnfollow,
  stagePendingUnfollow,
  UNFOLLOW_UNDO_DURATION,
} from '../registry'

describe('unfollowUndo registry', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    flushAllPendingUnfollows()
    jest.useRealTimers()
  })

  function createEntry(did = 'did:plc:alice') {
    const entry = {
      did,
      followUri: `at://${did}/app.bsky.graph.follow/abc`,
      commit: jest.fn(async () => {}),
      revert: jest.fn(),
      onDiscardToast: jest.fn(),
    }
    return entry
  }

  it('commits after the undo window expires', () => {
    const entry = createEntry()
    stagePendingUnfollow(entry)
    expect(hasPendingUnfollow(entry.did)).toBe(true)
    expect(entry.commit).not.toHaveBeenCalled()

    jest.advanceTimersByTime(UNFOLLOW_UNDO_DURATION)

    expect(entry.commit).toHaveBeenCalledTimes(1)
    expect(entry.onDiscardToast).toHaveBeenCalledTimes(1)
    expect(entry.revert).not.toHaveBeenCalled()
    expect(hasPendingUnfollow(entry.did)).toBe(false)
  })

  it('cancel reverts and never commits', () => {
    const entry = createEntry()
    stagePendingUnfollow(entry)

    expect(cancelPendingUnfollow(entry.did)).toBe(true)
    expect(entry.revert).toHaveBeenCalledTimes(1)
    expect(entry.onDiscardToast).toHaveBeenCalledTimes(1)
    expect(hasPendingUnfollow(entry.did)).toBe(false)

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

  it('cancel after commit returns false and has no side effects', () => {
    const entry = createEntry()
    stagePendingUnfollow(entry)
    commitPendingUnfollow(entry.did)

    expect(cancelPendingUnfollow(entry.did)).toBe(false)
    expect(entry.commit).toHaveBeenCalledTimes(1)
    expect(entry.revert).not.toHaveBeenCalled()
  })

  it('staging the same did twice commits the first entry', () => {
    const first = createEntry()
    const second = createEntry()
    stagePendingUnfollow(first)
    stagePendingUnfollow(second)

    expect(first.commit).toHaveBeenCalledTimes(1)
    expect(second.commit).not.toHaveBeenCalled()

    jest.advanceTimersByTime(UNFOLLOW_UNDO_DURATION)
    expect(first.commit).toHaveBeenCalledTimes(1)
    expect(second.commit).toHaveBeenCalledTimes(1)
  })

  it('tracks multiple dids independently', () => {
    const alice = createEntry('did:plc:alice')
    const bob = createEntry('did:plc:bob')
    stagePendingUnfollow(alice)
    stagePendingUnfollow(bob)

    expect(cancelPendingUnfollow(alice.did)).toBe(true)

    jest.advanceTimersByTime(UNFOLLOW_UNDO_DURATION)
    expect(alice.commit).not.toHaveBeenCalled()
    expect(bob.commit).toHaveBeenCalledTimes(1)
  })
})
