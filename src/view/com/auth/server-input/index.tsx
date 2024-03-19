import React from 'react'
import {View} from 'react-native'
import {useLingui} from '@lingui/react'
import {Trans, msg} from '@lingui/macro'
import {BSKY_SERVICE} from 'lib/constants'
import * as persisted from '#/state/persisted'

import {atoms as a, useBreakpoints, useTheme} from '#/alf'
import * as Dialog from '#/components/Dialog'
import {Text, P} from '#/components/Typography'
import {Button, ButtonText} from '#/components/Button'
import * as ToggleButton from '#/components/forms/ToggleButton'
import * as TextField from '#/components/forms/TextField'
import {Globe_Stroke2_Corner0_Rounded as Globe} from '#/components/icons/Globe'

export function ServerInputDialog({
  control,
  onSelect,
}: {
  control: Dialog.DialogOuterProps['control']
  onSelect: (url: string) => void
}) {
  const {_} = useLingui()
  const t = useTheme()
  const {gtMobile} = useBreakpoints()
  const [pdsAddressHistory, setPdsAddressHistory] = React.useState<string[]>(
    persisted.get('pdsAddressHistory') || [],
  )
  const [fixedOption, setFixedOption] = React.useState([BSKY_SERVICE])
  const [customAddress, setCustomAddress] = React.useState('')

  const onClose = React.useCallback(() => {
    let url
    if (fixedOption[0] === 'custom') {
      url = customAddress.trim().toLowerCase()
      if (!url) {
        return
      }
    } else {
      url = fixedOption[0]
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (url === 'localhost' || url.startsWith('localhost:')) {
        url = `http://${url}`
      } else {
        url = `https://${url}`
      }
    }

    if (fixedOption[0] === 'custom') {
      if (!pdsAddressHistory.includes(url)) {
        const newHistory = [url, ...pdsAddressHistory.slice(0, 4)]
        setPdsAddressHistory(newHistory)
        persisted.write('pdsAddressHistory', newHistory)
      }
    }

    onSelect(url)
  }, [
    fixedOption,
    customAddress,
    onSelect,
    pdsAddressHistory,
    setPdsAddressHistory,
  ])

  return (
    <Dialog.Outer
      control={control}
      nativeOptions={{sheet: {snapPoints: ['100%']}}}
      onClose={onClose}>
      <Dialog.Handle />

      <Dialog.ScrollableInner
        accessibilityDescribedBy="dialog-description"
        accessibilityLabelledBy="dialog-title">
        <View style={[a.relative, a.gap_md, a.w_full]}>
          <Text nativeID="dialog-title" style={[a.text_2xl, a.font_bold]}>
            <Trans>Choose Service</Trans>
          </Text>
          <P nativeID="dialog-description" style={[a.text_sm]}>
            <Trans>Select the service that hosts your data.</Trans>
          </P>

          <ToggleButton.Group
            label="Preferences"
            values={fixedOption}
            onChange={setFixedOption}>
            <ToggleButton.Button name={BSKY_SERVICE} label={_(msg`Bluesky`)}>
              {_(msg`Bluesky`)}
            </ToggleButton.Button>
            <ToggleButton.Button
              testID="customSelectBtn"
              name="custom"
              label={_(msg`Custom`)}>
              {_(msg`Custom`)}
            </ToggleButton.Button>
          </ToggleButton.Group>

          {fixedOption[0] === 'custom' && (
            <View
              style={[
                a.border,
                t.atoms.border_contrast_low,
                a.rounded_sm,
                a.px_md,
                a.py_md,
              ]}>
              <TextField.Label nativeID="address-input-label">
                <Trans>Server address</Trans>
              </TextField.Label>
              <TextField.Root>
                <TextField.Icon icon={Globe} />
                <Dialog.Input
                  testID="customServerTextInput"
                  value={customAddress}
                  onChangeText={setCustomAddress}
                  label="my-server.com"
                  accessibilityLabelledBy="address-input-label"
                  autoCapitalize="none"
                  keyboardType="url"
                />
              </TextField.Root>
              {pdsAddressHistory.length > 0 && (
                <View style={[a.flex_row, a.flex_wrap, a.mt_xs]}>
                  {pdsAddressHistory.map(uri => (
                    <Button
                      key={uri}
                      variant="ghost"
                      color="primary"
                      label={uri}
                      style={[a.px_sm, a.py_xs, a.rounded_sm, a.gap_sm]}
                      onPress={() => setCustomAddress(uri)}>
                      <ButtonText>{uri}</ButtonText>
                    </Button>
                  ))}
                </View>
              )}
            </View>
          )}

          <View style={[a.py_xs]}>
            <P
              style={[
                t.atoms.text_contrast_medium,
                a.text_sm,
                a.leading_snug,
                a.flex_1,
              ]}>
              <Trans>
                Bluesky is an open network where you can choose your hosting
                provider. Custom hosting is now available in beta for
                developers.
              </Trans>
            </P>
          </View>

          <View style={gtMobile && [a.flex_row, a.justify_end]}>
            <Button
              testID="doneBtn"
              variant="outline"
              color="primary"
              size="small"
              onPress={() => control.close()}
              label={_(msg`Done`)}>
              {_(msg`Done`)}
            </Button>
          </View>
        </View>
      </Dialog.ScrollableInner>
    </Dialog.Outer>
  )
}
