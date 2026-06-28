const api = typeof browser !== 'undefined' ? browser : chrome;

let elementMap = [];

function scrapeElements() {
  const selectors = [
    'button', 'a', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="menuitem"]',
    '[role="tab"]', '[role="checkbox"]', '[role="switch"]',
    'nav *', 'header *'
  ].join(', ');

  const elements = document.querySelectorAll(selectors);
  const map = [];

  elements.forEach((el, i) => {
    const rect = el.getBoundingClientRect();
    const label = (
      el.innerText?.trim() ||
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      el.getAttribute('alt') ||
      el.tagName
    );

    if (rect.width > 0 && rect.height > 0 && label && label.length > 0) {
      map.push({
        id: i,
        label: label.slice(0, 80),
        tag: el.tagName,
        el: el,
        x: Math.round(rect.left + rect.width / 2 + window.scrollX),
        y: Math.round(rect.top + rect.height / 2 + window.scrollY)
      });
    }
  });

  const trimmed = map.slice(0, 150);
  if (!trimmed.length) {
    console.warn('[Staple][content:scrapeElements] No elements scraped from page', { url: window.location.href, readyState: document.readyState });
  }
  return trimmed;
}

let observer = null;
let observerTimeout = null;

function startObserver() {
  if (!document.body) return;
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => {
    if (observerTimeout) return;
    observerTimeout = setTimeout(() => {
      elementMap = scrapeElements();
      observerTimeout = null;
    }, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function injectCharacter() {
  if (!document.body) return;
  const existing = document.getElementById('st-buddy');
  if (existing) existing.remove();
  const exBubble = document.getElementById('st-bubble');
  if (exBubble) exBubble.remove();
  const exBox = document.getElementById('st-inline-box');
  if (exBox) exBox.remove();

  const buddy = document.createElement('div');
  buddy.id = 'st-buddy';

  const cat = document.createElement('div');
  cat.id = 'st-cat';
  cat.className = 'state-idle';
  cat.style.backgroundImage = `url('${api.runtime.getURL('cat_sprite.png')}')`;
  buddy.appendChild(cat);

  buddy.addEventListener('click', handleBuddyClick);
  buddy.addEventListener('mousedown', onBuddyMouseDown);
  buddy.addEventListener('touchstart', onBuddyTouchStart, { passive: false });

  document.body.appendChild(buddy);

  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('mouseup', onWindowMouseUp);
  window.addEventListener('touchmove', onWindowTouchMove, { passive: false });
  window.addEventListener('touchend', onWindowTouchEnd);

  const bubble = document.createElement('div');
  bubble.id = 'st-bubble';
  document.body.appendChild(bubble);

  document.addEventListener('click', e => {
    const box = document.getElementById('st-inline-box');
    if (box && box.style.display !== 'none') {
      if (!box.contains(e.target) && e.target.id !== 'st-buddy' && !document.getElementById('st-buddy').contains(e.target)) {
        hideInlineBox();
      }
    }
  });

  startIdleCleanTimer();
}

let idleCleanTimer = null;
let cleanEndListener = null;

function startIdleCleanTimer() {
  if (idleCleanTimer) clearTimeout(idleCleanTimer);
  scheduleCleanAnimation();
}

function scheduleCleanAnimation() {
  const delay = 15000 + Math.random() * 15000;
  idleCleanTimer = setTimeout(() => {
    const cat = document.getElementById('st-cat');
    if (cat && cat.className === 'state-idle') {
      setCharacterState('clean');
      cleanEndListener = function onCleanEnd() {
        cat.removeEventListener('animationend', cleanEndListener);
        cleanEndListener = null;
        if (cat.className === 'state-clean') {
          setCharacterState('idle');
        }
      };
      cat.addEventListener('animationend', cleanEndListener);
    }
    scheduleCleanAnimation();
  }, delay);
}

let walkTransitionEndHandler = null;
let scrollCancelled = false;

function moveCharacter(vx, vy) {
  console.log('[Staple][content:moveCharacter] Called', { x: vx, y: vy, scrollX: window.scrollX, scrollY: window.scrollY });
  const buddy = document.getElementById('st-buddy');
  const bubble = document.getElementById('st-bubble');
  const cat = document.getElementById('st-cat');

  if (walkTransitionEndHandler) {
    buddy.removeEventListener('transitionend', walkTransitionEndHandler);
    walkTransitionEndHandler = null;
  }

  const buddyRect = buddy.getBoundingClientRect();
  buddy.style.transition = 'none';
  buddy.style.left = `${buddyRect.left}px`;
  buddy.style.top = `${buddyRect.top}px`;
  buddy.style.bottom = 'auto';
  buddy.style.right = 'auto';
  void buddy.offsetHeight;

  const clampedX = Math.max(44, Math.min(vx, window.innerWidth - 44));
  const clampedY = Math.max(64, Math.min(vy, window.innerHeight - 44));

  const currentCX = buddyRect.left + 40;
  const currentCY = buddyRect.top + 40;

  if (clampedX < currentCX) {
    cat.style.transform = 'scaleX(-1)';
  } else if (clampedX > currentCX) {
    cat.style.transform = 'scaleX(1)';
  }

  setCharacterState('walking');

  const targetLeft = clampedX - 40;
  const targetTop = clampedY - 70;
  const dx = (targetLeft + 40) - currentCX;
  const dy = (targetTop + 40) - currentCY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const duration = Math.max(0.15, Math.min(distance / 300, 3.0));

  return new Promise(resolve => {
    function onWalkEnd(e) {
      if (e.propertyName !== 'left' && e.propertyName !== 'top') return;
      buddy.removeEventListener('transitionend', onWalkEnd);
      if (walkTransitionEndHandler === onWalkEnd) walkTransitionEndHandler = null;
      setCharacterState('paw');
      setTimeout(resolve, 1000);
    }

    if (distance < 1) {
      setCharacterState('paw');
      setTimeout(resolve, 1000);
    } else {
      walkTransitionEndHandler = onWalkEnd;
      buddy.addEventListener('transitionend', onWalkEnd);
    }

    buddy.style.position = 'fixed';
    buddy.style.transition = `left ${duration}s linear, top ${duration}s linear`;
    buddy.style.left = `${targetLeft}px`;
    buddy.style.top = `${targetTop}px`;

    bubble.style.left = `${Math.max(5, Math.min(clampedX, window.innerWidth - 280))}px`;
    bubble.style.top = `${Math.max(5, Math.min(clampedY - 140, window.innerHeight - 80))}px`;
    bubble.style.bottom = 'auto';

    if (bubble._pendingText) {
      bubble.innerText = bubble._pendingText;
      bubble.style.display = 'block';
      requestAnimationFrame(() => bubble.classList.add('visible'));
    }
  });
}

function getScrollContainer(el) {
  let parent = el.parentElement;
  while (parent) {
    const style = window.getComputedStyle(parent);
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

let activeScrollCleanup = null;

function waitForScrollEnd(container) {
  if (activeScrollCleanup) {
    activeScrollCleanup();
    activeScrollCleanup = null;
  }
  return new Promise(resolve => {
    let timer = null;
    let fallback = null;
    let cancelled = false;
    let fallbackHit = false;

    function finish() {
      if (cancelled) return;
      cancelled = true;
      container.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
      if (fallback) clearTimeout(fallback);
      activeScrollCleanup = null;
      if (fallbackHit) {
        console.warn('[Staple][content:waitForScrollEnd] Scroll end fallback fired', { scrollY: window.scrollY, scrollX: window.scrollX });
      }
      resolve();
    }

    function onScroll() {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(finish, 150);
    }

    container.addEventListener('scroll', onScroll, { passive: true });
    fallback = setTimeout(() => { fallbackHit = true; finish(); }, 1200);

    activeScrollCleanup = finish;
  });
}

let hideBubbleTimer = null;

function showBubble(text) {
  const bubble = document.getElementById('st-bubble');
  if (hideBubbleTimer) { clearTimeout(hideBubbleTimer); hideBubbleTimer = null; }
  bubble.innerText = text;
  bubble.style.display = 'block';
  requestAnimationFrame(() => bubble.classList.add('visible'));
}

function hideBubble() {
  const bubble = document.getElementById('st-bubble');
  bubble.classList.remove('visible');
  if (hideBubbleTimer) clearTimeout(hideBubbleTimer);
  hideBubbleTimer = setTimeout(() => {
    bubble.style.display = 'none';
    hideBubbleTimer = null;
  }, 150);
}

async function walkHome() {
  const buddy = document.getElementById('st-buddy');
  const cat = document.getElementById('st-cat');
  if (!buddy) return;

  const targetLeft = window.innerWidth - 100;
  const targetTop = window.innerHeight - 160;
  const targetCenterX = targetLeft + 40;

  const buddyRect = buddy.getBoundingClientRect();
  const currentLeft = buddyRect.left;
  const currentTop = buddyRect.top;
  const currentCenterX = currentLeft + 40;
  const currentCenterY = currentTop + 40;

  const dx = targetCenterX - currentCenterX;
  const dy = targetTop + 40 - currentCenterY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const duration = Math.max(0.15, Math.min(distance / 300, 3.0));

  if (cat) cat.style.transform = 'scaleX(1)';

  setCharacterState('walking');

  buddy.style.transition = 'none';
  buddy.style.left = `${currentLeft}px`;
  buddy.style.top = `${currentTop}px`;
  buddy.style.bottom = 'auto';
  buddy.style.right = 'auto';
  void buddy.offsetHeight;

  if (walkTransitionEndHandler) {
    buddy.removeEventListener('transitionend', walkTransitionEndHandler);
    walkTransitionEndHandler = null;
  }

  return new Promise(resolve => {
    function onHomeEnd(e) {
      if (e.propertyName !== 'left' && e.propertyName !== 'top') return;
      buddy.removeEventListener('transitionend', onHomeEnd);
      if (walkTransitionEndHandler === onHomeEnd) walkTransitionEndHandler = null;
      setCharacterState('sleep');
      resolve();
    }

    if (distance < 1) {
      setCharacterState('sleep');
      resolve();
    } else {
      walkTransitionEndHandler = onHomeEnd;
      buddy.addEventListener('transitionend', onHomeEnd);
    }

    buddy.style.transition = `left ${duration}s linear, top ${duration}s linear`;
    buddy.style.left = `${targetLeft}px`;
    buddy.style.top = `${targetTop}px`;
  });
}

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartLeft = 0;
let dragStartTop = 0;
let hasDragged = false;
let catFixedLeft = null;
let catFixedTop = null;

function toggleInlineInput() {
  const box = document.getElementById('st-inline-box');
  if (box && box.style.display !== 'none') {
    hideInlineBox();
    const input = document.getElementById('st-inline-input');
    if (input) input.value = '';
    return;
  }
  showInlineBox();
}

function onBuddyMouseDown(e) {
  if (e.button !== 0) return;
  isDragging = true;
  hasDragged = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  const rect = document.getElementById('st-buddy').getBoundingClientRect();
  dragStartLeft = rect.left;
  dragStartTop = rect.top;
  document.getElementById('st-buddy').classList.add('is-dragging');
  e.preventDefault();
}

function onBuddyTouchStart(e) {
  const touch = e.touches[0];
  isDragging = true;
  hasDragged = false;
  dragStartX = touch.clientX;
  dragStartY = touch.clientY;
  const rect = document.getElementById('st-buddy').getBoundingClientRect();
  dragStartLeft = rect.left;
  dragStartTop = rect.top;
  document.getElementById('st-buddy').classList.add('is-dragging');
}

function onWindowMouseMove(e) {
  if (!isDragging) return;
  doDragMove(e.clientX, e.clientY);
}

function onWindowTouchMove(e) {
  if (!isDragging) return;
  const touch = e.touches[0];
  doDragMove(touch.clientX, touch.clientY);
}

function doDragMove(clientX, clientY) {
  const dx = clientX - dragStartX;
  const dy = clientY - dragStartY;

  if (!hasDragged && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
  hasDragged = true;

  const catSize = 44;
  const newLeft = Math.max(0, Math.min(dragStartLeft + dx, window.innerWidth - catSize));
  const newTop = Math.max(0, Math.min(dragStartTop + dy, window.innerHeight - catSize));

  const buddy = document.getElementById('st-buddy');
  buddy.style.transition = 'none';
  buddy.style.left = `${newLeft}px`;
  buddy.style.top = `${newTop}px`;
  buddy.style.bottom = 'auto';
  buddy.style.right = 'auto';

  catFixedLeft = newLeft;
  catFixedTop = newTop;
}

function onWindowMouseUp() {
  finishDrag();
}

function onWindowTouchEnd() {
  finishDrag();
}

function finishDrag() {
  if (!isDragging) return;
  isDragging = false;
  document.getElementById('st-buddy').classList.remove('is-dragging');

  if (hasDragged) {
    snapCatToEdge();
  } else {
    toggleInlineInput();
  }
}

function snapCatToEdge() {
  const buddy = document.getElementById('st-buddy');
  const catSize = 44;
  const margin = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const currentLeft = parseFloat(buddy.style.left) || 0;
  const currentTop = parseFloat(buddy.style.top) || 0;

  const snapLeft = currentLeft < vw / 2
    ? margin
    : vw - catSize - margin;

  const snapTop = Math.max(margin, Math.min(currentTop, vh - catSize - margin));

  buddy.style.transition = 'left 0.25s ease, top 0.25s ease';
  buddy.style.left = `${snapLeft}px`;
  buddy.style.top = `${snapTop}px`;
  buddy.style.bottom = 'auto';
  buddy.style.right = 'auto';

  catFixedLeft = snapLeft;
  catFixedTop = snapTop;
}

async function handleBuddyClick(e) {
  e.stopPropagation();
  console.log('[Staple][content:handleBuddyClick] Cat clicked');
  toggleInlineInput();
}

function showInlineBox() {
  console.log('[Staple][content:showInlineBox] Showing inline box');
  let box = document.getElementById('st-inline-box');
  let isNew = false;
  if (!box) {
    isNew = true;
    box = document.createElement('div');
    box.id = 'st-inline-box';
    box.innerHTML = `
      <textarea id="st-inline-input" placeholder="Ask Staple..." rows="1"></textarea>
      <button id="st-inline-send">Ask</button>
    `;
    document.body.appendChild(box);

    const input = document.getElementById('st-inline-input');
    const sendBtn = document.getElementById('st-inline-send');

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleInlineSubmit();
      }
      if (e.key === 'Escape') {
        hideInlineBox();
      }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
    sendBtn.addEventListener('click', handleInlineSubmit);
  }

  const buddy = document.getElementById('st-buddy');
  const buddyRect = buddy.getBoundingClientRect();
  const buddyCenterX = buddyRect.left + 40;
  const isRightHalf = buddyCenterX > window.innerWidth / 2;

  box.style.top = '';
  box.style.bottom = '';
  box.style.left = '';
  box.style.right = '';

  if (isRightHalf) {
    box.style.right = `${window.innerWidth - buddyRect.right}px`;
  } else {
    box.style.left = `${buddyRect.left}px`;
  }

  const spaceAbove = buddyRect.top;
  if (spaceAbove >= 100) {
    box.style.bottom = `${window.innerHeight - buddyRect.top + 10}px`;
  } else {
    box.style.top = `${buddyRect.bottom + 10}px`;
  }

  const boxWidth = 260;
  const clampMargin = 5;
  if (isRightHalf) {
    const rightPx = parseInt(box.style.right) || 0;
    if (rightPx < clampMargin) box.style.right = `${clampMargin}px`;
    if (window.innerWidth - rightPx - boxWidth < 0) {
      box.style.right = `${window.innerWidth - boxWidth - clampMargin}px`;
    }
  } else {
    const leftPx = parseInt(box.style.left) || 0;
    if (leftPx < clampMargin) box.style.left = `${clampMargin}px`;
    if (leftPx + boxWidth > window.innerWidth - clampMargin) {
      box.style.left = `${window.innerWidth - boxWidth - clampMargin}px`;
    }
  }

  box.style.display = 'flex';

  const input = document.getElementById('st-inline-input');
  if (isNew) {
    setTimeout(() => { if (input) input.focus(); }, 100);
  } else {
    if (input) input.focus();
  }
}

function hideInlineBox() {
  const box = document.getElementById('st-inline-box');
  if (box) {
    box.style.display = 'none';
  }
}

async function handleInlineSubmit() {
  const input = document.getElementById('st-inline-input');
  if (!input) {
    console.error('[Staple][content:handleInlineSubmit] Input element missing from DOM');
    return;
  }
  console.log('[Staple][content:handleInlineSubmit] CALLED', { question: input.value?.trim() || '' });

  const question = input.value.trim();
  if (!question) {
    console.warn('[Staple][content:handleInlineSubmit] Empty query submitted');
    return;
  }

  input.value = '';
  input.style.height = 'auto';
  hideInlineBox();

  setCharacterState('thinking');
  showBubble('Thinking...');

  const currentMap = scrapeElements();
  elementMap = currentMap;

  if (!currentMap || !currentMap.length) {
    elementMap = scrapeElements();
  }
  if (!elementMap.length) {
    console.warn('[Staple][content:handleInlineSubmit] elementMap is empty, cannot send query', { url: window.location.href });
    showBubble('Could not read this page. Try refreshing.');
    setCharacterState('idle');
    return;
  }

  const serializableMap = currentMap.map(({ el, ...rest }) => rest);

  console.log('[Staple][content:handleInlineSubmit] Sending QUERY to background', { question, elementMapSize: serializableMap.length });

  let response;
  try {
    response = await runtime.sendMessage({
      type: 'QUERY',
      question,
      elementMap: serializableMap,
      url: window.location.href,
      title: document.title
    });
  } catch (err) {
    console.error('[Staple][content:handleInlineSubmit] sendMessage failed', { error: err.message });
    showBubble('The extension background is not responding. Try reloading the extension.');
    setCharacterState('idle');
    return;
  }

  console.log('[Staple][content:handleInlineSubmit] Response from background', { response: response ? { success: response.success, elementId: response.result?.elementId } : null });

  if (!response || !response.success) {
    console.error('[Staple][content:handleInlineSubmit] Background returned error or null', { response: response || null });
    showBubble(response?.error || 'Something went wrong.');
    setCharacterState('idle');
    return;
  }

  const result = response.result;

  if (!result || !result.instruction) {
    console.error('[Staple][content:handleInlineSubmit] Invalid result from background', { result: result || null });
    showBubble('Something went wrong. Try again.');
    setCharacterState('idle');
    return;
  }

  console.log('[Staple][content:handleInlineSubmit] Acting on result', { elementId: result.elementId, instruction: result.instruction?.slice(0, 50) });

  if (result.elementId !== null && result.elementId !== undefined) {
    const target = currentMap.find(e => e.id === result.elementId);
    if (target && target.el) {
      const bubble = document.getElementById('st-bubble');
      bubble._pendingText = result.instruction;

      target.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const container = getScrollContainer(target.el);
      scrollCancelled = false;
      await waitForScrollEnd(container);

      if (scrollCancelled) return;

      requestAnimationFrame(() => {
        if (scrollCancelled) return;
        const rect = target.el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        moveCharacter(cx, cy);
      });
    }
  }

  showBubble(result.instruction);

  if (result.context) {
    await new Promise(r => setTimeout(r, 3000));
    showBubble(result.context);
  }

  await new Promise(r => setTimeout(r, 4000));
  await walkHome();
  setTimeout(() => {
    hideBubble();
    resetCharacter();
  }, 3000);
}

let idleSleepTimer = null;
let pawEndListener = null;

function setCharacterState(state) {
  const cat = document.getElementById('st-cat');
  if (!cat) return;

  if (pawEndListener) {
    cat.removeEventListener('animationend', pawEndListener);
    pawEndListener = null;
  }
  if (cleanEndListener) {
    cat.removeEventListener('animationend', cleanEndListener);
    cleanEndListener = null;
  }

  const stateMap = {
    idle: 'state-idle',
    walking: 'state-walking',
    thinking: 'state-thinking',
    paw: 'state-paw',
    sleep: 'state-sleep',
    clean: 'state-clean'
  };
  cat.className = stateMap[state] || 'state-idle';

  if (idleSleepTimer) { clearTimeout(idleSleepTimer); idleSleepTimer = null; }

  if (state === 'idle') {
    startIdleCleanTimer();
    idleSleepTimer = setTimeout(() => {
      if (cat.className === 'state-idle') {
        if (idleCleanTimer) { clearTimeout(idleCleanTimer); idleCleanTimer = null; }
        cat.className = 'state-sleep';
      }
    }, 5000);
  }

  if (state === 'paw') {
    pawEndListener = function onPawEnd() {
      cat.removeEventListener('animationend', pawEndListener);
      pawEndListener = null;
      if (cat.className === 'state-paw') {
        setCharacterState('idle');
      }
    };
    cat.addEventListener('animationend', pawEndListener);
  }
}

function resetCharacter() {
  const buddy = document.getElementById('st-buddy');
  const bubble = document.getElementById('st-bubble');
  const cat = document.getElementById('st-cat');
  if (!buddy) return;

  if (activeScrollCleanup) {
    activeScrollCleanup();
    activeScrollCleanup = null;
  }
  scrollCancelled = true;

  if (walkTransitionEndHandler) {
    buddy.removeEventListener('transitionend', walkTransitionEndHandler);
    walkTransitionEndHandler = null;
  }
  buddy.style.transition = 'none';
  if (catFixedLeft !== null && catFixedTop !== null) {
    buddy.style.left = `${catFixedLeft}px`;
    buddy.style.top = `${catFixedTop}px`;
    buddy.style.bottom = 'auto';
    buddy.style.right = 'auto';
  } else {
    buddy.style.left = '';
    buddy.style.top = '';
    buddy.style.bottom = '80px';
    buddy.style.right = '20px';
  }

  if (cat) cat.style.transform = 'scaleX(1)';

  if (bubble) {
    hideBubble();
    bubble.style.left = '';
    bubble.style.top = '';
  }

  setCharacterState('idle');
  startIdleCleanTimer();
}

const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_ELEMENTS') {
    elementMap = scrapeElements();
    sendResponse({ elementMap, url: window.location.href, title: document.title });
  }
  if (msg.type === 'MOVE_CHARACTER') {
    const target = elementMap.find(e => e.id === msg.elementId);
    if (target) moveCharacter(target.x, target.y);
  }
  if (msg.type === 'SHOW_BUBBLE') {
    showBubble(msg.text);
  }
  if (msg.type === 'SET_STATE') {
    setCharacterState(msg.state);
  }
  if (msg.type === 'TOGGLE_INPUT') {
    toggleInlineInput();
  }
  return true;
});

function init() {
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', init);
    return;
  }
  injectCharacter();
  startObserver();
  elementMap = scrapeElements();
}

init();

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'F') {
    e.preventDefault();
    toggleInlineInput();
  }
});

window.addEventListener('resize', () => {
  const buddy = document.getElementById('st-buddy');
  if (!buddy || !buddy.style.left || !buddy.style.top) return;
  const buddyLeft = parseInt(buddy.style.left);
  const buddyTop = parseInt(buddy.style.top);
  if (isNaN(buddyLeft) || isNaN(buddyTop)) return;
  buddy.style.left = `${Math.max(5, Math.min(buddyLeft, window.innerWidth - 85))}px`;
  buddy.style.top = `${Math.max(5, Math.min(buddyTop, window.innerHeight - 85))}px`;
  const bubble = document.getElementById('st-bubble');
  if (bubble && bubble.style.top) {
    const bubbleTop = parseInt(bubble.style.top);
    if (!isNaN(bubbleTop)) {
      bubble.style.top = `${Math.max(5, bubbleTop)}px`;
    }
  }
});

let scrollTimeout = null;
window.addEventListener('scroll', () => {
  if (scrollTimeout) clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    elementMap = scrapeElements();
    scrollTimeout = null;
  }, 300);
}, { passive: true });
