import React from 'react'
import type {AccessibilityProps, GestureResponderEvent} from 'react-native'
import {BottomSheetProps} from '@gorhom/bottom-sheet'

import {ViewStyleProp} from '#/alf'

type A11yProps = Required<AccessibilityProps>

/**
 * Mutated by useImperativeHandle to provide a public API for controlling the
 * dialog. The methods here will actually become the handlers defined within
 * the `Dialog.Outer` component.
 *
 * `Partial<GestureResponderEvent>` here allows us to add this directly to the
 * `onPress` prop of a button, for example. If this type was not added, we
 * would need to create a function to wrap `.open()` with.
 */
export type DialogControlRefProps = {
  open: (
    options?: DialogControlOpenOptions & Partial<GestureResponderEvent>,
  ) => void
  close: (callback?: () => void) => void
}

/**
 * The return type of the useDialogControl hook.
 */
export type DialogControlProps = DialogControlRefProps & {
  id: string
  ref: React.RefObject<DialogControlRefProps>
  isOpen?: boolean
}

export type DialogContextProps = {
  close: DialogControlProps['close']
}

export type DialogControlOpenOptions = {
  /**
   * NATIVE ONLY
   *
   * Optional index of the snap point to open the bottom sheet to. Defaults to
   * 0, which is the first snap point (i.e. "open").
   */
  index?: number
}

export type DialogOuterProps = {
  control: DialogControlProps
  onClose?: () => void
  nativeOptions?: {
    sheet?: Omit<BottomSheetProps, 'children'>
  }
  webOptions?: {}
  testID?: string
}

type DialogInnerPropsBase<T> = React.PropsWithChildren<ViewStyleProp> & T
export type DialogInnerProps =
  | DialogInnerPropsBase<{
      label?: undefined
      accessibilityLabelledBy: A11yProps['aria-labelledby']
      accessibilityDescribedBy: string
    }>
  | DialogInnerPropsBase<{
      label: string
      accessibilityLabelledBy?: undefined
      accessibilityDescribedBy?: undefined
    }>
