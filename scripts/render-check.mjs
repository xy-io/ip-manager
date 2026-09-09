// ============================================================
//  Modal render check
//
//  Renders every lazily-loaded modal server-side. A component that lost a
//  reference when it was extracted throws a ReferenceError here — something a
//  successful build does NOT catch, because an undefined identifier inside a
//  function body is a runtime error, not a compile error.
//
//  This is not theoretical: it caught three modals that used <React.Fragment>
//  without importing React, all of which built cleanly and would have rendered
//  a blank screen on open.
//
//    node scripts/render-check.mjs
//
//  Exit code 0 = every modal renders, 1 = at least one throws.
// ============================================================
import { build } from 'esbuild';
import { createRequire } from 'module';
import { renderToString } from 'react-dom/server';
import React from 'react';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

const PROPS = {
  HelpModal:            { onClose(){} },
  BackupCloudSection:   {},
  ImportModal:          { networkConfig:{ subnet:'192.168.0', dhcpEnabled:true, dhcpStart:'192.168.0.100', dhcpEnd:'192.168.0.200', staticStart:1, staticEnd:99 }, onImport(){}, onClose(){} },
  DomainsView:          { onClose(){} },
  ARPScanModal:         { subnet:'192.168.0', networkConfig:{ subnet:'192.168.0', dhcpEnabled:true, dhcpStart:'192.168.0.100', dhcpEnd:'192.168.0.200' }, onImport(){}, onClose(){} },
  ProxmoxImportModal:   { onImport(){}, onClose(){} },
  SubnetVisuiserModal:  { network:{ subnet:'192.168.0', dhcpEnabled:true, dhcpStart:'192.168.0.100', dhcpEnd:'192.168.0.200', staticStart:1, staticEnd:99 }, ipData:[{ ip:'192.168.0.5', assetName:'NAS' }], onClose(){} },
  CIDRCalculatorModal:  { onClose(){} },
};

global.fetch = () => new Promise(() => {});          // never resolves; effects do not run in SSR anyway
global.document = { activeElement: null, addEventListener(){}, removeEventListener(){} };
global.window = { addEventListener(){}, removeEventListener(){}, location:{ origin:'http://x' } };
global.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };

let failures = 0;
for (const name of Object.keys(PROPS)) {
  const outfile = path.resolve('.render-check', `${name}.cjs`);
  try {
    await build({
      entryPoints: [path.resolve('src/modals', `${name}.jsx`)],
      bundle: true, platform: 'node', format: 'cjs', outfile,
      external: ['react', 'react-dom', 'lucide-react', 'xlsx', 'qrcode'],
      loader: { '.jsx': 'jsx' }, jsx: 'automatic', logLevel: 'silent',
    });
    const Comp = require(outfile).default;
    renderToString(React.createElement(Comp, PROPS[name]));
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures++;
    const msg = String(err.message || err).split('\n').slice(0, 3).join(' | ');
    console.log(`  FAIL  ${name}\n        ${msg}`);
  } finally {
    fs.rmSync(outfile, { force: true });
  }
}
console.log(failures ? `\n  ${failures} modal(s) failed to render` : '\n  All 8 modals render.');
process.exit(failures ? 1 : 0);
