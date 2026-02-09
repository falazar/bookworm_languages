console.log('[TTS] Script starting');
console.log(
  '[TTS] Note: The "Uncaught (in promise) Error: Access to storage" errors are from browser extensions and can be ignored'
);

// Disable scroll restoration to prevent browser from interfering
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

// Global error handler to catch any uncaught errors
window.addEventListener('error', e => {
  console.error('[TTS] Uncaught error at:', e.filename, 'line:', e.lineno, 'col:', e.colno);
  console.error('[TTS] Error message:', e.message);
  console.error('[TTS] Error object:', e.error);
  console.error('[TTS] Full event:', e);
  // Prevent the error from showing in console as uncaught
  e.preventDefault();
});

window.addEventListener('unhandledrejection', e => {
  console.error('[TTS] Unhandled promise rejection:');
  console.error('[TTS] Reason:', e.reason);
  console.error('[TTS] Promise:', e.promise);
  console.error('[TTS] Full event:', e);
  // Try to get stack trace
  if (e.reason && e.reason.stack) {
    console.error('[TTS] Stack trace:', e.reason.stack);
  }
  // Prevent the rejection from showing in console
  e.preventDefault();
});

// Get server-provided data
const books = window.TTS_DATA.books;
const currentBook = window.TTS_DATA.currentBook;
const docs = window.TTS_DATA.docs;
const docLabels = window.TTS_DATA.docLabels;
const currentDoc = window.TTS_DATA.currentDoc;
const paragraphData = window.TTS_DATA.paragraphData;
const savedParagraphIndex = window.TTS_DATA.savedParagraphIndex;

const bookSelect = document.getElementById('bookSelect');
const docSelect = document.getElementById('docSelect');
const voiceSelectEn = document.getElementById('voiceSelectEn');
const rateEn = document.getElementById('rateEn');
const rateFr = document.getElementById('rateFr');
const pitchInput = document.getElementById('pitch');
const fontSizeInput = document.getElementById('fontSize');
const showLangSelect = document.getElementById('showLang');
const settingsToggleBtn = document.getElementById('settingsToggle');
const settingsPanel = document.getElementById('settingsPanel');
const btnPlay = document.getElementById('play');
const btnPause = document.getElementById('pause');
const btnResume = document.getElementById('resume');
const btnStop = document.getElementById('stop');
const paras = Array.from(document.querySelectorAll('.para'));
// Add IDs to paragraphs for anchor navigation
paras.forEach((p, i) => {
  p.id = 'p' + i;
});
const nextChapterBtn = document.getElementById('nextChapter');

// Debug logging flag (enable via ?debug=1)
const DEBUG_TTS = /[?&]debug=1/.test(location.search);
function logState(prefix) {
  try {
    const s = window.speechSynthesis;
    if (DEBUG_TTS) console.log(`[TTS] ${prefix} | speaking=${s.speaking} paused=${s.paused} pending=${s.pending}`);
  } catch (_) {}
}

let voices = [];
let queue = [];
let currentIndex = -1;
let userPaused = false;
// Track currently playing paragraph index
let currentPlayingIdx = -1;
// Suppress synthetic click after touch to avoid double-handling
let lastTouchTs = 0;

// Keep screen awake while reading using the Screen Wake Lock API
let wakeLock = null;
async function requestWakeLock() {
  try {
    if (navigator.wakeLock && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    }
  } catch (err) {
    console.warn('Wake Lock error:', err);
    wakeLock = null;
  }
}
async function releaseWakeLock() {
  try {
    if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (_) {}
}

// Try resume, fallback to restart if engine stays paused or idle
function resumeOrRestart(idx) {
  logState('resumeOrRestart: before resume');
  try {
    requestWakeLock().catch(() => {});
  } catch (_) {}
  try {
    window.speechSynthesis.resume();
  } catch (_) {}
  setTimeout(() => {
    try {
      const s = window.speechSynthesis;
      // If still paused OR not speaking and no pending utterances, restart from the same paragraph
      if (s.paused || (!s.speaking && !s.pending)) {
        logState('resumeOrRestart: fallback restart');
        s.cancel();
        requestWakeLock().catch(() => {});
        speakParagraphs(idx);
      } else {
        logState('resumeOrRestart: resume took effect');
      }
    } catch (_) {}
  }, 180);
}

// Reacquire on visibility change (wake locks can be released when tab is hidden)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (window.speechSynthesis.speaking || window.speechSynthesis.paused)) {
    requestWakeLock().catch(() => {});
  }
});

