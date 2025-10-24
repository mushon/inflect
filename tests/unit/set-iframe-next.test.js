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

function makeAnchor(href, section){
  return {
    getAttribute: (k) => k === 'href' ? href : null,
    href,
    closest: () => section
  };
}

function makeSection(active){
  const listeners = {};
  return {
    getAttribute: (k) => k === 'data-tw-active' ? (active ? '1' : '0') : null,
    addEventListener: (t, fn) => { listeners[t] = fn; },
    removeEventListener: (t) => { delete listeners[t]; },
    _fire: (t) => { if (listeners[t]) listeners[t](); }
  };
}

function run(){
  const htmlPath = path.resolve(__dirname, '../../index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const fnSetIframeIfPathChanged = extractBetween(html, 'function setIframeIfPathChanged', '\n        // Schedule iframe updates');
  const fnSetIframeNext = extractBetween(html, 'function setIframeNext', '\n    // (typewriter functionality removed)');

  // Base sandbox
  const sandbox = {
    console,
    URL,
    window: { location: { href: 'http://localhost:8080/index.html' } },
    // default timers: synchronous
    setTimeout: (fn) => { try { fn(); } catch(e){} return 0; },
    clearTimeout: () => {},
    document: {
      querySelectorAll: () => []
    },
    iframe: { src: '', style: { opacity: '1' } },
    firstFrame: true,
    lastIframePath: null,
    __assignments: [],
    __assignIframeSrcOnce: function(href){ sandbox.__assignments.push(href); sandbox.iframe.src = href; }
  };
  // Provide a minimal path normalizer used by setIframeIfPathChanged
  sandbox.__normalizePathOnly = function(href){ try { const u = new URL(href, sandbox.window.location.href); u.hash = ''; return u.href; } catch(e){ return href; } };

  vm.createContext(sandbox);
  vm.runInContext(fnSetIframeIfPathChanged, sandbox);
  vm.runInContext(fnSetIframeNext, sandbox);

  const abs1 = new URL('img/#ahmed_khanyounis.jpeg', sandbox.window.location.href).href;
  const abs2 = new URL('img/#rita_tent1.jpg', sandbox.window.location.href).href;

  // Case 1: waitForSection=false -> immediate assign
  sandbox.__assignments = [];
  sandbox.setIframeNext(abs1, 0, false);
  if (sandbox.__assignments.length !== 1 || sandbox.__assignments[0] !== abs1) {
    throw new Error('Case1 FAIL: expected immediate assignment for waitForSection=false');
  }

  // Case 2: waitForSection=true but section not active -> immediate assign
  const secInactive = makeSection(false);
  const a1 = makeAnchor(abs2, secInactive);
  sandbox.document.querySelectorAll = () => [a1];
  sandbox.__assignments = [];
  sandbox.setIframeNext(abs2, 0, true);
  if (sandbox.__assignments.length !== 1 || sandbox.__assignments[0] !== abs2) {
    throw new Error('Case2 FAIL: expected immediate assignment when section is not active');
  }

  // Case 3: waitForSection=true and section active -> wait for event, then assign once
  const secActive = makeSection(true);
  const a2 = makeAnchor(abs1, secActive);
  sandbox.document.querySelectorAll = () => [a2];
  // Timers should not fire automatically here; override to queue
  const queued = [];
  sandbox.setTimeout = (fn, ms) => { queued.push({ fn, ms }); return queued.length; };
  sandbox.clearTimeout = (id) => { if (queued[id-1]) queued[id-1].fn = () => {}; };

  sandbox.__assignments = [];
  sandbox.setIframeNext(abs1, 0, true);
  // Execute the scheduled body so the listener is attached
  if (queued.length === 0) throw new Error('Case3 FAIL: expected queued task');
  try { queued[0].fn(); } catch(e){}
  // Should still not assign before event
  if (sandbox.__assignments.length !== 0) {
    throw new Error('Case3 FAIL: should not assign before typewriter:done');
  }
  // Fire the event (should assign exactly once)
  secActive._fire('typewriter:done');
  if (sandbox.__assignments.length !== 1 || sandbox.__assignments[0] !== abs1) {
    throw new Error('Case3 FAIL: expected single assignment after event');
  }
  // Run any queued timeouts; assignment should not increase
  queued.slice(1).forEach(q => { try { q.fn(); } catch(e){} });
  if (sandbox.__assignments.length !== 1) {
    throw new Error('Case3 FAIL: timeout fallback should not cause double assignment');
  }

  console.log('PASS: set-iframe-next tests');
}

try {
  run();
  process.exit(0);
} catch (e) {
  console.error('set-iframe-next test failed:', e && e.message);
  process.exit(1);
}
