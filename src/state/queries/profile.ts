import {useCallback} from 'react'
import {
  type AppBskyActorDefs,
  type AppBskyActorGetProfile,
  type AppBskyActorGetProfiles,
  type AppBskyActorProfile,
  type AppBskyGraphGetFollows,
  type AtpAgent,
  AtUri,
  type ComAtprotoRepoUploadBlob,
  moderateProfile,
  type Un$Typed,
} from '@atproto/api'
import {useLingui} from '@lingui/react/macro'
import {
  type InfiniteData,
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import {uploadBlob} from '#/lib/api'
import {until} from '#/lib/async/until'
import {useToggleMutationQueue} from '#/lib/hooks/useToggleMutationQueue'
import {sanitizeDisplayName} from '#/lib/strings/display-names'
import {logger} from '#/logger'
import {updateProfileShadow} from '#/state/cache/profile-shadow'
import {type Shadow} from '#/state/cache/types'
import {type ImageMeta} from '#/state/gallery'
import {useModerationOpts} from '#/state/preferences/moderation-opts'
import {STALE} from '#/state/queries'
import {resetProfilePostsQueries} from '#/state/queries/post-feed'
import {RQKEY as PROFILE_FOLLOWS_RQKEY} from '#/state/queries/profile-follows'
import {
  unstableCacheProfileView,
  useUnstableProfileViewCache,
} from '#/state/queries/unstable-profile-cache'
import {useUpdateProfileVerificationCache} from '#/state/queries/verification/useUpdateProfileVerificationCache'
import {useAgent, useSession} from '#/state/session'
import * as userActionHistory from '#/state/userActionHistory'
import * as Toast from '#/components/Toast'
import {useAnalytics} from '#/analytics'
import {type Metrics, toClout} from '#/analytics/metrics'
import {
  cancelPendingUnfollow,
  getInflightUnfollowCommit,
  isPageUnloading,
  persistPendingUnfollow,
  showUnfollowUndoToast,
  stagePendingUnfollow,
  unpersistPendingUnfollow,
} from '#/features/unfollowUndo'
import type * as bsky from '#/types/bsky'
import {
  ProgressGuideAction,
  useProgressGuideControls,
} from '../shell/progress-guide'
import {RQKEY_ROOT as RQKEY_LIST_CONVOS} from './messages/list-conversations'
import {RQKEY as RQKEY_MY_BLOCKED} from './my-blocked-accounts'
import {RQKEY as RQKEY_MY_MUTED} from './my-muted-accounts'

export * from '#/state/queries/unstable-profile-cache'
/**
 * @deprecated use {@link unstableCacheProfileView} instead
 */
export const precacheProfile = unstableCacheProfileView

const RQKEY_ROOT = 'profile'
export const RQKEY = (did: string) => [RQKEY_ROOT, did]

export const profilesQueryKeyRoot = 'profiles'
export const profilesQueryKey = (handles: string[]) => [
  profilesQueryKeyRoot,
  handles,
]

export function useProfileQuery({
  did,
  staleTime = STALE.SECONDS.FIFTEEN,
}: {
  did: string | undefined
  staleTime?: number
}) {
  const agent = useAgent()
  const {getUnstableProfile} = useUnstableProfileViewCache()
  return useQuery<AppBskyActorDefs.ProfileViewDetailed>({
    // WARNING
    // this staleTime is load-bearing
    // if you remove it, the UI infinite-loops
    // -prf
    staleTime,
    refetchOnWindowFocus: true,
    queryKey: RQKEY(did ?? ''),
    queryFn: async () => {
      const res = await agent.getProfile({actor: did ?? ''})
      return res.data
    },
    placeholderData: () => {
      if (!did) return
      return getUnstableProfile(did) as AppBskyActorDefs.ProfileViewDetailed
    },
    enabled: !!did,
  })
}

export function useProfilesQuery({
  handles,
  maintainData,
}: {
  handles: string[]
  maintainData?: boolean
}) {
  const agent = useAgent()
  return useQuery({
    enabled: handles.length > 0,
    staleTime: STALE.MINUTES.FIVE,
    queryKey: profilesQueryKey(handles),
    queryFn: async () => {
      const res = await agent.getProfiles({actors: handles})
      return res.data
    },
    placeholderData: maintainData ? keepPreviousData : undefined,
  })
}

export function usePrefetchProfileQuery() {
  const agent = useAgent()
  const queryClient = useQueryClient()
  const prefetchProfileQuery = useCallback(
    async (did: string) => {
      await queryClient.prefetchQuery({
        staleTime: STALE.SECONDS.THIRTY,
        queryKey: RQKEY(did),
        queryFn: async () => {
          const res = await agent.getProfile({actor: did || ''})
          return res.data
        },
      })
    },
    [queryClient, agent],
  )
  return prefetchProfileQuery
}

interface ProfileUpdateParams {
  profile: AppBskyActorDefs.ProfileViewDetailed
  updates:
    | Un$Typed<AppBskyActorProfile.Record>
    | ((
        existing: Un$Typed<AppBskyActorProfile.Record>,
      ) => Un$Typed<AppBskyActorProfile.Record>)
  newUserAvatar?: ImageMeta | undefined | null
  newUserBanner?: ImageMeta | undefined | null
  checkCommitted?: (res: AppBskyActorGetProfile.Response) => boolean
}
export function useProfileUpdateMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()
  const updateProfileVerificationCache = useUpdateProfileVerificationCache()
  return useMutation<void, Error, ProfileUpdateParams>({
    mutationFn: async ({
      profile,
      updates,
      newUserAvatar,
      newUserBanner,
      checkCommitted,
    }) => {
      let newUserAvatarPromise:
        | Promise<ComAtprotoRepoUploadBlob.Response>
        | undefined
      if (newUserAvatar) {
        newUserAvatarPromise = uploadBlob(
          agent,
          newUserAvatar.path,
          newUserAvatar.mime,
        )
      }
      let newUserBannerPromise:
        | Promise<ComAtprotoRepoUploadBlob.Response>
        | undefined
      if (newUserBanner) {
        newUserBannerPromise = uploadBlob(
          agent,
          newUserBanner.path,
          newUserBanner.mime,
        )
      }
      await agent.upsertProfile(async existing => {
        let next: Un$Typed<AppBskyActorProfile.Record> = existing || {}
        if (typeof updates === 'function') {
          next = updates(next)
        } else {
          next.displayName = updates.displayName || undefined
          next.description = updates.description || undefined
          if ('pinnedPost' in updates) {
            next.pinnedPost = updates.pinnedPost
          }
        }
        if (newUserAvatarPromise) {
          const res = await newUserAvatarPromise
          next.avatar = res.data.blob
        } else if (newUserAvatar === null) {
          next.avatar = undefined
        }
        if (newUserBannerPromise) {
          const res = await newUserBannerPromise
          next.banner = res.data.blob
        } else if (newUserBanner === null) {
          next.banner = undefined
        }
        return next
      })
      await whenAppViewReady(
        agent,
        profile.did,
        checkCommitted ||
          (res => {
            if (typeof newUserAvatar !== 'undefined') {
              if (newUserAvatar === null && res.data.avatar) {
                // url hasn't cleared yet
                return false
              } else if (res.data.avatar === profile.avatar) {
                // url hasn't changed yet
                return false
              }
            }
            if (typeof newUserBanner !== 'undefined') {
              if (newUserBanner === null && res.data.banner) {
                // url hasn't cleared yet
                return false
              } else if (res.data.banner === profile.banner) {
                // url hasn't changed yet
                return false
              }
            }
            if (typeof updates === 'function') {
              return true
            }
            return (
              res.data.displayName === updates.displayName &&
              res.data.description === updates.description
            )
          }),
      )
    },
    async onSuccess(_, variables) {
      // invalidate cache
      void queryClient.invalidateQueries({
        queryKey: RQKEY(variables.profile.did),
      })
      void queryClient.invalidateQueries({
        queryKey: [profilesQueryKeyRoot, [variables.profile.did]],
      })
      await updateProfileVerificationCache({profile: variables.profile})
    },
  })
}

