import { describe, expect, it } from "vitest";

// The PURE half of the plugin — no @expo/config-plugins, so this resolves with
// only the root node_modules installed, which is all either CI runner has.
// @ts-expect-error — plain CommonJS build script, deliberately not typed.
import mod from "./releaseSigning.js";

const { injectReleaseSigning, MARKER } = mod as {
  injectReleaseSigning: (gradle: string) => string;
  MARKER: string;
};

// A faithful trim of the Expo SDK 52 bare template's android/app/build.gradle —
// the parts this plugin anchors to, verbatim, including the debug build type
// carrying the same `signingConfig signingConfigs.debug` line that the release
// build type does. That collision is the whole reason the plugin locates the
// release block relative to `buildTypes {`.
const TEMPLATE = `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

android {
    ndkVersion rootProject.ext.ndkVersion
    compileSdk rootProject.ext.compileSdkVersion
    namespace 'net.orlandoaio.arcadelauncher.companion'

    defaultConfig {
        applicationId 'net.orlandoaio.arcadelauncher.companion'
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "0.14.0"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            shrinkResources (findProperty('android.enableShrinkResourcesInReleaseBuilds')?.toBoolean() ?: false)
            minifyEnabled enableProguardInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
        }
    }
}
`;

describe("injectReleaseSigning", () => {
  it("adds a release signing config alongside the debug one", () => {
    const out = injectReleaseSigning(TEMPLATE);
    expect(out).toContain(`storeFile file(${MARKER})`);
    expect(out).toContain("storePassword ARCADE_UPLOAD_STORE_PASSWORD");
    expect(out).toContain("keyAlias ARCADE_UPLOAD_KEY_ALIAS");
    expect(out).toContain("keyPassword ARCADE_UPLOAD_KEY_PASSWORD");
  });

  it("keeps the debug signing config untouched", () => {
    const out = injectReleaseSigning(TEMPLATE);
    expect(out).toContain("storeFile file('debug.keystore')");
    expect(out).toContain("keyAlias 'androiddebugkey'");
  });

  it("switches the release build type onto the property-gated choice", () => {
    const out = injectReleaseSigning(TEMPLATE);
    expect(out).toContain(
      `signingConfig project.hasProperty('${MARKER}') ` +
        `? signingConfigs.release : signingConfigs.debug`,
    );
  });

  it("leaves the debug build type signing with the debug key", () => {
    const out = injectReleaseSigning(TEMPLATE);
    // The debug build type's own line survives verbatim: exactly one plain
    // `signingConfig signingConfigs.debug` remains, and it is the debug one.
    const plain = out.match(/signingConfig signingConfigs\.debug$/gm) ?? [];
    expect(plain).toHaveLength(1);
    // Locate the release BUILD TYPE, not the release SIGNING CONFIG this
    // plugin just inserted — the latter now appears earlier in the file.
    const buildTypesAt = out.indexOf("buildTypes {");
    const debugBlock = out.slice(
      out.indexOf("debug {", buildTypesAt),
      out.indexOf("release {", buildTypesAt),
    );
    expect(debugBlock).toContain("signingConfig signingConfigs.debug");
    expect(debugBlock).not.toContain(MARKER);
  });

  it("is idempotent — a second pass changes nothing", () => {
    const once = injectReleaseSigning(TEMPLATE);
    expect(injectReleaseSigning(once)).toBe(once);
  });

  it("preserves everything else in the file", () => {
    const out = injectReleaseSigning(TEMPLATE);
    expect(out).toContain("minifyEnabled enableProguardInReleaseBuilds");
    expect(out).toContain('versionName "0.14.0"');
    expect(out).toContain('apply plugin: "com.android.application"');
  });

  it("throws when there is no signingConfigs block", () => {
    expect(() => injectReleaseSigning("android {\n}\n")).toThrow(
      /no `signingConfigs \{` block/,
    );
  });

  it("throws when there is no buildTypes block", () => {
    const gradle = "android {\n    signingConfigs {\n        debug {}\n    }\n}\n";
    expect(() => injectReleaseSigning(gradle)).toThrow(/no `buildTypes \{` block/);
  });

  it("throws when there is no release build type", () => {
    const gradle = TEMPLATE.replace("release {", "staging {").replace(
      // the staging block must not still offer the anchor line
      "            // Caution! In production, you need to generate your own keystore file.\n            signingConfig signingConfigs.debug\n",
      "",
    );
    expect(() => injectReleaseSigning(gradle)).toThrow(
      /no `release \{` build type/,
    );
  });

  it("throws when the release build type does not sign with the debug key", () => {
    const gradle = TEMPLATE.replace(
      "            // Caution! In production, you need to generate your own keystore file.\n            signingConfig signingConfigs.debug\n",
      "",
    );
    expect(() => injectReleaseSigning(gradle)).toThrow(
      /nothing to replace/,
    );
  });
});
