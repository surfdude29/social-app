import React from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native'
import {FontAwesomeIcon} from '@fortawesome/react-native-fontawesome'
import {ScrollView} from 'react-native-gesture-handler'
import {Text} from '../com/util/text/Text'
import {Button} from '../com/util/forms/Button'
import * as Toast from '../com/util/Toast'
import {usePalette} from 'lib/hooks/usePalette'
import {useWebMediaQueries} from 'lib/hooks/useWebMediaQueries'
import {NativeStackScreenProps} from '@react-navigation/native-stack'
import {CommonNavigatorParams} from 'lib/routes/types'
import {useAnalytics} from 'lib/analytics/analytics'
import {useFocusEffect} from '@react-navigation/native'
import {ViewHeader} from '../com/util/ViewHeader'
import {CenteredView} from 'view/com/util/Views'
import {Trans, msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'
import {useSetMinimalShellMode} from '#/state/shell'
import {useModalControls} from '#/state/modals'
import {useLanguagePrefs} from '#/state/preferences'
import {
  useAppPasswordsQuery,
  useAppPasswordDeleteMutation,
} from '#/state/queries/app-passwords'
import {ErrorScreen} from '../com/util/error/ErrorScreen'
import {cleanError} from '#/lib/strings/errors'
import * as Prompt from '#/components/Prompt'
import {useDialogControl} from '#/components/Dialog'

type Props = NativeStackScreenProps<CommonNavigatorParams, 'AppPasswords'>
export function AppPasswords({}: Props) {
  const pal = usePalette('default')
  const {_} = useLingui()
  const setMinimalShellMode = useSetMinimalShellMode()
  const {screen} = useAnalytics()
  const {isTabletOrDesktop} = useWebMediaQueries()
  const {openModal} = useModalControls()
  const {data: appPasswords, error} = useAppPasswordsQuery()

  useFocusEffect(
    React.useCallback(() => {
      screen('AppPasswords')
      setMinimalShellMode(false)
    }, [screen, setMinimalShellMode]),
  )

  const onAdd = React.useCallback(async () => {
    openModal({name: 'add-app-password'})
  }, [openModal])

  if (error) {
    return (
      <CenteredView
        style={[
          styles.container,
          isTabletOrDesktop && styles.containerDesktop,
          pal.view,
          pal.border,
        ]}
        testID="appPasswordsScreen">
        <ErrorScreen
          title={_(msg`Oops!`)}
          message={_(msg`There was an issue with fetching your app passwords`)}
          details={cleanError(error)}
        />
      </CenteredView>
    )
  }

  // no app passwords (empty) state
  if (appPasswords?.length === 0) {
    return (
      <CenteredView
        style={[
          styles.container,
          isTabletOrDesktop && styles.containerDesktop,
          pal.view,
          pal.border,
        ]}
        testID="appPasswordsScreen">
        <AppPasswordsHeader />
        <View style={[styles.empty, pal.viewLight]}>
          <Text type="lg" style={[pal.text, styles.emptyText]}>
            <Trans>
              You have not created any app passwords yet. You can create one by
              pressing the button below.
            </Trans>
          </Text>
        </View>
        {!isTabletOrDesktop && <View style={styles.flex1} />}
        <View
          style={[
            styles.btnContainer,
            isTabletOrDesktop && styles.btnContainerDesktop,
          ]}>
          <Button
            testID="appPasswordBtn"
            type="primary"
            label={_(msg`Add App Password`)}
            style={styles.btn}
            labelStyle={styles.btnLabel}
            onPress={onAdd}
          />
        </View>
      </CenteredView>
    )
  }

  if (appPasswords?.length) {
    // has app passwords
    return (
      <CenteredView
        style={[
          styles.container,
          isTabletOrDesktop && styles.containerDesktop,
          pal.view,
          pal.border,
        ]}
        testID="appPasswordsScreen">
        <AppPasswordsHeader />
        <ScrollView
          style={[
            styles.scrollContainer,
            pal.border,
            !isTabletOrDesktop && styles.flex1,
          ]}>
          {appPasswords.map((password, i) => (
            <AppPassword
              key={password.name}
              testID={`appPassword-${i}`}
              name={password.name}
              createdAt={password.createdAt}
            />
          ))}
          {isTabletOrDesktop && (
            <View style={[styles.btnContainer, styles.btnContainerDesktop]}>
              <Button
                testID="appPasswordBtn"
                type="primary"
                label={_(msg`Add App Password`)}
                style={styles.btn}
                labelStyle={styles.btnLabel}
                onPress={onAdd}
              />
            </View>
          )}
        </ScrollView>
        {!isTabletOrDesktop && (
          <View style={styles.btnContainer}>
            <Button
              testID="appPasswordBtn"
              type="primary"
              label={_(msg`Add App Password`)}
              style={styles.btn}
              labelStyle={styles.btnLabel}
              onPress={onAdd}
            />
          </View>
        )}
      </CenteredView>
    )
  }

  return (
    <CenteredView
      style={[
        styles.container,
        isTabletOrDesktop && styles.containerDesktop,
        pal.view,
        pal.border,
      ]}
      testID="appPasswordsScreen">
      <ActivityIndicator />
    </CenteredView>
  )
}

function AppPasswordsHeader() {
  const {isTabletOrDesktop} = useWebMediaQueries()
  const pal = usePalette('default')
  const {_} = useLingui()
  return (
    <>
      <ViewHeader title={_(msg`App Passwords`)} showOnDesktop />
      <Text
        type="sm"
        style={[
          styles.description,
          pal.text,
          isTabletOrDesktop && styles.descriptionDesktop,
        ]}>
        <Trans>
          Use app passwords to login to other Bluesky clients without giving
          full access to your account or password.
        </Trans>
      </Text>
    </>
  )
}

function AppPassword({
  testID,
  name,
  createdAt,
}: {
  testID: string
  name: string
  createdAt: string
}) {
  const pal = usePalette('default')
  const {_} = useLingui()
  const control = useDialogControl()
  const {contentLanguages} = useLanguagePrefs()
  const deleteMutation = useAppPasswordDeleteMutation()

  const onDelete = React.useCallback(async () => {
    await deleteMutation.mutateAsync({name})
    Toast.show(_(msg`App password deleted`))
  }, [deleteMutation, name, _])

  const onPress = React.useCallback(() => {
    control.open()
  }, [control])

  const primaryLocale =
    contentLanguages.length > 0 ? contentLanguages[0] : 'en-US'

  return (
    <TouchableOpacity
      testID={testID}
      style={[styles.item, pal.border]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={_(msg`Delete app password`)}
      accessibilityHint="">
      <View>
        <Text type="md-bold" style={pal.text}>
          {name}
        </Text>
        <Text type="md" style={[pal.text, styles.pr10]} numberOfLines={1}>
          <Trans>
            Created{' '}
            {Intl.DateTimeFormat(primaryLocale, {
              year: 'numeric',
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }).format(new Date(createdAt))}
          </Trans>
        </Text>
      </View>
      <FontAwesomeIcon icon={['far', 'trash-can']} style={styles.trashIcon} />

      <Prompt.Basic
        control={control}
        title={_(msg`Delete app password?`)}
        description={_(
          msg`Are you sure you want to delete the app password "${name}"?`,
        )}
        onConfirm={onDelete}
        confirmButtonCta={_(msg`Delete`)}
        confirmButtonColor="negative"
      />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingBottom: 100,
  },
  containerDesktop: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingBottom: 0,
  },
  title: {
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 12,
  },
  description: {
    textAlign: 'center',
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  descriptionDesktop: {
    marginTop: 14,
  },

  scrollContainer: {
    borderTopWidth: 1,
    marginTop: 4,
    marginBottom: 16,
  },

  flex1: {
    flex: 1,
  },
  empty: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderRadius: 16,
    marginHorizontal: 24,
    marginTop: 10,
  },
  emptyText: {
    textAlign: 'center',
  },

  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  pr10: {
    marginRight: 10,
  },
  btnContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  btnContainerDesktop: {
    marginTop: 14,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 32,
    paddingHorizontal: 60,
    paddingVertical: 14,
  },
  btnLabel: {
    fontSize: 18,
  },

  trashIcon: {
    color: 'red',
    minWidth: 16,
  },
})
