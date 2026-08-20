import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

/** Also the prefix for the widget extension and its App Group. */
export const BUNDLE_ID = 'com.bartlomiejzimny.huedesktop';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Hue Desktop',
    executableName: 'hue-desktop',
    icon: 'assets/icon', // Forge appends .icns on macOS and .ico on Windows
    appBundleId: BUNDLE_ID,
    appCategoryType: 'public.app-category.utilities',
    // Signing is opt-in so `npm run make` still works on a machine without the
    // certificate — CI and contributors get an unsigned build, releases get a
    // signed one.
    osxSign: process.env.HUE_SIGN
      ? {
          identity: 'Developer ID Application: Bartomiej Zimny (H2X8YGN869)',
          optionsForFile: () => ({ entitlements: 'build/entitlements.plist' }),
        }
      : undefined,
    // Notarisation needs App Store Connect API credentials; without them the
    // build is signed but not stapled.
    osxNotarize:
      process.env.HUE_SIGN && process.env.APPLE_API_ISSUER
        ? {
            appleApiKey: process.env.APPLE_API_KEY_PATH as string,
            appleApiKeyId: process.env.APPLE_API_KEY_ID as string,
            appleApiIssuer: process.env.APPLE_API_ISSUER,
          }
        : undefined,
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ setupIcon: 'assets/icon.ico' }),
    new MakerZIP({}, ['darwin']),
    new MakerDMG({ icon: 'assets/icon.icns' }, ['darwin']),
    new MakerRpm({ options: { icon: 'assets/icon.png' } }),
    new MakerDeb({ options: { icon: 'assets/icon.png' } }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
