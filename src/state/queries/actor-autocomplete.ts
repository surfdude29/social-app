import React from 'react'
import {AppBskyActorDefs, moderateProfile, ModerationOpts} from '@atproto/api'
import {useQuery, useQueryClient} from '@tanstack/react-query'

import {isJustAMute} from '#/lib/moderation'
import {logger} from '#/logger'
import {STALE} from '#/state/queries'
import {getAgent} from '#/state/session'
import {DEFAULT_LOGGED_OUT_PREFERENCES, useModerationOpts} from './preferences'

const DEFAULT_MOD_OPTS = {
  userDid: undefined,
  prefs: DEFAULT_LOGGED_OUT_PREFERENCES.moderationPrefs,
}

const RQKEY_ROOT = 'actor-autocomplete'
export const RQKEY = (prefix: string) => [RQKEY_ROOT, prefix]

export function useActorAutocompleteQuery(prefix: string) {
  const moderationOpts = useModerationOpts()

  prefix = prefix.toLowerCase()

  return useQuery<AppBskyActorDefs.ProfileViewBasic[]>({
    staleTime: STALE.MINUTES.ONE,
    queryKey: RQKEY(prefix || ''),
    async queryFn() {
      const res = prefix
        ? await getAgent().searchActorsTypeahead({
            q: prefix,
            limit: 8,
          })
        : undefined
      return res?.data.actors || []
    },
    select: React.useCallback(
      (data: AppBskyActorDefs.ProfileViewBasic[]) => {
        return computeSuggestions(data, moderationOpts || DEFAULT_MOD_OPTS)
      },
      [moderationOpts],
    ),
  })
}

export type ActorAutocompleteFn = ReturnType<typeof useActorAutocompleteFn>
export function useActorAutocompleteFn() {
  const queryClient = useQueryClient()
  const moderationOpts = useModerationOpts()

  return React.useCallback(
    async ({query, limit = 8}: {query: string; limit?: number}) => {
      query = query.toLowerCase()
      let res
      if (query) {
        try {
          res = await queryClient.fetchQuery({
            staleTime: STALE.MINUTES.ONE,
            queryKey: RQKEY(query || ''),
            queryFn: () =>
              getAgent().searchActorsTypeahead({
                q: query,
                limit,
              }),
          })
        } catch (e) {
          logger.error('useActorSearch: searchActorsTypeahead failed', {
            message: e,
          })
        }
      }

      return computeSuggestions(
        res?.data.actors,
        moderationOpts || DEFAULT_MOD_OPTS,
      )
    },
    [queryClient, moderationOpts],
  )
}

function computeSuggestions(
  searched: AppBskyActorDefs.ProfileViewBasic[] = [],
  moderationOpts: ModerationOpts,
) {
  let items: AppBskyActorDefs.ProfileViewBasic[] = []
  for (const item of searched) {
    if (!items.find(item2 => item2.handle === item.handle)) {
      items.push(item)
    }
  }
  return items.filter(profile => {
    const modui = moderateProfile(profile, moderationOpts).ui('profileList')
    return !modui.filter || isJustAMute(modui)
  })
}
