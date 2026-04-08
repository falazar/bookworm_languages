import fs from 'fs';
import path from 'path';
import puppeteer, { Browser } from 'puppeteer';
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
}

export class GoogleTranslateClient {
  private baseUrl: string;
  private isDebugMode: () => boolean;
  private cache: TranslationCacheAdapter;

  constructor(options: GoogleTranslateClientOptions) {
    this.baseUrl = options.baseUrl;
    this.isDebugMode = options.isDebugMode;
    this.cache = options.cache;
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
    text = text.replace(/”/g, '"');
    // Replace smart quotes and special chars with ASCII
    text = text.replace('\u2019', "'");
    text = text.replace('\u2018', "'");
    text = text.replace('\u201c', '"');
    text = text.replace('\u201d', '"');
    text = text.replace('\u2014', '--');
    text = text.replace('\u2013', '-');
    text = text.replace('“', ' "');
    text = text.replace('”', '" ');
    text = text.replace('—', '--');
    text = text.replace('’', "'");

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

    const translation = await this.fetchTranslationPageData(url);
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
  }

  /**
   * Fetches Google Translate page data and extracts translated text from the rendered page.
   * Also writes the full rendered HTML to `temp_translated_full.html` for debugging.
   */
  private async fetchTranslationPageData(url: string): Promise<string | null> {
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

      // Try to find the translation result
      const translation = await page.evaluate(this.extractTranslationFromHTML);

      // Wait for translation to appear. This also slows request cadence to reduce throttling risk.
      await new Promise(resolve => setTimeout(resolve, 35000));

      // Save the page content for debugging
      const pageContent = await page.content();
      const tempFilePath = path.join(__dirname, '../../../temp_translated_full.html');
      fs.writeFileSync(tempFilePath, pageContent);

      return translation;
    } catch (error) {
      console.error('\nTranslation error:', error);
      throw new Error(`Translation failed: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  // Extract translation from HTML content from googles page after page loads.
  private extractTranslationFromHTML(): string | null {
    // First try to extract from data-text attribute using regex
    const htmlContent = document.documentElement.outerHTML;

    // Look for non-English translations with better quote handling
    const dataTextMatches = htmlContent.match(/data-language-name="([^"]+)"[^>]*data-text="([^"]*(?:\\.[^"]*)*)"/g);
    if (!dataTextMatches) {
      console.log('No dataTextMatches found from google page after page loads.');
    } else {
      console.log('dataTextMatches found from google page after page loads.');
    }

    // Loop and find out language match now.
    if (dataTextMatches) {
      for (const match of dataTextMatches) {
        const languageMatch = match.match(/data-language-name="([^"]+)"/);
        const textMatch = match.match(/data-text="([^"]*(?:\\.[^"]*)*)"/);

        if (languageMatch && textMatch && languageMatch[1] !== 'English') {
          return textMatch[1];
        }
      }
    }

    return null;
  }
}