type FollowsQueryData = InfiniteData<AppBskyGraphGetFollows.OutputSchema>

/**
 * Optimistically removes an unfollowed profile from the current account's
 * follows cache (used e.g. for avatar displays).
 */
function removeProfileFromFollowsCache(
  queryClient: QueryClient,
  currentAccountDid: string,
  did: string,
) {
  queryClient.setQueryData<FollowsQueryData>(
    PROFILE_FOLLOWS_RQKEY(currentAccountDid),
    old => {
      if (!old?.pages?.[0]) return old
      return {
        ...old,
        pages: old.pages.map(page => ({
          ...page,
          follows: page.follows.filter(f => f.did !== did),
        })),
      }
    },
  )
}

/**
 * Optimistically prepends a followed profile to the current account's
 * follows cache. No-op if the profile is already present.
 */
function prependProfileToFollowsCache(
  queryClient: QueryClient,
  currentAccountDid: string,
  profile: bsky.profile.AnyProfileView,
) {
  queryClient.setQueryData<FollowsQueryData>(
    PROFILE_FOLLOWS_RQKEY(currentAccountDid),
    old => {
      if (!old?.pages?.[0]) return old
      const alreadyExists = old.pages[0].follows.some(
        f => f.did === profile.did,
      )
      if (alreadyExists) return old
      return {
        ...old,
        pages: [
          {
            ...old.pages[0],
            follows: [
              profile as AppBskyActorDefs.ProfileView,
              ...old.pages[0].follows,
            ],
          },
          ...old.pages.slice(1),
        ],
      }
    },
  )
}

