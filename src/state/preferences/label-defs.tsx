import React from 'react'
import {InterpretedLabelValueDefinition, AppBskyLabelerDefs} from '@atproto/api'
import {useLabelDefinitionsQuery} from '../queries/preferences'

interface StateContext {
  labelDefs: Record<string, InterpretedLabelValueDefinition[]>
  labelers: AppBskyLabelerDefs.LabelerViewDetailed[]
}

const stateContext = React.createContext<StateContext>({
  labelDefs: {},
  labelers: [],
})

export function Provider({children}: React.PropsWithChildren<{}>) {
  const {labelDefs, labelers} = useLabelDefinitionsQuery()

  const state = {labelDefs, labelers}

  return <stateContext.Provider value={state}>{children}</stateContext.Provider>
}

export function useLabelDefinitions() {
  return React.useContext(stateContext)
}
