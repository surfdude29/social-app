import {type AppBskyActorDefs, type AppBskyGraphGetFollows} from '@atproto/api'
import {
  type InfiniteData,
  type QueryClient,
  type QueryKey,
  useInfiniteQuery,
} from '@tanstack/react-query'

import {STALE} from '#/state/queries'
import {useAgent} from '#/state/session'
import type * as bsky from '#/types/bsky'

const PAGE_SIZE = 30
type RQPageParam = string | undefined

// TODO refactor invalidate on mutate?
const RQKEY_ROOT = 'profile-follows'
export const RQKEY = (did: string) => [RQKEY_ROOT, did]

export function useProfileFollowsQuery(
  did: string | undefined,
  {
    limit,
  }: {
    limit?: number
  } = {
    limit: PAGE_SIZE,
  },
) {
  const agent = useAgent()
  return useInfiniteQuery<
    AppBskyGraphGetFollows.OutputSchema,
    Error,
    InfiniteData<AppBskyGraphGetFollows.OutputSchema>,
    QueryKey,
    RQPageParam
  >({
    staleTime: STALE.MINUTES.ONE,
    queryKey: RQKEY(did || ''),
    async queryFn({pageParam}: {pageParam: RQPageParam}) {
      const res = await agent.app.bsky.graph.getFollows({
        actor: did || '',
        limit: limit || PAGE_SIZE,
        cursor: pageParam,
      })
      return res.data
    },
    initialPageParam: undefined,
    getNextPageParam: lastPage => lastPage.cursor,
    enabled: !!did,
  })
}

type FollowsQueryData = InfiniteData<AppBskyGraphGetFollows.OutputSchema>

/**
 * Optimistically removes an unfollowed profile from the current account's
 * follows cache (used e.g. for avatar displays).
 */
export function removeProfileFromFollowsCache(
  queryClient: QueryClient,
  currentAccountDid: string,
  did: string,
) {
  queryClient.setQueryData<FollowsQueryData>(RQKEY(currentAccountDid), old => {
    if (!old?.pages?.[0]) return old
    return {
      ...old,
      pages: old.pages.map(page => ({
        ...page,
        follows: page.follows.filter(f => f.did !== did),
      })),
    }
  })
}

/**
 * Optimistically prepends a followed profile to the current account's
 * follows cache. No-op if the profile is already present.
 */
export function prependProfileToFollowsCache(
  queryClient: QueryClient,
  currentAccountDid: string,
  profile: bsky.profile.AnyProfileView,
) {
  queryClient.setQueryData<FollowsQueryData>(RQKEY(currentAccountDid), old => {
    if (!old?.pages?.[0]) return old
    /*
     * Scan every page, not just the first: a refetch during the undo
     * window restores the still-server-side follow, and it can land on
     * any page. Prepending without looking past page one would duplicate
     * the profile when the undo (or a commit failure) re-adds it.
     */
    const alreadyExists = old.pages.some(page =>
      page.follows.some(f => f.did === profile.did),
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
  })
}

export function* findAllProfilesInQueryData(
  queryClient: QueryClient,
  did: string,
): Generator<AppBskyActorDefs.ProfileView, void> {
  const queryDatas = queryClient.getQueriesData<
    InfiniteData<AppBskyGraphGetFollows.OutputSchema>
  >({
    queryKey: [RQKEY_ROOT],
  })
  for (const [_queryKey, queryData] of queryDatas) {
    if (!queryData?.pages) {
      continue
    }
    for (const page of queryData?.pages) {
      for (const follow of page.follows) {
        if (follow.did === did) {
          yield follow
        }
      }
    }
  }
}