export function useProfileFollowMutationQueue(
  profile: Shadow<bsky.profile.AnyProfileView>,
  logContext: Metrics['profile:follow']['logContext'],
  position?: number,
  contextProfileDid?: string,
) {
  const agent = useAgent()
  const queryClient = useQueryClient()
  const {currentAccount} = useSession()
  const ax = useAnalytics()
  const moderationOpts = useModerationOpts()
  const {t: l} = useLingui()
  const did = profile.did
  const initialFollowingUri = profile.viewer?.following
  const followMutation = useProfileFollowMutation(
    logContext,
    profile,
    position,
    contextProfileDid,
  )
  const unfollowMutation = useProfileUnfollowMutation(logContext)

  const queueToggle = useToggleMutationQueue({
    initialState: initialFollowingUri,
    runMutation: async (prevFollowingUri, shouldFollow) => {
      if (shouldFollow) {
        /*
         * A buffered unfollow whose delete is in flight (the undo window
         * just expired) must settle before a new follow record is created.
         * Racing it risks the delete response arriving after the follow's:
         * the commit's success path would then re-stamp the unfollowed
         * state, stranding the UI on "Follow" with a live follow record -
         * and a second tap would create a duplicate record, after which one
         * unfollow no longer fully unfollows. Waiting here, inside the
         * toggle queue, keeps later taps serialized behind this task and
         * preserves the invariant that the `followingUri: 'pending'`
         * sentinel never exists while the queue is empty.
         */
        const inflight = getInflightUnfollowCommit(did)
        if (inflight) {
          const committed = await inflight.result
          if (!committed) {
            /*
             * The delete failed and its revert already restored the
             * followed state - the user still follows the original record,
             * so there is nothing to create. Thread that record through as
             * the confirmed state. Callers can't tell this apart from a
             * real follow and may show a "Following" toast; that's
             * acceptable for this rare double failure window, since the
             * message matches the actual state.
             */
            return inflight.followUri
          }
          /*
           * Re-stamp: the commit's success path just stamped the unfollowed
           * state, which would flash "Follow" while the follow request runs.
           */
          updateProfileShadow(queryClient, did, {
            followingUri: 'pending',
          })
        }
        const {uri} = await followMutation.mutateAsync({
          did,
        })
        userActionHistory.follow([did])
        return uri
      } else {
        if (prevFollowingUri) {
          await unfollowMutation.mutateAsync({
            did,
            followUri: prevFollowingUri,
          })
          userActionHistory.unfollow([did])
        }
        return undefined
      }
    },
    onSuccess(finalFollowingUri) {
      // finalize
      updateProfileShadow(queryClient, did, {
        followingUri: finalFollowingUri,
      })

      // Optimistically update profile follows cache for avatar displays
      if (currentAccount?.did) {
        if (finalFollowingUri) {
          prependProfileToFollowsCache(queryClient, currentAccount.did, profile)
        } else {
          removeProfileFromFollowsCache(queryClient, currentAccount.did, did)
        }
      }

      if (finalFollowingUri) {
        void agent.app.bsky.graph
          .getSuggestedFollowsByActor({
            actor: did,
          })
          .then(res => {
            const dids = res.data.suggestions
              .filter(a => !a.viewer?.following)
              .map(a => a.did)
              .slice(0, 8)
            userActionHistory.followSuggestion(dids)
          })
      }
    },
  })

  const queueFollow = useCallback(() => {
    /*
     * A buffered unfollow means the follow record still exists server-side.
     * Cancel the staged delete (which also reverts the optimistic UI)
     * instead of creating a duplicate follow record.
     */
    if (cancelPendingUnfollow(did)) {
      return Promise.resolve(undefined)
    }
    // optimistically update
    updateProfileShadow(queryClient, did, {
      followingUri: 'pending',
    })
    return queueToggle(true)
  }, [queryClient, did, queueToggle])

  const queueUnfollow = useCallback(() => {
    const followUri = initialFollowingUri
    if (followUri && followUri !== 'pending') {
      /*
       * Buffered unfollow: update the UI optimistically, stage the actual
       * network delete behind the undo window, and show a toast with an
       * Undo action. On undo the staged delete is discarded and the UI
       * reverts - no request is ever made. Everything the commit needs is
       * captured here, since by the time it runs the optimistic shadow
       * update has already cleared `profile.viewer?.following` and the
       * component may have unmounted.
       */
      const currentAccountDid = currentAccount?.did
      /*
       * A redundant tap: the same record's delete is already on the wire
       * (the undo window just expired and a stale refetch flipped the
       * button back to "Following"). Re-apply the optimistic UI and let the
       * in-flight commit's own handlers finish the job - staging again
       * would fire a second delete for the same record and double-count the
       * unfollow metric, and an Undo toast would be a lie since the delete
       * can't be recalled. If the delete fails, its revert restores
       * "Following", correctly undoing this tap too.
       */
      const inflight = getInflightUnfollowCommit(did)
      if (inflight && inflight.followUri === followUri) {
        updateProfileShadow(queryClient, did, {
          followingUri: undefined,
        })
        if (currentAccountDid) {
          removeProfileFromFollowsCache(queryClient, currentAccountDid, did)
        }
        return Promise.resolve(undefined)
      }
      updateProfileShadow(queryClient, did, {
        followingUri: undefined,
      })
      if (currentAccountDid) {
        removeProfileFromFollowsCache(queryClient, currentAccountDid, did)
        /*
         * Write-ahead record: if the commit is cancelled mid-flight (page
         * refresh/close, app kill), the unfollow is replayed on next launch
         * instead of being silently dropped.
         */
        persistPendingUnfollow(currentAccountDid, {
          did,
          followUri,
          stagedAt: Date.now(),
        })
      }
      const errorMessage = l`An issue occurred, please try again.`
      const restoreOptimisticUI = () => {
        updateProfileShadow(queryClient, did, {
          followingUri: followUri,
        })
        if (currentAccountDid) {
          prependProfileToFollowsCache(queryClient, currentAccountDid, profile)
        }
      }
      const revert = () => {
        if (currentAccountDid) {
          unpersistPendingUnfollow(currentAccountDid, {did, followUri})
        }
        restoreOptimisticUI()
      }
      let toastId: string | undefined
      stagePendingUnfollow({
        did,
        followUri,
        revert,
        onDiscardToast: () => {
          if (toastId) {
            Toast.dismiss(toastId)
          }
        },
        commit: async () => {
          try {
            ax.metric('profile:unfollow', {logContext})
            await agent.deleteFollow(followUri)
            userActionHistory.unfollow([did])
            if (currentAccountDid) {
              unpersistPendingUnfollow(currentAccountDid, {did, followUri})
            }
            /*
             * A refetch during the undo window creates fresh cache objects
             * that still reflect the server's pre-delete state and carry no
             * shadow (shadows are keyed by object identity), which flips the
             * UI back to "Following". Re-stamp the confirmed delete so the
             * UI can't stay stuck on the stale state.
             */
            updateProfileShadow(queryClient, did, {
              followingUri: undefined,
            })
            if (currentAccountDid) {
              removeProfileFromFollowsCache(queryClient, currentAccountDid, did)
            }
            return true
          } catch (e) {
            /*
             * A failure while the page is unloading means the browser
             * cancelled the fetch. Keep the persisted record so the unfollow
             * is replayed on next launch; reverting UI or toasting a dying
             * page is pointless.
             */
            if (isPageUnloading()) return true
            revert()
            logger.error('Failed to commit buffered unfollow', {
              safeMessage: e,
            })
            Toast.show(errorMessage, {type: 'error'})
            return false
          }
        },
      })
      toastId = showUnfollowUndoToast({
        displayName: sanitizeDisplayName(
          profile.displayName || profile.handle,
          moderationOpts
            ? moderateProfile(profile, moderationOpts).ui('displayName')
            : undefined,
        ),
        onUndo: () => {
          cancelPendingUnfollow(did)
        },
      })
      return Promise.resolve(undefined)
    }
    /*
     * No confirmed follow record yet (a follow is still in flight) or
     * already unfollowed: fall through to the toggle queue, which threads
     * the confirmed uri into the delete. No undo toast in this case.
     */
    updateProfileShadow(queryClient, did, {
      followingUri: undefined,
    })
    return queueToggle(false)
  }, [
    initialFollowingUri,
    currentAccount?.did,
    queryClient,
    did,
    profile,
    moderationOpts,
    l,
    ax,
    logContext,
    agent,
    queueToggle,
  ])

  return [queueFollow, queueUnfollow] as const
}

