import fs from 'fs';
import path from 'path';
import puppeteer, { Browser, Page } from 'puppeteer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface TranslationCacheAdapter {
  getCacheKey: (text: string, targetLang: string, sourceLang: string) => string;
  getFromCache: (cacheKey: string) => string | null;
  saveToCache: (cacheKey: string, translation: string) => void;
}

interface GoogleTranslateClientOptions {
  baseUrl: string;
  isDebugMode: () => boolean;
  cache: TranslationCacheAdapter;
  /** Pause after each request purely to pace ourselves. Raise this if Google starts refusing. */
  requestThrottleMs?: number;
}

export class GoogleTranslateClient {
  /** How long to pace between requests when the caller does not specify. */
  private static readonly DEFAULT_REQUEST_THROTTLE_MS = 10000;
  /** How often to re-check the page while waiting for the translation to render. */
  private static readonly POLL_INTERVAL_MS = 250;
  /** The translation must stay unchanged this long before we trust it is fully rendered. */
  private static readonly SETTLE_MS = 1500;
  /** Give up waiting for a render after this long and use whatever is on the page. */
  private static readonly RENDER_TIMEOUT_MS = 20000;

  private baseUrl: string;
  private isDebugMode: () => boolean;
  private cache: TranslationCacheAdapter;
  private requestThrottleMs: number;

  constructor(options: GoogleTranslateClientOptions) {
    this.baseUrl = options.baseUrl;
    this.isDebugMode = options.isDebugMode;
    this.cache = options.cache;
    this.requestThrottleMs = options.requestThrottleMs ?? GoogleTranslateClient.DEFAULT_REQUEST_THROTTLE_MS;
  }

  /**
   * Translates text using Google Translate via Puppeteer.
   */
  async translateText(
    text: string,
    targetLang: string,
    sourceLang: string = 'auto',
    useCache: boolean = true
  ): Promise<{ translatedText: string; wasCached: boolean }> {
    const debugLogs = true;
    const incomingLength = text.length;

    try {
      // Debug mode - return placeholder text
      if (this.isDebugMode()) {
        console.log('DEBUG MODE: Returning placeholder translation');
        return { translatedText: 'FAKE TRANSLATED TEXT', wasCached: false };
      }

      // Check cache first
      const cacheKey = this.cache.getCacheKey(text, targetLang, sourceLang);
      if (useCache) {
        const cached = this.cache.getFromCache(cacheKey);
        if (cached) {
          return { translatedText: cached, wasCached: true };
        }
      }

      console.log('  🔄 Fetching new translation...');

      // URL encode the text
      // Replace smart quotes and special chars with ASCII
      text = text.replace(/\u2019/g, "'");
      text = text.replace(/\u2018/g, "'");
      text = text.replace(/\u201c/g, '"');
      text = text.replace(/\u201d/g, '"');
      text = text.replace(/\u2014/g, '--');
      text = text.replace(/\u2013/g, '-');
      text = text.replace(/“/g, ' "');
      text = text.replace(/”/g, '" ');
      text = text.replace(/—/g, '--');
      text = text.replace(/’/g, "'");

      // Check for an over limit size maybe here?
      if (text.length > 5000) {
        console.log('DEBUG: Text length:', text.length);
        console.log('ERROR: Text is too long to translate, debug test shortening.');
        text = text.substring(0, 5000);
      }

      const encodedText = encodeURIComponent(text);
      if (debugLogs) {
        // console.log('\n\x1b[33mDEBUG: BEFORE ENCODING TEXT: ', text, '\x1b[0m');
        // console.log('\nDEBUG: AFTER ENCODING TEXT:', encodedText);
      }

      // Build the translation URL
      const url = `${this.baseUrl}/?sl=${sourceLang}&tl=${targetLang}&text=${encodedText}&op=translate`;
      if (debugLogs) {
        // console.log(`\nDEBUG: url=${this.baseUrl}/?sl=${sourceLang}&tl=${targetLang}&text=***`);
      }

      const translation = await this.fetchTranslationPageData(url, targetLang);
      if (!translation) {
        throw new Error('Could not extract translation from response - check temp_translated.html for debugging');
      }

      // First decode URL encoding, then HTML entities
      let decodedTranslation = translation
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, ' ')
        // The DOM decodes &nbsp; to U+00A0 before we see it, so flatten it to a plain space too.
        .replace(/\u00a0/g, ' ')
        .replace(/&apos;/g, "'")
        .replace(/&mdash;/g, '—')
        .replace(/&ndash;/g, '–')
        .replace(/&hellip;/g, '…')
        .replace(/&amp;/g, '&')
        .replace(/&[#\w]+;/g, '');

      // Fix common translation issues
      decodedTranslation = decodedTranslation
        .replace(/epub: type/g, 'epub:type')
        .replace(/aria-label = /g, 'aria-label=')
        .replace(/id = /g, 'id=')
        .replace(/role = /g, 'role=');

      // Save to cache before returning.
      this.cache.saveToCache(cacheKey, decodedTranslation);

      return { translatedText: decodedTranslation, wasCached: false };
    } catch (error) {
      // Log with request context, then let the caller decide whether to retry or abort.
      const reason = error instanceof Error ? error.message : 'Unknown error';
      console.warn(
        `\x1b[31mWARN: translateText failed; source=${sourceLang}; target=${targetLang}; chars=${incomingLength}; reason=${reason}\x1b[0m`
      );
      const stack = error instanceof Error && error.stack ? error.stack : String(error);
      console.warn(`\x1b[31m${stack}\x1b[0m`);
      throw error;
    }
  }

  /**
   * Fetches Google Translate page data and extracts translated text from the rendered page.
   * Also writes the full rendered HTML to `temp_translated_full.html` for debugging.
   */
  private async fetchTranslationPageData(url: string, targetLang: string): Promise<string | null> {
    let browser: Browser | null = null;
    try {
      // Launch Puppeteer browser with stealth settings
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--window-size=1366,768',
          '--start-maximized',
          '--lang=en-US,en',
        ],
      });
      const page = await browser.newPage();

