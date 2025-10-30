document.addEventListener('DOMContentLoaded', function () {
  // Helper: find headings that mark chapters
  function findHeadings() {
    const headingSet = new Set();

    // Prefer explicit .subheader containers if present (existing behavior)
    document.querySelectorAll('.subheader').forEach(container => {
      container.querySelectorAll('h1, h2').forEach(h => headingSet.add(h));
  const next = container.nextElementSibling;
  // Only H1/H2 break the timeline into chapters
  if (next && /H[1-2]/.test(next.tagName)) headingSet.add(next);
    });

    // Also include headings that explicitly have class `subheader`
    document.querySelectorAll('h1.subheader, h2.subheader').forEach(h => headingSet.add(h));

    // Fallback: include any top-level headings inside <main> (h1-h2).
    // Some markdown files (like draft.md) place a marker on its own line
    // before a heading; depending on the markdown processor that marker may
    // not end up as a wrapper element. Including headings inside <main>
    // ensures chapters are detected even when `.subheader` isn't present
    // as a wrapper element.
    const main = document.querySelector('main') || document;
    main.querySelectorAll('h1, h2').forEach(h => headingSet.add(h));

    // Filter out hidden headings and sort by document order
    let headings = Array.from(headingSet).filter(el => el && el.offsetParent !== null);
    headings.sort((a, b) => {
      // Use document position if available, fallback to bounding rect
      try {
        const pos = a.compareDocumentPosition(b);
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      } catch (e) {}
      return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    });
    return headings;
  }

  // slugify helper
  function slugify(s) {
    return s.toString().toLowerCase().trim()
      .replace(/[^a-z0-9\-\s\u0600-\u06FF]/g, '')
      .replace(/\s+/g, '-')
      .replace(/\-+/g, '-');
  }

  // Remove existing nav if present
  function clearNav() {
    const existing = document.getElementById('chapter-nav');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  // Build navigation from headings array
  function buildNav(headings) {
    if (!headings || !headings.length) return;
    
    // Ensure chapter headings have ids
    headings.forEach((h, idx) => {
      if (!h.id || h.id.trim() === '') {
        const base = slugify(h.textContent || ('chapter-' + (idx+1)));
        let id = base;
        let i = 1;
        while (document.getElementById(id)) { id = base + '-' + (i++); }
        h.id = id;
      }
    });

    // Get all direct children of main
    const main = document.querySelector('main');
    if (!main) return;
    
    const allMainChildren = Array.from(main.children).filter(el => el.offsetParent !== null);
    console.log('[chapters] Main direct children:', allMainChildren.length);
    
    // Ensure all navigable elements have IDs
    allMainChildren.forEach((el, idx) => {
      if (!el.id || el.id.trim() === '') {
        el.id = 'main-child-' + idx;
      }
    });
    
    // Map each main child to its parent chapter
    const childToChapter = new Map();
    let orphanedChildren = 0;
    allMainChildren.forEach(child => {
      // Find which chapter heading this child belongs to
      let chapterHeading = null;
      for (let i = headings.length - 1; i >= 0; i--) {
        const heading = headings[i];
        const headingPos = heading.getBoundingClientRect().top + window.pageYOffset;
        const childPos = child.getBoundingClientRect().top + window.pageYOffset;
        if (headingPos <= childPos) {
          chapterHeading = heading;
          break;
        }
      }
      if (chapterHeading) {
        childToChapter.set(child.id, chapterHeading.id);
      } else {
        orphanedChildren++;
        console.log('[chapters] Orphaned child (no chapter):', child.id, child.tagName, child.className);
      }
    });
    console.log('[chapters] Total orphaned children:', orphanedChildren);

    clearNav();
    const nav = document.createElement('nav');
    nav.id = 'chapter-nav';
    nav.setAttribute('aria-label', 'Chapters and Sections');

    let navItemCount = 0;
    
    // Build nav items for all main children in order
    allMainChildren.forEach(child => {
      navItemCount++;
      
      // Check if this child is a heading or contains a heading
      let isHeading = /^H[1-2]$/.test(child.tagName);
      let headingElement = isHeading ? child : child.querySelector('h1, h2');
      
      if (headingElement && headings.includes(headingElement)) {
        // This is a chapter heading
        const chapterTitle = headingElement.textContent.trim();
        console.log('[chapters] Creating nav item for chapter:', chapterTitle, '| target ID:', child.id);
        
        const chapterItem = document.createElement('div');
        chapterItem.className = 'chapter-item chapter-heading-item';
        chapterItem.dataset.chapterId = headingElement.id;

        const chapterBtn = document.createElement('button');
        chapterBtn.className = 'chapter-dot chapter-heading-dot';
        chapterBtn.type = 'button';
        chapterBtn.setAttribute('aria-label', chapterTitle);
        chapterBtn.dataset.target = child.id;  // Points to the main child (container or heading itself)
        chapterBtn.dataset.type = 'chapter';

        const label = document.createElement('span');
        label.className = 'chapter-label';
        label.textContent = chapterTitle;

        // Attach handlers to the container so entire area including borders is clickable
        chapterItem.addEventListener('click', createScrollHandler(child.id));
        chapterItem.addEventListener('dblclick', createDoubleClickHandler(child.id));

        chapterItem.appendChild(chapterBtn);
        chapterItem.appendChild(label);
        nav.appendChild(chapterItem);
      } else {
        // This is a regular section or other content
        const chapterId = childToChapter.get(child.id);
        const chapterHeading = chapterId ? headings.find(h => h.id === chapterId) : null;
        const chapterTitle = chapterHeading ? chapterHeading.textContent.trim() : 'Section';
        
        console.log('[chapters] Creating nav item for child:', child.id);
        
        const sectionItem = document.createElement('div');
        sectionItem.className = 'chapter-item section-item';
        if (chapterId) sectionItem.dataset.chapterId = chapterId;

        const sectionBtn = document.createElement('button');
        sectionBtn.className = 'chapter-dot section-dot';
        sectionBtn.type = 'button';
        
        // Prefer an H3/H4 inside the child as the label if available; fallback to chapter title
        let sectionTitle = chapterTitle;
        let hasTimestampHeading = false;
        try {
          const hh = child.querySelector && child.querySelector('h3, h4');
          if (hh) {
            hasTimestampHeading = true;
            const t = (hh.textContent || '').trim();
            if (t) sectionTitle = t;
          }
        } catch (e) { /* swallow */ }
        
        sectionBtn.setAttribute('aria-label', sectionTitle);
        sectionBtn.dataset.target = child.id;
        sectionBtn.dataset.type = 'section';
        
        // Add tooltip label
        const sectionLabel = document.createElement('span');
        sectionLabel.className = 'chapter-label';
        sectionLabel.textContent = sectionTitle;

        // Attach handlers to the container so entire area including borders is clickable
        sectionItem.addEventListener('click', createScrollHandler(child.id));
        sectionItem.addEventListener('dblclick', createDoubleClickHandler(child.id));

        // If contains an H3 or H4, mark this nav item as a timestamp
        if (hasTimestampHeading) {
          sectionItem.classList.add('timestamp');
        }

        sectionItem.appendChild(sectionBtn);
        sectionItem.appendChild(sectionLabel);
        nav.appendChild(sectionItem);
      }
    });

    console.log('[chapters] FINAL COUNT - Main children:', allMainChildren.length, '| Nav items created:', navItemCount);

    document.body.appendChild(nav);
    
    // Diagnostic: Count actual children
    const mainElement = document.querySelector('main');
    const mainChildren = mainElement ? mainElement.children.length : 0;
    const navChildren = nav.children.length;
    
    console.log('[chapters] DIAGNOSTIC - main.children.length:', mainChildren, '| nav.children.length:', navChildren);
    
    if (mainElement) {
      const mainChildTypes = {};
      Array.from(mainElement.children).forEach(child => {
        const key = child.tagName + (child.className ? '.' + child.className.split(' ')[0] : '');
        mainChildTypes[key] = (mainChildTypes[key] || 0) + 1;
      });
      console.log('[chapters] Main child types:', mainChildTypes);
    }
    
    const navChildTypes = {};
    Array.from(nav.children).forEach(child => {
      const key = child.className.split(' ')[0] || 'unknown';
      navChildTypes[key] = (navChildTypes[key] || 0) + 1;
    });
    console.log('[chapters] Nav child types:', navChildTypes);
    
    if (mainChildren !== navChildren) {
      console.error('[chapters] MISMATCH! Difference:', navChildren - mainChildren);
    }

    // Mobile: add a full-height transparent rail that captures vertical swipes.
    // As the finger moves, we highlight the closest item and show its label.
    try {
      const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
      const isNarrow = window.matchMedia && window.matchMedia('(max-width: 800px)').matches;
      if (isTouch && isNarrow) {
        const rail = document.createElement('div');
        rail.className = 'nav-touch-rail';
        nav.appendChild(rail);
        console.log('[chapters] Added touch rail to nav (adds 1 extra child)');

        const items = Array.from(nav.querySelectorAll('.chapter-item'));
        let centers = [];
        let lastHoverIndex = -1;
        let isDragging = false;

        function recomputeCenters() {
          const nrect = nav.getBoundingClientRect();
          centers = items.map((it) => {
            const r = it.getBoundingClientRect();
            return ((r.top + r.bottom) / 2) - nrect.top; // centerY relative to nav
          });
        }

        function clearHover() {
          if (lastHoverIndex >= 0 && items[lastHoverIndex]) {
            items[lastHoverIndex].classList.remove('touch-hover');
          }
          lastHoverIndex = -1;
        }

        function hoverNearest(clientY) {
          const nrect = nav.getBoundingClientRect();
          const y = clientY - nrect.top;
          if (!centers.length) recomputeCenters();
          let best = 0;
          let bestDist = Infinity;
          for (let i = 0; i < centers.length; i++) {
            const d = Math.abs(centers[i] - y);
            if (d < bestDist) { bestDist = d; best = i; }
          }
          if (best !== lastHoverIndex) {
            clearHover();
            lastHoverIndex = best;
            items[best]?.classList.add('touch-hover');
          }
        }

        function activateHovered() {
          if (lastHoverIndex < 0) return;
          const btn = items[lastHoverIndex].querySelector('.chapter-dot');
          if (!btn) return;
          // Trigger the same scroll behavior as a click
          btn.click();
        }

        const onStart = (ev) => {
          try { 
            ev.preventDefault(); 
            ev.stopPropagation();
          } catch (e) {}
          isDragging = true;
          recomputeCenters();
          const t = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
          hoverNearest(t.clientY);
        };

        const onMove = (ev) => {
          if (!isDragging) return;
          try { 
            ev.preventDefault(); 
            ev.stopPropagation();
          } catch (e) {}
          const t = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
          hoverNearest(t.clientY);
        };

        const onEnd = (ev) => {
          if (!isDragging) return;
          isDragging = false;
          try { 
            ev.preventDefault(); 
            ev.stopPropagation();
          } catch (e) {}
          activateHovered();
          // Keep the highlight briefly so the user sees what was chosen
          setTimeout(clearHover, 300);
        };

        const onCancel = () => {
          isDragging = false;
          clearHover();
        };

        // Attach to both rail and nav for maximum reliability
        [rail, nav].forEach(el => {
          el.addEventListener('touchstart', onStart, { passive: false });
          el.addEventListener('touchmove', onMove, { passive: false });
          el.addEventListener('touchend', onEnd, { passive: false });
          el.addEventListener('touchcancel', onCancel, { passive: false });
        });

        // Also support mouse drag for small-screen simulators
        let mouseDown = false;
        rail.addEventListener('mousedown', (ev) => {
          mouseDown = true;
          onStart(ev);
        });
        window.addEventListener('mousemove', (ev) => {
          if (!mouseDown) return;
          onMove(ev);
        }, { passive: false });
        window.addEventListener('mouseup', (ev) => {
          if (!mouseDown) return;
          mouseDown = false;
          onEnd(ev);
        });

        // Recompute centers on resize/rotation
        window.addEventListener('resize', () => { 
          centers = [];
          // Small delay to let layout settle
          setTimeout(recomputeCenters, 100);
        });
        
        // Initial computation
        setTimeout(recomputeCenters, 100);
      }
    } catch (e) { console.warn('[chapters] Mobile rail setup failed:', e); }

    // Helper function to update hash with section number
    function updateHashWithSection(targetId) {
      // Extract section number from IDs like 'main-child-36' or 'section-36'
      const match = targetId.match(/(?:main-child|section)-(\d+)$/);
      if (!match) return;
      
      const sectionNum = match[1];
      const currentHash = window.location.hash;
      
      // Get current page/prefix (e.g., 'draft' from '#draft' or '#draft:10')
      let prefix = '';
      if (currentHash) {
        const prefixMatch = currentHash.match(/^#([^:]+)/);
        if (prefixMatch) {
          prefix = prefixMatch[1];
          // Remove any existing :number suffix
          prefix = prefix.replace(/:\d+$/, '');
        }
      }
      
      // Build new hash
      const newHash = prefix ? `#${prefix}:${sectionNum}` : `#:${sectionNum}`;
      
      console.log('[chapters] Double-click: updating hash to', newHash);
      window.location.hash = newHash;
    }

    // Helper function to create scroll handler
    function createScrollHandler(targetId) {
      return function(ev) {
        ev.preventDefault();
        const target = document.getElementById(targetId);
        if (!target) return;
        
        // Suppress the page "snap" behavior during programmatic scroll
        window.__snapSuppressUntil = Date.now() + 1500;
        
        // Mark that we're in a programmatic scroll animation
        window.__chaptersAnimating = true;
        
        // Use custom smooth scroll to center the target
        const scroller = document.querySelector('main') || document.scrollingElement || document.documentElement;
        const viewportHeight = scroller.clientHeight || window.innerHeight;
        const targetTop = target.getBoundingClientRect().top + (scroller.scrollTop || window.pageYOffset);
        const centeredTop = targetTop - (viewportHeight / 2) + (target.offsetHeight / 2);
        
        // Use the global smooth helper if available for a softer animation
        if (window.__smoothScrollTo) {
          try {
            window.__smoothScrollTo(scroller, centeredTop, { source: 'nav' });
          } catch (e) {
            // fallback to native
            try {
              if (scroller === document.scrollingElement || scroller === document.documentElement) {
                window.scrollTo({ top: centeredTop, behavior: 'smooth' });
              } else {
                scroller.scrollTo({ top: centeredTop, behavior: 'smooth' });
              }
              setTimeout(() => { window.__chaptersAnimating = false; }, 1000);
            } catch (e) { /* swallow */ }
          }
        } else {
          // Native smooth scroll fallback
          try {
            if (scroller === document.scrollingElement || scroller === document.documentElement) {
              window.scrollTo({ top: centeredTop, behavior: 'smooth' });
            } else {
              scroller.scrollTo({ top: centeredTop, behavior: 'smooth' });
            }
            setTimeout(() => { window.__chaptersAnimating = false; }, 1000);
          } catch (e) { /* swallow */ }
        }
      };
    }

    // Helper function to create double-click handler for hash updates
    function createDoubleClickHandler(targetId) {
      return function(ev) {
        ev.preventDefault();
        updateHashWithSection(targetId);
      };
    }

    // Helper to update progress bar states (visited/future/current)
    function updateProgressStates(currentScrollTop) {
      const viewportHeight = window.innerHeight;
      const viewportCenter = currentScrollTop + (viewportHeight / 2);
      
      // Get all nav items and dots
      const allItems = Array.from(document.querySelectorAll('#chapter-nav .chapter-item'));
      const allDots = Array.from(document.querySelectorAll('#chapter-nav .chapter-dot'));
      
      if (!allDots.length) return; // No dots to update
      
      // Build fresh position data for all targets
      const targetPositions = [];
      allDots.forEach(dot => {
        const targetId = dot.dataset.target;
        const target = document.getElementById(targetId);
        if (!target) {
          console.warn('[chapters] Target not found for dot:', targetId);
          return;
        }
        
        const rect = target.getBoundingClientRect();
        const targetTop = rect.top + currentScrollTop;
        
        targetPositions.push({
          dot: dot,
          targetId: targetId,
          top: targetTop,
          distFromCenter: Math.abs(targetTop - viewportCenter)
        });
      });
      
      // Find the current section: the one whose top is at or just above viewport center
      // (or closest to it if we're between sections)
      let currentTargetId = null;
      let bestCandidate = null;
      
      targetPositions.forEach(pos => {
        // If this element's top is at or above the viewport center
        if (pos.top <= viewportCenter) {
          // It's a candidate. Pick the one closest to (but not past) the center
          if (!bestCandidate || pos.top > bestCandidate.top) {
            bestCandidate = pos;
          }
        }
      });
      
      // If we found a candidate at/above center, use it
      if (bestCandidate) {
        currentTargetId = bestCandidate.targetId;
      } else {
        // We're above all sections (e.g., at page top), use the first one
        if (targetPositions.length > 0) {
          currentTargetId = targetPositions[0].targetId;
        }
      }
      
      // Debug: log the current target
      if (window.__chaptersDebug) {
        console.log('[chapters] Active item:', currentTargetId, '| Viewport center:', viewportCenter);
      }
      
      // Mark all dots as visited, future, or current based on scroll position
      // Note: 'current' class on sections is now handled by core index.html
      targetPositions.forEach(pos => {
        const dot = pos.dot;
        
        // Remove all state classes first
        dot.classList.remove('visited', 'future', 'current');
        
        // Mark the closest one as current
        if (pos.targetId === currentTargetId) {
          dot.classList.add('current', 'visited');
        }
        // If target is above or at viewport center, it's visited (full opacity)
        // If target is below viewport center, it's future (50% opacity)
        else if (pos.top <= viewportCenter) {
          dot.classList.add('visited');
        } else {
          dot.classList.add('future');
        }
      });
      
      // All items are always visible (no hiding sections anymore)
      allItems.forEach(item => {
        item.style.display = '';
      });
    }

    // Setup active-state tracking with improved state management
    let updateScheduled = false;
    let animationFrameId = null;
    
    function scheduleUpdate() {
      if (updateScheduled) return;
      updateScheduled = true;
      requestAnimationFrame(() => {
        const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
        updateProgressStates(currentScrollTop);
        updateScheduled = false;
        
        // If we're in a scroll animation, schedule another update for smooth state transitions
        if (window.__chaptersAnimating) {
          scheduleUpdate();
        }
      });
    }
    
    // Continuous update loop during animations for smooth state changes
    function startAnimationLoop() {
      if (animationFrameId) return; // Already running
      
      function loop() {
        if (window.__chaptersAnimating) {
          const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
          updateProgressStates(currentScrollTop);
          animationFrameId = requestAnimationFrame(loop);
        } else {
          animationFrameId = null;
        }
      }
      
      loop();
    }
    
    // Watch for animation flag changes
    let lastAnimatingState = false;
    setInterval(() => {
      if (window.__chaptersAnimating && !lastAnimatingState) {
        startAnimationLoop();
      }
      lastAnimatingState = window.__chaptersAnimating;
    }, 16); // Check every frame (~60fps)

    // Update on scroll
    document.removeEventListener('scroll', window.__chaptersOnScrollListener);
    window.__chaptersOnScrollListener = scheduleUpdate;
    document.addEventListener('scroll', scheduleUpdate, { passive: true });
    
    // Update on resize (layout may have changed)
    const resizeHandler = () => {
      scheduleUpdate();
    };
    window.addEventListener('resize', resizeHandler, { passive: true });
    
    // Update when page content loads or changes (images, iframes, etc.)
    window.addEventListener('load', scheduleUpdate, { passive: true });
    
    // Update periodically for dynamic content that may shift layout
    const intervalId = setInterval(scheduleUpdate, 2000);
    
    // Store cleanup function
    window.__chaptersCleanup = () => {
      document.removeEventListener('scroll', window.__chaptersOnScrollListener);
      window.removeEventListener('resize', resizeHandler);
      window.removeEventListener('load', scheduleUpdate);
      clearInterval(intervalId);
    };
    
    // Initial update
    scheduleUpdate();
  }

  // Attempt initial build; if no headings exist yet (due to markdown injection),
  // observe `main` and rebuild when content changes.
  function attemptBuild() {
    const headings = findHeadings();
    if (headings.length) {
      buildNav(headings);
      return true;
    }
    return false;
  }

  // Try immediately
  if (attemptBuild()) return;

  // Watch for changes in <main> and rebuild when headings appear or content changes.
  const main = document.querySelector('main');
  if (!main) return;
  const mo = new MutationObserver((mutations) => {
    // small debounce: batch multiple mutations
    if (window.__chaptersMoTimer) clearTimeout(window.__chaptersMoTimer);
    window.__chaptersMoTimer = setTimeout(() => {
      const built = attemptBuild();
      if (built) {
        try { mo.disconnect(); } catch(e){}
      } else {
        // If nav exists but content changed, rebuild to stay in sync
        const existing = document.getElementById('chapter-nav');
        if (existing) {
          const headings = findHeadings();
          buildNav(headings);
        }
      }
    }, 120);
  });
  mo.observe(main, { childList: true, subtree: true });

  // Hash-based section jumping: detect patterns like #draft:36 or #:36
  function handleHashJump() {
    const hash = window.location.hash;
    if (!hash) return;
    
    // Match patterns like #:36 or #draft:36 or #anything:123
    const match = hash.match(/:(\d+)$/);
    if (!match) return;
    
    const sectionNum = parseInt(match[1], 10);
    // Try both new and legacy ID formats
    let targetId = 'main-child-' + sectionNum;
    let target = document.getElementById(targetId);
    
    // Fallback to legacy section ID format
    if (!target) {
      targetId = 'section-' + sectionNum;
      target = document.getElementById(targetId);
    }
    
    if (!target) {
      console.warn('[chapters] Section not found:', targetId);
      return;
    }
    
    console.log('[chapters] Jumping to section:', targetId);
    
    // Use the same scroll logic as the nav buttons
    window.__snapSuppressUntil = Date.now() + 1500;
    window.__chaptersAnimating = true;
    
    const scroller = document.querySelector('main') || document.scrollingElement || document.documentElement;
    const viewportHeight = scroller.clientHeight || window.innerHeight;
    const targetTop = target.getBoundingClientRect().top + (scroller.scrollTop || window.pageYOffset);
    const centeredTop = targetTop - (viewportHeight / 2) + (target.offsetHeight / 2);
    
    if (window.__smoothScrollTo) {
      try {
        window.__smoothScrollTo(scroller, centeredTop, { source: 'hash' });
      } catch (e) {
        try {
          if (scroller === document.scrollingElement || scroller === document.documentElement) {
            window.scrollTo({ top: centeredTop, behavior: 'smooth' });
          } else {
            scroller.scrollTo({ top: centeredTop, behavior: 'smooth' });
          }
          setTimeout(() => { window.__chaptersAnimating = false; }, 1000);
        } catch (e) { /* swallow */ }
      }
    } else {
      try {
        if (scroller === document.scrollingElement || scroller === document.documentElement) {
          window.scrollTo({ top: centeredTop, behavior: 'smooth' });
        } else {
          scroller.scrollTo({ top: centeredTop, behavior: 'smooth' });
        }
        setTimeout(() => { window.__chaptersAnimating = false; }, 1000);
      } catch (e) { /* swallow */ }
    }
  }

  // Listen for hash changes
  window.addEventListener('hashchange', handleHashJump);
  
  // Handle initial hash on page load (with a delay to ensure content is ready)
  setTimeout(() => {
    handleHashJump();
  }, 500);
});
