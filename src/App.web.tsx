import 'lib/sentry' // must be near top

import React, {useState, useEffect} from 'react'
import {PersistQueryClientProvider} from '@tanstack/react-query-persist-client'
import {SafeAreaProvider} from 'react-native-safe-area-context'
import {RootSiblingParent} from 'react-native-root-siblings'

import 'view/icons'

import {ThemeProvider as Alf} from '#/alf'
import {useColorModeTheme} from '#/alf/util/useColorModeTheme'
import {init as initPersistedState} from '#/state/persisted'
import {Shell} from 'view/shell/index'
import {ToastContainer} from 'view/com/util/Toast.web'
import {ThemeProvider} from 'lib/ThemeContext'
import {
  queryClient,
  asyncStoragePersister,
  dehydrateOptions,
} from 'lib/react-query'
import {Provider as ShellStateProvider} from 'state/shell'
import {Provider as ModalStateProvider} from 'state/modals'
import {Provider as DialogStateProvider} from 'state/dialogs'
import {Provider as LightboxStateProvider} from 'state/lightbox'
import {Provider as MutedThreadsProvider} from 'state/muted-threads'
import {Provider as InvitesStateProvider} from 'state/invites'
import {Provider as PrefsStateProvider} from 'state/preferences'
import {Provider as LoggedOutViewProvider} from 'state/shell/logged-out'
import {Provider as SelectedFeedProvider} from 'state/shell/selected-feed'
import {Provider as LabelDefsProvider} from '#/state/preferences/label-defs'
import I18nProvider from './locale/i18nProvider'
import {
  Provider as SessionProvider,
  useSession,
  useSessionApi,
} from 'state/session'
import {Provider as UnreadNotifsProvider} from 'state/queries/notifications/unread'
import * as persisted from '#/state/persisted'
import {Provider as PortalProvider} from '#/components/Portal'
import {Provider as StatsigProvider} from '#/lib/statsig/statsig'
import {useIntentHandler} from 'lib/hooks/useIntentHandler'

function InnerApp() {
  const {isInitialLoad, currentAccount} = useSession()
  const {resumeSession} = useSessionApi()
  const theme = useColorModeTheme()
  useIntentHandler()

  // init
  useEffect(() => {
    const account = persisted.get('session').currentAccount
    resumeSession(account)
  }, [resumeSession])

  // wait for session to resume
  if (isInitialLoad) return null

  return (
    <Alf theme={theme}>
      <React.Fragment
        // Resets the entire tree below when it changes:
        key={currentAccount?.did}>
        <StatsigProvider>
          <LabelDefsProvider>
            <LoggedOutViewProvider>
              <SelectedFeedProvider>
                <UnreadNotifsProvider>
                  <ThemeProvider theme={theme}>
                    {/* All components should be within this provider */}
                    <RootSiblingParent>
                      <SafeAreaProvider>
                        <Shell />
                      </SafeAreaProvider>
                    </RootSiblingParent>
                    <ToastContainer />
                  </ThemeProvider>
                </UnreadNotifsProvider>
              </SelectedFeedProvider>
            </LoggedOutViewProvider>
          </LabelDefsProvider>
        </StatsigProvider>
      </React.Fragment>
    </Alf>
  )
}

function App() {
  const [isReady, setReady] = useState(false)

  React.useEffect(() => {
    initPersistedState().then(() => setReady(true))
  }, [])

  if (!isReady) {
    return null
  }

  /*
   * NOTE: only nothing here can depend on other data or session state, since
   * that is set up in the InnerApp component above.
   */
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{persister: asyncStoragePersister, dehydrateOptions}}>
      <SessionProvider>
        <ShellStateProvider>
          <PrefsStateProvider>
            <MutedThreadsProvider>
              <InvitesStateProvider>
                <ModalStateProvider>
                  <DialogStateProvider>
                    <LightboxStateProvider>
                      <I18nProvider>
                        <PortalProvider>
                          <InnerApp />
                        </PortalProvider>
                      </I18nProvider>
                    </LightboxStateProvider>
                  </DialogStateProvider>
                </ModalStateProvider>
              </InvitesStateProvider>
            </MutedThreadsProvider>
          </PrefsStateProvider>
        </ShellStateProvider>
      </SessionProvider>
    </PersistQueryClientProvider>
  )
}

export default App