// Check if localStorage is available
function isLocalStorageAvailable() {
  console.log('[TTS] Checking localStorage availability');
  try {
    const test = '__localStorage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    console.log('[TTS] localStorage is available');
    return true;
  } catch (e) {
    console.warn('[TTS] localStorage not available:', e);
    return false;
  }
}
const localStorageAvailable = isLocalStorageAvailable();

// Local storage keys
const LS = {
  book: 'tts.selectedBook',
  doc: 'tts.selectedDoc',
  rateEn: 'tts.rateEn',
  rateFr: 'tts.rateFr',
  fontSize: 'tts.fontSize',
  showLang: 'tts.showLang',
};

function saveProgressToServer(paragraphIndex) {
  console.log('[TTS] Saving progress to server:', { book: currentBook, doc: currentDoc, paragraphIndex });
  fetch('/save-progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      book: currentBook,
      doc: currentDoc,
      paragraphIndex: paragraphIndex,
    }),
  })
    .then(() => {
      console.log('[TTS] Progress saved successfully');
    })
    .catch(err => {
      console.warn('[TTS] Failed to save progress:', err);
    });
}

function loadBooks() {
  console.log('[TTS] loadBooks called');
  bookSelect.innerHTML = '';
  books.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b;
    opt.textContent = b;
    bookSelect.appendChild(opt);
  });
  let storedBook;
  console.log('[TTS] About to get storedBook from localStorage');
  try {
    if (localStorageAvailable) storedBook = localStorage.getItem(LS.book);
  } catch (e) {
    console.warn('[TTS] localStorage error (book):', e);
  }
  const chosenBook = storedBook && books.includes(storedBook) ? storedBook : currentBook;
  if (chosenBook) {
    bookSelect.value = chosenBook;
  } else if (books.length > 0) {
    // No saved or current book; default to first and navigate to load chapters
    bookSelect.value = books[0];
    const url = new URL(window.location.href);
    url.searchParams.set('book', books[0]);
    url.searchParams.delete('doc');
    window.location.replace(url.toString());
    return;
  }
}

function loadDocs() {
  console.log('[TTS] loadDocs called');
  docSelect.innerHTML = '';
  docs.forEach((d, idx) => {
    const opt = document.createElement('option');
    opt.value = d;
    // For Flashback book, use filename instead of title since all titles are the same
    const isFlashback = currentBook && currentBook.toLowerCase().includes('flashback');
    let label;
    if (isFlashback) {
      // Strip directory path and parse filename like "OEBPS/chapter001.html" -> "Chapter 1"
      const filename = String(d).split('/').pop().split('\\').pop();
      const match = filename.match(/chapter(\d+)/i);
      label = match ? `Chapter ${parseInt(match[1], 10)}` : filename;
    } else {
      label = Array.isArray(docLabels) && docLabels[idx] ? String(docLabels[idx]) : String(d);
    }
    if (label.length > 30) label = label.slice(0, 27) + '…';
    opt.textContent = label;
    docSelect.appendChild(opt);
  });
  let storedDoc;
  console.log('[TTS] About to get storedDoc from localStorage');
  try {
    if (localStorageAvailable) storedDoc = localStorage.getItem(LS.doc);
  } catch (e) {
    console.warn('[TTS] localStorage error (doc):', e);
  }
  const chosenDoc = storedDoc && docs.includes(storedDoc) ? storedDoc : currentDoc;
  if (chosenDoc) docSelect.value = chosenDoc;
}

function loadVoices() {
  voices = window.speechSynthesis.getVoices();
  // Populate English voices
  voiceSelectEn.innerHTML = '';
  voices.forEach((v, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${v.name} — ${v.lang}${v.default ? ' (default)' : ''}`;
    voiceSelectEn.appendChild(opt);
  });
  // Populate French voices
  voiceSelectFr.innerHTML = '';
  voices.forEach((v, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${v.name} — ${v.lang}${v.default ? ' (default)' : ''}`;
    voiceSelectFr.appendChild(opt);
  });

  // Prefer language-appropriate defaults
  const defaultEn = voices.findIndex(v => /^en(-|$)/i.test(v.lang));
  const defaultFr = voices.findIndex(v => /^fr(-|$)/i.test(v.lang));
  const googleEn = voices.findIndex(v => /^en(-|$)/i.test(v.lang) && /Google/i.test(v.name));
  const googleFr = voices.findIndex(v => /^fr(-|$)/i.test(v.lang) && /Google/i.test(v.name));
  voiceSelectEn.value = String(googleEn >= 0 ? googleEn : defaultEn >= 0 ? defaultEn : 0);
  voiceSelectFr.value = String(googleFr >= 0 ? googleFr : defaultFr >= 0 ? defaultFr : 0);
}

