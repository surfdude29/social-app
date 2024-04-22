import React, {ComponentProps} from 'react'
import {StyleSheet, TouchableWithoutFeedback} from 'react-native'
import Animated from 'react-native-reanimated'
import {useSafeAreaInsets} from 'react-native-safe-area-context'
import {LinearGradient} from 'expo-linear-gradient'

import {isWeb} from '#/platform/detection'
import {useMinimalShellMode} from 'lib/hooks/useMinimalShellMode'
import {useWebMediaQueries} from 'lib/hooks/useWebMediaQueries'
import {clamp} from 'lib/numbers'
import {gradients} from 'lib/styles'

export interface FABProps
  extends ComponentProps<typeof TouchableWithoutFeedback> {
  testID?: string
  icon: JSX.Element
}

export function FABInner({testID, icon, ...props}: FABProps) {
  const insets = useSafeAreaInsets()
  const {isMobile, isTablet} = useWebMediaQueries()
  const {fabMinimalShellTransform} = useMinimalShellMode()

  const size = React.useMemo(() => {
    return isTablet ? styles.sizeLarge : styles.sizeRegular
  }, [isTablet])
  const tabletSpacing = React.useMemo(() => {
    return isTablet
      ? {right: 50, bottom: 50}
      : {
          right: 24,
          bottom: clamp(insets.bottom, 15, 60) + 15,
        }
  }, [insets.bottom, isTablet])

  return (
    <TouchableWithoutFeedback testID={testID} {...props}>
      <Animated.View
        style={[
          styles.outer,
          size,
          tabletSpacing,
          isMobile && fabMinimalShellTransform,
        ]}>
        <LinearGradient
          colors={[gradients.blueLight.start, gradients.blueLight.end]}
          start={{x: 0, y: 0}}
          end={{x: 1, y: 1}}
          style={[styles.inner, size]}>
          {icon}
        </LinearGradient>
      </Animated.View>
    </TouchableWithoutFeedback>
  )
}

const styles = StyleSheet.create({
  sizeRegular: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  sizeLarge: {
    width: 70,
    height: 70,
    borderRadius: 35,
  },
  outer: {
    // @ts-ignore web-only
    position: isWeb ? 'fixed' : 'absolute',
    zIndex: 1,
  },
  inner: {
    justifyContent: 'center',
    alignItems: 'center',
  },
})