function useProfileFollowMutation(
  logContext: Metrics['profile:follow']['logContext'],
  profile: Shadow<bsky.profile.AnyProfileView>,
  position?: number,
  contextProfileDid?: string,
) {
  const ax = useAnalytics()
  const {currentAccount} = useSession()
  const agent = useAgent()
  const queryClient = useQueryClient()
  const {captureAction} = useProgressGuideControls()

  return useMutation<{uri: string; cid: string}, Error, {did: string}>({
    mutationFn: async ({did}) => {
      let ownProfile: AppBskyActorDefs.ProfileViewDetailed | undefined
      if (currentAccount) {
        ownProfile = findProfileQueryData(queryClient, currentAccount.did)
      }
      captureAction(ProgressGuideAction.Follow)
      ax.metric('profile:follow', {
        logContext,
        didBecomeMutual: profile.viewer
          ? Boolean(profile.viewer.followedBy)
          : undefined,
        followeeClout:
          'followersCount' in profile
            ? toClout(profile.followersCount)
            : undefined,
        followeeDid: did,
        followerClout: toClout(ownProfile?.followersCount),
        position,
        contextProfileDid,
      })
      return await agent.follow(did)
    },
  })
}

function useProfileUnfollowMutation(
  logContext: Metrics['profile:unfollow']['logContext'],
) {
  const ax = useAnalytics()
  const agent = useAgent()
  return useMutation<void, Error, {did: string; followUri: string}>({
    mutationFn: async ({followUri}) => {
      ax.metric('profile:unfollow', {logContext})
      return await agent.deleteFollow(followUri)
    },
  })
}

