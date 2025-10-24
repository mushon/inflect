const fs = require('fs');
const path = require('path');
const vm = require('vm');

function extractBetween(src, startMarker, endMarker){
  const si = src.indexOf(startMarker);
  if (si === -1) throw new Error(`Could not find start marker: ${startMarker}`);
  const ei = src.indexOf(endMarker, si);
  if (ei === -1) throw new Error(`Could not find end marker: ${endMarker}`);
  return src.slice(si, ei);
}

function run(){
  const htmlPath = path.resolve(__dirname, '../../index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const fnNormalize = extractBetween(html, 'function __normalizePathOnly', 'let lastIframePath');
  const fnSetIframe = extractBetween(html, 'function setIframeIfPathChanged', 'let __iframeNextTimeout');

  const sandbox = {
    console,
    URL,
    // Make timeouts synchronous in tests so delayed iframe assignment runs immediately
    setTimeout: (fn, ms) => { try { fn(); } catch(e){} return 0; },
    clearTimeout: (id) => {},
    window: { location: { href: 'http://localhost:8080/index.html', origin: 'http://localhost:8080' } },
    document: {},
    iframe: { src: '', style: { opacity: '1' } },
    firstFrame: true,
    lastIframePath: null,
    __assignments: []
  };
  // Define assign helper referencing the sandbox object directly to avoid strict-mode `this` issues
  sandbox.__assignIframeSrcOnce = function(href){ sandbox.__assignments.push(href); sandbox.iframe.src = href; };

  vm.createContext(sandbox);
  vm.runInContext(fnNormalize, sandbox);
  vm.runInContext(fnSetIframe, sandbox);

  // Test 1: first navigation with relative href
  const expected1 = new URL('vid/foo#bar', sandbox.window.location.href).href;
  sandbox.setIframeIfPathChanged(expected1);
  if (sandbox.__assignments.length !== 1 || sandbox.__assignments[0] !== expected1) {
    throw new Error(`Test1 FAIL: expected first assignment to ${expected1}, got ${sandbox.__assignments[0]}`);
  }
  const n1 = sandbox.__normalizePathOnly(expected1);
  if (sandbox.lastIframePath !== n1) {
    throw new Error(`Test1 FAIL: lastIframePath mismatch; expected ${n1}, got ${sandbox.lastIframePath}`);
  }

  // Test 2: hash-only change should still assign iframe src
  sandbox.setIframeIfPathChanged(expected1.replace('#bar', '#baz'));
  if (sandbox.__assignments.length !== 2 || sandbox.__assignments[1] !== expected1.replace('#bar', '#baz')) {
    throw new Error(`Test2 FAIL: expected second assignment with hash change; got ${sandbox.__assignments[1]}`);
  }
  if (sandbox.lastIframePath !== n1) {
    throw new Error(`Test2 FAIL: lastIframePath should remain ${n1} on hash-only change; got ${sandbox.lastIframePath}`);
  }

  // Test 3: different path should update lastIframePath and assign
  const expected3 = new URL('vid/bar#x', sandbox.window.location.href).href;
  sandbox.setIframeIfPathChanged(expected3);
  const n3 = sandbox.__normalizePathOnly(expected3);
  if (sandbox.__assignments.length !== 3 || sandbox.__assignments[2] !== expected3) {
    throw new Error(`Test3 FAIL: expected third assignment to ${expected3}, got ${sandbox.__assignments[2]}`);
  }
  if (sandbox.lastIframePath !== n3) {
    throw new Error(`Test3 FAIL: lastIframePath mismatch; expected ${n3}, got ${sandbox.lastIframePath}`);
  }

  console.log('PASS: url-logic tests');
}

try {
  run();
  process.exit(0);
} catch (e) {
  console.error('url-logic test failed:', e && e.message);
  process.exit(1);
}
