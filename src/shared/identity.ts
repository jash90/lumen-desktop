import identity from '../../identity.json';

/**
 * Every name the operating system keys the app on lives in `identity.json`, so
 * the build script, the Electron side and the Swift widget cannot drift apart.
 *
 * They used to be five hand-kept copies — and a mismatch fails silently: the
 * widget simply reads an empty container forever, with nothing logged anywhere.
 */

export const PRODUCT_NAME = identity.productName;
export const EXECUTABLE_NAME = identity.executableName;
export const BUNDLE_ID = identity.bundleId;
export const TEAM_ID = identity.teamId;
export const WIDGET_NAME = identity.widgetName;
export const RELOAD_HELPER = identity.reloadHelper;

/**
 * macOS expects the team identifier as a prefix here; iOS uses a "group."
 * prefix instead.
 */
export const APP_GROUP = `${TEAM_ID}.${BUNDLE_ID}`;

/** Where the app stored its data before the rename — see `migrateUserData`. */
export const LEGACY_PRODUCT_NAME = identity.legacyProductName;
export const LEGACY_EXECUTABLE_NAME = identity.legacyExecutableName;
/**
 * The App Group the previous name owned. The rename moved the container, so the
 * old one is orphaned — with an exported key still in it.
 */
export const LEGACY_APP_GROUP = `${TEAM_ID}.${identity.legacyBundleId}`;
