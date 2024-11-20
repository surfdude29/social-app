const pkg = require('./package.json')

const SPLASH_CONFIG = {
  backgroundColor: '#ffffff',
  image: './assets/splash.png',
  resizeMode: 'cover',
}
const DARK_SPLASH_CONFIG = {
  backgroundColor: '#001429',
  image: './assets/splash-dark.png',
  resizeMode: 'cover',
}

const SPLASH_CONFIG_ANDROID = {
  backgroundColor: '#0c7cff',
  image: './assets/splash.png',
  resizeMode: 'cover',
}
const DARK_SPLASH_CONFIG_ANDROID = {
  backgroundColor: '#0f141b',
  image: './assets/splash-dark.png',
  resizeMode: 'cover',
}

module.exports = function (config) {
  /**
   * App version number. Should be incremented as part of a release cycle.
   */
  const VERSION = pkg.version

  /**
   * Uses built-in Expo env vars
   *
   * @see https://docs.expo.dev/build-reference/variables/#built-in-environment-variables
   */
  const PLATFORM = process.env.EAS_BUILD_PLATFORM

  const DIST_BUILD_NUMBER =
    PLATFORM === 'android'
      ? process.env.BSKY_ANDROID_VERSION_CODE
      : process.env.BSKY_IOS_BUILD_NUMBER

  const IS_DEV = process.env.EXPO_PUBLIC_ENV === 'development'

  return {
    expo: {
      version: VERSION,
      name: 'Bluesky',
      slug: 'bluesky',
      scheme: 'bluesky',
      owner: 'blueskysocial',
      runtimeVersion: {
        policy: 'appVersion',
      },
      orientation: 'portrait',
      icon: './assets/icon.png',
      userInterfaceStyle: 'automatic',
      splash: SPLASH_CONFIG,
      ios: {
        supportsTablet: false,
        bundleIdentifier: 'xyz.blueskyweb.app',
        config: {
          usesNonExemptEncryption: false,
        },
        infoPlist: {
          UIBackgroundModes: ['remote-notification'],
          NSCameraUsageDescription:
            'Used for profile pictures, posts, and other kinds of content.',
          NSMicrophoneUsageDescription:
            'Used for posts and other kinds of content.',
          NSPhotoLibraryAddUsageDescription:
            'Used to save images to your library.',
          NSPhotoLibraryUsageDescription:
            'Used for profile pictures, posts, and other kinds of content',
          CFBundleAllowMixedLocalizations: true,
          CFBundleLocalizations:
            ['en', 'ca', 'de', 'es', 'fi', 'fr', 'ga', 'hi', 'hu', 'id',
             'it', 'ja', 'ko', 'pl', 'pt-BR', 'ru', 'th', 'tr', 'uk',
             'zh-CN', 'zh-HK', 'zh-TW'],
        },
        associatedDomains: ['applinks:bsky.app', 'applinks:staging.bsky.app'],
        splash: {
          ...SPLASH_CONFIG,
          dark: DARK_SPLASH_CONFIG,
        },
        entitlements: {
          'com.apple.security.application-groups': 'group.app.bsky',
        },
      },
      androidStatusBar: {
        barStyle: 'light-content',
        backgroundColor: '#00000000',
      },
      android: {
        icon: './assets/icon.png',
        adaptiveIcon: {
          foregroundImage: './assets/icon-android-foreground.png',
          monochromeImage: './assets/icon-android-foreground.png',
          backgroundImage: './assets/icon-android-background.png',
          backgroundColor: '#1185FE',
        },
        googleServicesFile: './google-services.json',
        package: 'xyz.blueskyweb.app',
        intentFilters: [
          {
            action: 'VIEW',
            autoVerify: true,
            data: [
              {
                scheme: 'https',
                host: 'bsky.app',
              },
              IS_DEV && {
                scheme: 'http',
                host: 'localhost:19006',
              },
            ],
            category: ['BROWSABLE', 'DEFAULT'],
          },
        ],
        splash: {
          ...SPLASH_CONFIG_ANDROID,
          dark: DARK_SPLASH_CONFIG_ANDROID,
        },
      },
      web: {
        favicon: './assets/favicon.png',
      },
      updates: {
        enabled: true,
        fallbackToCacheTimeout: 1000,
        url: 'https://u.expo.dev/55bd077a-d905-4184-9c7f-94789ba0f302',
      },
      plugins: [
        'expo-localization',
        Boolean(process.env.SENTRY_AUTH_TOKEN) && 'sentry-expo',
        [
          'expo-build-properties',
          {
            ios: {
              deploymentTarget: '13.4',
              newArchEnabled: false,
            },
            android: {
              compileSdkVersion: 34,
              targetSdkVersion: 34,
              buildToolsVersion: '34.0.0',
              kotlinVersion: '1.8.0',
              newArchEnabled: false,
            },
          },
        ],
        [
          'expo-updates',
          {
            username: 'blueskysocial',
          },
        ],
        [
          'expo-notifications',
          {
            icon: './assets/icon-android-notification.png',
            color: '#1185fe',
          },
        ],
        './plugins/withAndroidManifestPlugin.js',
        './plugins/withAndroidManifestFCMIconPlugin.js',
        './plugins/withAndroidStylesWindowBackgroundPlugin.js',
        './plugins/withAndroidSplashScreenStatusBarTranslucentPlugin.js',
        './plugins/shareExtension/withShareExtensions.js',
      ].filter(Boolean),
      extra: {
        eas: {
          build: {
            experimental: {
              ios: {
                appExtensions: [
                  {
                    targetName: 'Share-with-Bluesky',
                    bundleIdentifier: 'xyz.blueskyweb.app.Share-with-Bluesky',
                    entitlements: {
                      'com.apple.security.application-groups': [
                        'group.app.bsky',
                      ],
                    },
                  },
                ],
              },
            },
          },
          projectId: '55bd077a-d905-4184-9c7f-94789ba0f302',
        },
      },
      hooks: {
        postPublish: [
          /*
           * @see https://docs.expo.dev/guides/using-sentry/#app-configuration
           */
          {
            file: 'sentry-expo/upload-sourcemaps',
            config: {
              organization: 'blueskyweb',
              project: 'react-native',
              release: VERSION,
              dist: `${PLATFORM}.${VERSION}.${DIST_BUILD_NUMBER}`,
            },
          },
        ],
      },
    },
  }
}
