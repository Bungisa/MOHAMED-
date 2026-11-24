#!/usr/bin/env node
/**
 * Cross-platform (Windows / macOS / Linux) terminal build script for ElimikaPDF Android.
 *
 * Usage:
 *   node scripts/build-android.mjs web    -> Build Capacitor web bundle into dist/
 *   node scripts/build-android.mjs init   -> Create android/ (if missing), sync web assets & configure Open With
 *   node scripts/build-android.mjs debug  -> Sync + build Debug APK (app-debug.apk)
 *   node scripts/build-android.mjs apk    -> Sync + build Release APK (app-release.apk)
 *   node scripts/build-android.mjs aab    -> Sync + build Google Play Release Bundle (app-release.aab)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ANDROID_DIR = path.join(ROOT, 'android');
const IS_WIN = process.platform === 'win32';
const mode = (process.argv[2] || 'init').toLowerCase();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: { ...process.env, ...(options.env || {}) },
    stdio: 'inherit',
    shell: IS_WIN,
  });
  if (result.error) {
    console.error(`[ElimikaPDF] Failed to run "${command}":`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function buildCapWebBundle() {
  console.log('\n[1/3] Building Capacitor web bundle into dist/...');
  run('npx', ['vite', 'build'], {
    env: { CAPACITOR_BUILD: 'true' },
  });
}

function ensureAndSyncAndroid() {
  buildCapWebBundle();

  if (!fs.existsSync(ANDROID_DIR)) {
    console.log('\n[2/3] Creating native Android project via Capacitor...');
    run('npx', ['cap', 'add', 'android']);
  } else {
    console.log('\n[2/3] Syncing web assets & Capacitor plugins into android/...');
    run('npx', ['cap', 'sync', 'android']);
  }

  console.log('\n[3/3] Configuring Android Open With, Share & release signing...');
  run('node', ['scripts/setup-android-open-with.mjs']);
}

function runGradle(task) {
  const gradlew = IS_WIN
    ? path.join(ANDROID_DIR, 'gradlew.bat')
    : path.join(ANDROID_DIR, 'gradlew');

  if (!fs.existsSync(gradlew)) {
    console.error('[ElimikaPDF] Gradle wrapper not found in android/. Run `npm run android:init` first.');
    process.exit(1);
  }

  if (!IS_WIN) {
    try {
      fs.chmodSync(gradlew, 0o755);
    } catch {
      // Ignore chmod errors
    }
  }

  if (
    (task === 'assembleRelease' || task === 'bundleRelease') &&
    !fs.existsSync(path.join(ANDROID_DIR, 'keystore.properties'))
  ) {
    console.log(
      '\n[Note] android/keystore.properties not found — building an UNSIGNED release artifact.\n' +
        '       To sign from terminal, copy android/keystore.properties.example to android/keystore.properties\n' +
        '       with your .jks keystore details (or sign via Android Studio).\n'
    );
  }

  console.log(`\nRunning Gradle task: ${task}...`);
  run(gradlew, [task], { cwd: ANDROID_DIR });
}

switch (mode) {
  case 'web':
    buildCapWebBundle();
    break;
  case 'init':
  case 'sync':
    ensureAndSyncAndroid();
    console.log('\nDone! Your android/ project is ready to build.');
    break;
  case 'debug':
    ensureAndSyncAndroid();
    runGradle('assembleDebug');
    console.log(
      '\nDebug APK built at:\n  android/app/build/outputs/apk/debug/app-debug.apk'
    );
    break;
  case 'apk':
  case 'release-apk':
    ensureAndSyncAndroid();
    runGradle('assembleRelease');
    console.log(
      '\nRelease APK built at:\n  android/app/build/outputs/apk/release/'
    );
    break;
  case 'aab':
  case 'release':
  case 'bundle':
    ensureAndSyncAndroid();
    runGradle('bundleRelease');
    console.log(
      '\nGoogle Play Release AAB built at:\n  android/app/build/outputs/bundle/release/app-release.aab'
    );
    break;
  default:
    console.error(
      `Unknown mode "${mode}". Use one of: web, init, debug, apk, aab.`
    );
    process.exit(1);
}
