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

function extractHrefSequencesFromDraft(draftText){
  const hrefs = [];
  // Patterns: [](something) links
  const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while ((m = linkRe.exec(draftText))){
    const href = m[1].trim();
    if (!href) continue;
    hrefs.push(href);
  }
  // <img src="...">
  const imgRe = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
  while ((m = imgRe.exec(draftText))){
    const href = m[1].trim();
    if (!href) continue;
    hrefs.push(href);
  }
  return hrefs;
}

function run(){
  const root = path.resolve(__dirname, '../..');
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const draftMd = fs.readFileSync(path.join(root, 'draft.md'), 'utf8');

  const fnSetIframeIfPathChanged = extractBetween(indexHtml, 'function setIframeIfPathChanged', '\n        // Schedule iframe updates');

  // Build absolute href sequence
  const rawHrefs = extractHrefSequencesFromDraft(draftMd);
  const base = 'http://localhost:8080/index.html';
  const absHrefs = rawHrefs.map(h => {
    try { return new URL(h, base).href; } catch(e){ return null; }
  }).filter(Boolean);
  if (!absHrefs.length) throw new Error('No hrefs extracted from draft.md');

  // Prepare VM sandbox
  const sandbox = {
    console,
    URL,
    window: { location: { href: base } },
    setTimeout: (fn) => { try { fn(); } catch(e){} return 0; },
    clearTimeout: () => {},
    iframe: { src: '', style: { opacity: '1' } },
    firstFrame: true,
    lastIframePath: null,
    __assignments: [],
    __assignIframeSrcOnce: function(href){ sandbox.__assignments.push(href); sandbox.iframe.src = href; },
    __normalizePathOnly: function(href){ try { const u = new URL(href, base); u.hash = ''; if (u.pathname && u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, ''); return u.href; } catch(e){ return href; } }
  };

  vm.createContext(sandbox);
  vm.runInContext(fnSetIframeIfPathChanged, sandbox);

  // Compute expected lastIframePath progression (path-only stickiness across hash-only changes)
  const norm = (h) => sandbox.__normalizePathOnly(h);
  const expectedPaths = [];
  for (let i=0;i<absHrefs.length;i++){
    const cur = norm(absHrefs[i]);
    if (i===0) expectedPaths.push(cur);
    else expectedPaths.push(cur === norm(absHrefs[i-1]) ? expectedPaths[i-1] : cur);
  }

  const observedPaths = [];
  absHrefs.forEach(h => {
    sandbox.setIframeIfPathChanged(h);
    observedPaths.push(sandbox.lastIframePath);
  });

  // 1) Every href should trigger an assignment
  if (sandbox.__assignments.length !== absHrefs.length) {
    throw new Error(`FAIL: Expected ${absHrefs.length} iframe assignments, got ${sandbox.__assignments.length}`);
  }
  // 2) lastIframePath progression should match expected (hash-only retains previous path)
  for (let i=0;i<expectedPaths.length;i++){
    if (observedPaths[i] !== expectedPaths[i]){
      throw new Error(`FAIL: lastIframePath mismatch at index ${i}: expected ${expectedPaths[i]}, got ${observedPaths[i]} (href=${absHrefs[i]})`);
    }
  }

  console.log('PASS: draft-sequences test; total hrefs =', absHrefs.length);
}

try { run(); process.exit(0); }
catch (e) { console.error('draft-sequences test failed:', e && e.message); process.exit(1); }