      // Set realistic user agent
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Remove webdriver property
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty((window as unknown as { navigator: { webdriver?: boolean } }).navigator, 'webdriver', {
          get: () => false,
        });
      });

      // Add chrome object
      await page.evaluateOnNewDocument(() => {
        (window as unknown as { chrome?: unknown }).chrome = {
          runtime: {},
        };
      });

      // Override plugins
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty((window as unknown as { navigator: { plugins?: unknown[] } }).navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });
      });

      // Add languages
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty((window as unknown as { navigator: { languages?: string[] } }).navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
      });

      // Set extra headers
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
      });

      await page.setViewport({ width: 1366, height: 768 });

      // Navigate to Google Translate
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 100000,
      });

      // Wait for the translation to actually render before reading it. Extracting straight after
      // networkidle2 used to catch the page mid-render and throw even though Google had succeeded.
      const extracted = await this.waitForStableTranslation(page, targetLang);

      // Save the page content for debugging
      const pageContent = await page.content();
      const tempFilePath = path.join(__dirname, '../../../temp_translated_full.html');
      fs.writeFileSync(tempFilePath, pageContent);

      // Name what the page actually offered, so a miss is diagnosable without opening the dump.
      if (!extracted.text) {
        console.warn(
          `\x1b[31mWARN: no '${targetLang}' translation on page; languages present: ${
            extracted.availableCodes.join(', ') || 'none'
          }\x1b[0m`
        );
      }

      return extracted.text;
    } catch (error) {
      console.error('\nTranslation error:', error);
      throw new Error(`Translation failed: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
    } finally {
      if (browser) {
        await browser.close();
      }

      // Pace requests deliberately, and only for pacing. The old code got this for free from the
      // 35s render wait, which meant one knob controlled two unrelated things. Runs on the failure
      // path too, so we back off rather than hammering Google after an error.
      await this.delay(this.requestThrottleMs);
    }
  }

  /**
   * Polls the page until the requested translation appears and stops changing, so we read a finished
   * render rather than whatever happened to exist when the network went quiet.
   * @param page - The Puppeteer page showing Google Translate
   * @param targetLang - Requested target language code
   * @returns The extraction result; text may still be null if nothing rendered in time
   */
  private async waitForStableTranslation(
    page: Page,
    targetLang: string
  ): Promise<{ text: string | null; availableCodes: string[] }> {
    const startedAt = Date.now();
    let latest: { text: string | null; availableCodes: string[] } = { text: null, availableCodes: [] };
    let previousText: string | null = null;
    let lastChangedAt = startedAt;

    while (Date.now() - startedAt < GoogleTranslateClient.RENDER_TIMEOUT_MS) {
      latest = await page.evaluate(this.extractTranslationFromHTML, targetLang);

      if (latest.text !== previousText) {
        // Still rendering, so restart the settle window.
        previousText = latest.text;
        lastChangedAt = Date.now();
      } else if (latest.text && Date.now() - lastChangedAt >= GoogleTranslateClient.SETTLE_MS) {
        console.log(`  ✅ Translation settled after ${Date.now() - startedAt}ms`);
        return latest;
      }

      await this.delay(GoogleTranslateClient.POLL_INTERVAL_MS);
    }

    // Out of time. Hand back whatever is there; a partial render shows up downstream as missing
    // paragraph markers, which the caller already retries.
    console.warn(`\x1b[31mWARN: translation did not settle within ${GoogleTranslateClient.RENDER_TIMEOUT_MS}ms\x1b[0m`);
    return latest;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Extracts translation from googles page after page loads. Runs inside the browser context.
   *
   * Reads the attributes through the DOM instead of regexing outerHTML, so attribute order does not
   * matter and entity-encoded values (&#39;, &nbsp;) come back already decoded. Matches on
   * data-language-code rather than on the data-language-name label, so translating *into* English
   * works and Google's UI language does not matter.
   *
   * @param targetLang - Requested target language code
   * @returns The translated text, plus every language code present for diagnostics on a miss
   */
  private extractTranslationFromHTML(targetLang: string): { text: string | null; availableCodes: string[] } {
    const baseLanguage = (code: string): string => code.toLowerCase().split('-')[0];
    const wantedLanguage = baseLanguage(targetLang);
    const availableCodes: string[] = [];

    for (const node of Array.from(document.querySelectorAll('[data-text]'))) {
      const code = node.getAttribute('data-language-code');
      if (!code) {
        continue;
      }
      availableCodes.push(code);

      // Only accept the requested language. Falling back to "any other language" would hand back
      // the untranslated source text and quietly write English into the translated book.
      const text = node.getAttribute('data-text');
      if (baseLanguage(code) === wantedLanguage && text && text.trim() !== '') {
        return { text, availableCodes };
      }
    }

    return { text: null, availableCodes };
  }
}
