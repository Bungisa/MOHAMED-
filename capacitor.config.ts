import type { CapacitorConfig } from '@capacitor/cli';

const liveServerUrl =
  typeof process !== 'undefined' && process.env?.CAPACITOR_SERVER_URL
    ? process.env.CAPACITOR_SERVER_URL.trim()
    : '';

const config: CapacitorConfig = {
  appId: 'app.elimikapdf.studio',
  appName: 'ElimikaPDF',
  webDir: 'dist',
  backgroundColor: '#FAF9FB',
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
    ...(liveServerUrl
      ? {
          url: liveServerUrl,
          cleartext: liveServerUrl.startsWith('http://'),
        }
      : {}),
    allowNavigation: [
      '*.google.com',
      'accounts.google.com',
      '*.googleapis.com',
      '*.dropboxapi.com',
      '*.firebaseapp.com',
    ],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      launchFadeOutDuration: 250,
      backgroundColor: '#003FE8',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#003FE8',
      overlaysWebView: false,
    },
    Camera: {
      presentationStyle: 'fullscreen',
    },
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: false,
    scrollEnabled: true,
  },
};

export default config;