// Some browsers populate voices asynchronously
try {
  console.log('[TTS] Calling loadVoices');
  loadVoices();
  console.log('[TTS] Calling loadBooks');
  loadBooks();
  console.log('[TTS] Calling loadDocs');
  loadDocs();
  console.log('[TTS] Calling updateNextChapterButton');
  updateNextChapterButton();
  console.log('[TTS] Initialization complete');
} catch (err) {
  console.error('[TTS] Initialization error:', err);
}
if (voices.length === 0) {
  window.speechSynthesis.onvoiceschanged = () => {
    loadVoices();
  };
}

// Restore saved rates
let storedRateEn, storedRateFr, storedFont, storedShow;
try {
  if (localStorageAvailable) {
    storedRateEn = localStorage.getItem(LS.rateEn);
    storedRateFr = localStorage.getItem(LS.rateFr);
  }
  if (storedRateEn) rateEn.value = String(Math.max(0.5, Math.min(2.0, Number(storedRateEn))));
  if (storedRateFr) rateFr.value = String(Math.max(0.5, Math.min(2.0, Number(storedRateFr))));
} catch (e) {
  console.warn('[TTS] localStorage access error (rates):', e);
}

// Restore font size
try {
  if (localStorageAvailable) storedFont = localStorage.getItem(LS.fontSize);
  const initialFont = storedFont ? Math.max(15, Math.min(26, Number(storedFont))) : 17;
  fontSizeInput.value = String(initialFont);
  document.documentElement.style.setProperty('--base-font', initialFont + 'px');
} catch (e) {
  console.warn('[TTS] localStorage access error (font):', e);
}

// On book change, navigate to first chapter
bookSelect.addEventListener('change', () => {
  const b = bookSelect.value;
  try {
    if (localStorageAvailable) localStorage.setItem(LS.book, b);
  } catch (e) {
    console.warn('[TTS] localStorage set error (book):', e);
  }
  const url = new URL(window.location.href);
  url.searchParams.set('book', b);
  url.searchParams.delete('doc');
  window.location.href = url.toString();
});
// On chapter change, navigate within book
docSelect.addEventListener('change', () => {
  const d = docSelect.value;
  try {
    if (localStorageAvailable) localStorage.setItem(LS.doc, d);
  } catch (e) {
    console.warn('[TTS] localStorage set error (doc):', e);
  }
  const url = new URL(window.location.href);
  url.searchParams.set('book', bookSelect.value || currentBook);
  url.searchParams.set('doc', d);
  window.location.href = url.toString();
});

function updateNextChapterButton() {
  const idx = docSelect.selectedIndex >= 0 ? docSelect.selectedIndex : docs.indexOf(docSelect.value || currentDoc);
  const hasNext = idx >= 0 && idx < docs.length - 1;
  nextChapterBtn.style.display = hasNext ? 'inline-block' : 'none';

  if (hasNext) {
    const nextIdx = idx + 1;
    const nextDoc = docs[nextIdx];
    const isFlashback = currentBook && currentBook.toLowerCase().includes('flashback');
    let label;
    if (isFlashback) {
      const filename = String(nextDoc).split('/').pop().split('\\').pop();
      const match = filename.match(/chapter(\d+)/i);
      label = match ? `Chapter ${parseInt(match[1], 10)}` : filename;
    } else {
      label = Array.isArray(docLabels) && docLabels[nextIdx] ? String(docLabels[nextIdx]) : String(nextDoc);
    }
    if (label.length > 30) label = label.slice(0, 27) + '…';
    nextChapterBtn.textContent = `Next Chapter: ${label} →`;
  }
}
docSelect.addEventListener('change', updateNextChapterButton);
// Book change triggers navigation; next-chapter button will update on the new page