export function useProfileMuteMutationQueue(
  profile: Shadow<bsky.profile.AnyProfileView>,
) {
  const ax = useAnalytics()
  const queryClient = useQueryClient()
  const did = profile.did
  const initialMuted = profile.viewer?.muted
  const muteMutation = useProfileMuteMutation()
  const unmuteMutation = useProfileUnmuteMutation()

  const queueToggle = useToggleMutationQueue({
    initialState: initialMuted,
    runMutation: async (_prevMuted, shouldMute) => {
      if (shouldMute) {
        await muteMutation.mutateAsync({
          did,
        })
        ax.metric('profile:mute', {})
        return true
      } else {
        await unmuteMutation.mutateAsync({
          did,
        })
        ax.metric('profile:unmute', {})
        return false
      }
    },
    onSuccess(finalMuted) {
      // finalize
      updateProfileShadow(queryClient, did, {muted: finalMuted})
    },
  })

  const queueMute = useCallback(() => {
    // optimistically update
    updateProfileShadow(queryClient, did, {
      muted: true,
    })
    return queueToggle(true)
  }, [queryClient, did, queueToggle])

  const queueUnmute = useCallback(() => {
    // optimistically update
    updateProfileShadow(queryClient, did, {
      muted: false,
    })
    return queueToggle(false)
  }, [queryClient, did, queueToggle])

  return [queueMute, queueUnmute] as const
}

function useProfileMuteMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()
  return useMutation<void, Error, {did: string}>({
    mutationFn: async ({did}) => {
      await agent.mute(did)
    },
    onSuccess() {
      void queryClient.invalidateQueries({queryKey: RQKEY_MY_MUTED()})
    },
  })
}

function useProfileUnmuteMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()
  return useMutation<void, Error, {did: string}>({
    mutationFn: async ({did}) => {
      await agent.unmute(did)
    },
    onSuccess() {
      void queryClient.invalidateQueries({queryKey: RQKEY_MY_MUTED()})
    },
  })
}

