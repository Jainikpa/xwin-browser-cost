#!/usr/bin/env node
/**
 * Builds native-build/address-bar-reader.exe from native/address-bar-reader.cs on Windows, with the C# compiler that
 * ships with .NET Framework 4 (in every Windows 10 and 11), so the build needs nothing installed. forge.config.js
 * ships the exe as an extra resource; browser-address.ts runs it. On other systems it does nothing.
 */
'use strict';

const { execFileSync } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const { join, resolve } = require('node:path');

if (process.platform !== 'win32') {
  console.log('[address-bar-reader] Not Windows: nothing to build');
  process.exit(0);
}

const electronRoot = resolve(__dirname, '..');
const framework = join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const outputDir = join(electronRoot, 'native-build');
mkdirSync(outputDir, { recursive: true });

// AnyCPU, so one exe runs in the 64-bit and the 32-bit app.
execFileSync(
  join(framework, 'csc.exe'),
  [
    '/nologo',
    '/optimize+',
    '/target:exe',
    '/platform:anycpu',
    `/out:${join(outputDir, 'address-bar-reader.exe')}`,
    `/r:${join(framework, 'WPF', 'UIAutomationClient.dll')}`,
    `/r:${join(framework, 'WPF', 'UIAutomationTypes.dll')}`,
    `/r:${join(framework, 'WPF', 'WindowsBase.dll')}`,
    join(electronRoot, 'native', 'address-bar-reader.cs'),
  ],
  { stdio: 'inherit' },
);
console.log('[address-bar-reader] Built native-build/address-bar-reader.exe');