nextChapterBtn.addEventListener('click', () => {
  const idx = docSelect.selectedIndex >= 0 ? docSelect.selectedIndex : docs.indexOf(docSelect.value || currentDoc);
  if (idx < 0 || idx >= docs.length - 1) return;
  const nextDoc = docs[idx + 1];
  try {
    if (localStorageAvailable) localStorage.setItem(LS.doc, nextDoc);
  } catch (e) {
    console.warn('[TTS] localStorage set error (nextDoc):', e);
  }
  const url = new URL(window.location.href);
  url.searchParams.set('book', bookSelect.value || currentBook);
  url.searchParams.set('doc', nextDoc);
  window.location.href = url.toString();
});

// Persist rate changes
rateEn.addEventListener('input', () => {
  try {
    if (localStorageAvailable) localStorage.setItem(LS.rateEn, rateEn.value);
  } catch (e) {
    console.warn('[TTS] localStorage set error (rateEn):', e);
  }
});
rateFr.addEventListener('input', () => {
  try {
    if (localStorageAvailable) localStorage.setItem(LS.rateFr, rateFr.value);
  } catch (e) {
    console.warn('[TTS] localStorage set error (rateFr):', e);
  }
});

// Persist font size changes
fontSizeInput.addEventListener('input', () => {
  const size = Math.max(15, Math.min(26, Number(fontSizeInput.value)));
  document.documentElement.style.setProperty('--base-font', size + 'px');
  try {
    if (localStorageAvailable) localStorage.setItem(LS.fontSize, String(size));
  } catch (e) {
    console.warn('[TTS] localStorage set error (fontSize):', e);
  }
});

// Settings panel toggle (persisted in localStorage)
const LS_SETTINGS = 'tts.settingsOpen';
let settingsOpenStored;
try {
  if (localStorageAvailable) settingsOpenStored = localStorage.getItem(LS_SETTINGS);
} catch (e) {
  console.warn('[TTS] localStorage get error (settings):', e);
}
const isOpen = settingsOpenStored === '1';
if (isOpen) settingsPanel.classList.add('open');
settingsToggleBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
  try {
    if (localStorageAvailable) localStorage.setItem(LS_SETTINGS, settingsPanel.classList.contains('open') ? '1' : '0');
  } catch (e) {
    console.warn('[TTS] localStorage set error (settings):', e);
  }
});

function applyLanguageFilter() {
  const val = showLangSelect.value || 'both';
  paras.forEach(el => {
    const lang = el.getAttribute('data-lang');
    const hide = (val === 'en' && lang === 'fr') || (val === 'fr' && lang === 'en');
    if (hide) el.classList.add('hidden');
    else el.classList.remove('hidden');
  });
}

// Restore language visibility preference
try {
  let storedShow;
  if (localStorageAvailable) storedShow = localStorage.getItem(LS.showLang);
  showLangSelect.value = storedShow || 'both';
} catch (e) {
  console.warn('[TTS] localStorage access error (showLang):', e);
}
applyLanguageFilter();

// Change visibility and reset playback when filter changes
showLangSelect.addEventListener('change', () => {
  try {
    if (localStorageAvailable) localStorage.setItem(LS.showLang, showLangSelect.value);
  } catch (e) {
    console.warn('[TTS] localStorage set error (showLang):', e);
  }
  applyLanguageFilter();
  window.speechSynthesis.cancel();
  currentIndex = -1;
  paras.forEach(el => {
    el.classList.remove('playing');
    el.classList.remove('paired');
  });
});

function speakParagraphs(startIdx = 0) {
  // Build queue from server-provided paragraphData with language hints and current visibility filter
  const val = showLangSelect.value || 'both';
  let items = paragraphData.map((item, idx) => ({
    text: String(item.text || ''),
    lang: String(item.lang || 'en'),
    idx,
  }));
  if (val === 'en') items = items.filter(it => it.lang === 'en');
  else if (val === 'fr') items = items.filter(it => it.lang === 'fr');
  queue = items;
  // Map DOM index to position in filtered queue
  let startPos = queue.findIndex(it => it.idx === startIdx);
  if (startPos < 0) startPos = 0;
  currentIndex = startPos;
  if (DEBUG_TTS)
    console.log(
      `[TTS] speakParagraphs startIdx=${startIdx} filter=${val} queueLen=${queue.length} startPos=${startPos}`
    );
  requestWakeLock().catch(() => {});
  speakNext();
}