export function useProfileBlockMutationQueue(
  profile: Shadow<bsky.profile.AnyProfileView>,
) {
  const ax = useAnalytics()
  const queryClient = useQueryClient()
  const did = profile.did
  const initialBlockingUri = profile.viewer?.blocking
  const blockMutation = useProfileBlockMutation()
  const unblockMutation = useProfileUnblockMutation()

  const queueToggle = useToggleMutationQueue({
    initialState: initialBlockingUri,
    runMutation: async (prevBlockUri, shouldFollow) => {
      if (shouldFollow) {
        const {uri} = await blockMutation.mutateAsync({
          did,
        })
        ax.metric('profile:block', {})
        return uri
      } else {
        if (prevBlockUri) {
          await unblockMutation.mutateAsync({
            did,
            blockUri: prevBlockUri,
          })
          ax.metric('profile:unblock', {})
        }
        return undefined
      }
    },
    onSuccess(finalBlockingUri) {
      // finalize
      updateProfileShadow(queryClient, did, {
        blockingUri: finalBlockingUri,
      })
      // The shadow only reaches components that read profiles through shadow
      // hooks. The convo list is also read raw (e.g. the unread badge's
      // calculateCount, getMessageInfo), and blocks emit no chat log event,
      // so without a refetch that data stays stale indefinitely.
      void queryClient.invalidateQueries({queryKey: [RQKEY_LIST_CONVOS]})
    },
  })

  const queueBlock = useCallback(() => {
    // optimistically update
    updateProfileShadow(queryClient, did, {
      blockingUri: 'pending',
    })
    return queueToggle(true)
  }, [queryClient, did, queueToggle])

  const queueUnblock = useCallback(() => {
    // optimistically update
    updateProfileShadow(queryClient, did, {
      blockingUri: undefined,
    })
    return queueToggle(false)
  }, [queryClient, did, queueToggle])

  return [queueBlock, queueUnblock] as const
}

function useProfileBlockMutation() {
  const {currentAccount} = useSession()
  const agent = useAgent()
  const queryClient = useQueryClient()
  return useMutation<{uri: string; cid: string}, Error, {did: string}>({
    mutationFn: async ({did}) => {
      if (!currentAccount) {
        throw new Error('Not signed in')
      }
      return await agent.app.bsky.graph.block.create(
        {repo: currentAccount.did},
        {subject: did, createdAt: new Date().toISOString()},
      )
    },
    onSuccess(_, {did}) {
      void queryClient.invalidateQueries({queryKey: RQKEY_MY_BLOCKED()})
      resetProfilePostsQueries(queryClient, did, 1000)
    },
  })
}

function useProfileUnblockMutation() {
  const {currentAccount} = useSession()
  const agent = useAgent()
  const queryClient = useQueryClient()
  return useMutation<void, Error, {did: string; blockUri: string}>({
    mutationFn: async ({blockUri}) => {
      if (!currentAccount) {
        throw new Error('Not signed in')
      }
      const {rkey} = new AtUri(blockUri)
      await agent.app.bsky.graph.block.delete({
        repo: currentAccount.did,
        rkey,
      })
    },
    onSuccess(_, {did}) {
      resetProfilePostsQueries(queryClient, did, 1000)
    },
  })
}

async function whenAppViewReady(
  agent: AtpAgent,
  actor: string,
  fn: (res: AppBskyActorGetProfile.Response) => boolean,
) {
  await until(
    5, // 5 tries
    1e3, // 1s delay between tries
    fn,
    () => agent.app.bsky.actor.getProfile({actor}),
  )
}

export function* findAllProfilesInQueryData(
  queryClient: QueryClient,
  did: string,
): Generator<AppBskyActorDefs.ProfileViewDetailed, void> {
  const profileQueryDatas =
    queryClient.getQueriesData<AppBskyActorDefs.ProfileViewDetailed>({
      queryKey: [RQKEY_ROOT],
    })
  for (const [_queryKey, queryData] of profileQueryDatas) {
    if (!queryData) {
      continue
    }
    if (queryData.did === did) {
      yield queryData
    }
  }
  const profilesQueryDatas =
    queryClient.getQueriesData<AppBskyActorGetProfiles.OutputSchema>({
      queryKey: [profilesQueryKeyRoot],
    })
  for (const [_queryKey, queryData] of profilesQueryDatas) {
    if (!queryData) {
      continue
    }
    for (let profile of queryData.profiles) {
      if (profile.did === did) {
        yield profile
      }
    }
  }
}

export function findProfileQueryData(
  queryClient: QueryClient,
  did: string,
): AppBskyActorDefs.ProfileViewDetailed | undefined {
  return queryClient.getQueryData<AppBskyActorDefs.ProfileViewDetailed>(
    RQKEY(did),
  )
}