function markPlaying(idx) {
  try {
    currentPlayingIdx = idx;
    const el = paras[idx];
    if (el) {
      const current = paragraphData[idx];
      const currentLang = current && current.lang;

      // Only clear and highlight for French paragraphs
      if (currentLang === 'fr') {
        paras.forEach(el => {
          el.classList.remove('playing');
        });
        el.classList.add('playing');

        // Scroll to the previous visible paragraph for each French section
        let prevIdx = idx - 1;
        while (prevIdx >= 0 && paras[prevIdx] && paras[prevIdx].classList.contains('hidden')) prevIdx--;
        const scrollToIdx = prevIdx >= 0 ? prevIdx : idx;
        if (scrollToIdx >= 0) {
          window.location.hash = '#p' + scrollToIdx;
        }
      }
    }
  } catch (e) {
    console.error('[TTS] markPlaying error:', e);
  }
}

let speakNextCallDepth = 0;
const MAX_SPEAK_DEPTH = 100;

function speakNext() {
  speakNextCallDepth++;
  if (speakNextCallDepth > MAX_SPEAK_DEPTH) {
    console.error('[TTS] RECURSION LIMIT HIT - stopping to prevent stack overflow');
    speakNextCallDepth = 0;
    return;
  }

  if (currentIndex < 0 || currentIndex >= queue.length) {
    currentIndex = 1000;
    currentPlayingIdx = -1;
    paras.forEach(el => {
      el.classList.remove('playing');
    });
    speakNextCallDepth = 0;
    return; // stop at end; do not restart
  }
  const item = queue[currentIndex];
  if (DEBUG_TTS)
    console.log(
      `[TTS] speakNext currentIndex=${currentIndex}/${queue.length} lang=${item.lang} idx=${item.idx} textLen=${item.text?.length || 0}`
    );
  const u = new SpeechSynthesisUtterance(item.text);
  // Pick voice by language
  const vIdx = item.lang === 'fr' ? Number(voiceSelectFr.value) : Number(voiceSelectEn.value);
  const v = voices[vIdx] || voices.find(v => v.default) || voices[0];
  if (v) u.voice = v;
  // Also set lang hint to guide synthesis engine
  u.lang = item.lang === 'fr' ? 'fr-FR' : 'en-US';
  // Use per-language rate
  u.rate = item.lang === 'fr' ? Number(rateFr.value) : Number(rateEn.value);
  u.pitch = Number(pitchInput.value);
  u.onstart = () => {
    if (DEBUG_TTS) console.log(`[TTS] onstart idx=${item.idx} lang=${item.lang}`);
    userPaused = false;
    speakNextCallDepth = 0;
    markPlaying(item.idx);
  };
  u.onend = () => {
    if (DEBUG_TTS) console.log(`[TTS] onend idx=${item.idx}`);
    // Save progress after each paragraph
    saveProgressToServer(item.idx + 1); // Save the next paragraph index
    if (currentIndex + 1 >= queue.length) {
      // Finished last paragraph; clear playing state and stop
      paras.forEach(el => {
        el.classList.remove('playing');
        el.classList.remove('paired');
      });
      currentIndex = 1000;
      speakNextCallDepth = 0;
      releaseWakeLock();
      return;
    }
    currentIndex++;
    speakNext();
  };
  u.onerror = e => {
    console.warn('[TTS] error:', e.error);
    if (currentIndex + 1 >= queue.length) {
      paras.forEach(el => {
        el.classList.remove('playing');
        el.classList.remove('paired');
      });
      currentIndex = 1000;
      speakNextCallDepth = 0;
      return;
    }
    currentIndex++;
    speakNext();
  };
  window.speechSynthesis.speak(u);
}

btnPlay.addEventListener('click', () => {
  window.speechSynthesis.cancel();
  requestWakeLock().catch(() => {});
  speakParagraphs(0);
});
btnPause.addEventListener('click', () => {
  if (DEBUG_TTS) console.log('[TTS] button pause');
  userPaused = true;
  window.speechSynthesis.pause();
});
btnResume.addEventListener('click', () => {
  if (DEBUG_TTS) console.log('[TTS] button resume');
  requestWakeLock().catch(() => {});
  userPaused = false;
  window.speechSynthesis.resume();
});
btnStop.addEventListener('click', () => {
  window.speechSynthesis.cancel();
  currentIndex = -1;
  paras.forEach(el => {
    el.classList.remove('playing');
    el.classList.remove('paired');
  });
  releaseWakeLock();
});

// Click a paragraph to start reading from it
const contentEl = document.getElementById('content');
contentEl.addEventListener('click', ev => {
  // Ignore synthetic clicks that immediately follow a touch
  if (Date.now() - lastTouchTs < 400) return;
  const target = ev.target;
  const para = target && target.closest ? target.closest('.para') : null;
  if (!para) return;
  const idx = Number(para.getAttribute('data-index'));
  if (DEBUG_TTS) console.log(`[TTS] click paragraph idx=${idx} currentPlayingIdx=${currentPlayingIdx}`);
  // If clicking the currently playing paragraph, toggle pause/resume
  if (idx === currentPlayingIdx) {
    const s = window.speechSynthesis;
    const shouldResume = s.paused || userPaused;
    if (shouldResume) {
      if (DEBUG_TTS) console.log(`[TTS] action: resume (click current) paused=${s.paused} userPaused=${userPaused}`);
      userPaused = false;
      resumeOrRestart(idx);
    } else if (s.speaking) {
      if (DEBUG_TTS) console.log('[TTS] action: pause (click current)');
      userPaused = true;
      s.pause();
    } else {
      if (DEBUG_TTS) console.log('[TTS] action: restart (click current idle)');
      s.cancel();
      requestWakeLock().catch(() => {});
      speakParagraphs(idx);
    }
    return;
  }
  // Otherwise restart from the clicked paragraph
  if (DEBUG_TTS) console.log('[TTS] action: restart (click other)');
  window.speechSynthesis.cancel();
  requestWakeLock().catch(() => {});
  speakParagraphs(idx);
});

// Keyboard: suppress Tab navigation; Space toggles pause/resume (robust resume)
window.addEventListener('keydown', e => {
  // Always suppress Tab so it doesn't move focus
  if (e.key === 'Tab' || e.code === 'Tab') {
    if (DEBUG_TTS) console.log('[TTS] Tab suppressed');
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const isSpace = e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';
  if (!isSpace) return;
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/i.test(tag)) return; // don't hijack space in controls
  e.preventDefault();
  const s = window.speechSynthesis;
  // Resume if paused (or flagged paused), otherwise pause if speaking
  if (s.paused || userPaused) {
    if (DEBUG_TTS) console.log(`[TTS] action: resume (space) paused=${s.paused} userPaused=${userPaused}`);
    userPaused = false;
    requestWakeLock().catch(() => {});
    const curIdx = currentIndex >= 0 && currentIndex < queue.length ? (queue[currentIndex]?.idx ?? 0) : 0;
    resumeOrRestart(curIdx);
    return;
  }
  if (s.speaking) {
    if (DEBUG_TTS) console.log('[TTS] action: pause (space)');
    userPaused = true;
    s.pause();
    return;
  }
  // If idle, do nothing; user can click a paragraph or press Play to start
});

// Auto-start on load for convenience
window.addEventListener('load', () => {
  try {
    console.log('[TTS] Page load event fired');
    console.log('[TTS] About to setup setTimeout for positioning');

    setTimeout(() => {
      console.log('[TTS] Inside setTimeout callback');
      console.log('[TTS] Positioning to saved paragraph:', savedParagraphIndex);
      if (savedParagraphIndex > 0 && savedParagraphIndex < paras.length) {
        // Scroll to and highlight the saved paragraph
        const el = paras[savedParagraphIndex];
        if (el) {
          console.log('[TTS] About to scrollIntoView');
          try {
            // Use immediate scroll instead of smooth to avoid animation promises
            el.scrollIntoView({ behavior: 'auto', block: 'center' });
            console.log('[TTS] scrollIntoView completed');
          } catch (err) {
            console.error('[TTS] Error in scrollIntoView:', err);
          }
          console.log('[TTS] About to add playing class');
          el.classList.add('playing'); // Highlight it
          console.log('[TTS] Added playing class');
        }
      }
      console.log('[TTS] Exiting setTimeout callback');
    }, 300);
    console.log('[TTS] After setTimeout setup');
  } catch (e) {
    console.error('[TTS] Error in load event:', e);
  }
});

// Clean up wake lock on unload
window.addEventListener('beforeunload', () => {
  releaseWakeLock();
});
