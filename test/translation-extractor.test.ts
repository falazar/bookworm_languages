import * as cheerio from 'cheerio';
import { beforeEach, describe, expect, it } from 'vitest';
import { GoogleTranslateClient } from '../src/services/translation/google-translate-client.js';

/**
 * extractTranslationFromHTML is serialised into the browser by page.evaluate, so it only ever uses
 * document.querySelectorAll and Element.getAttribute. Backing those two calls with cheerio lets the
 * real function run under vitest against Google's actual markup shape.
 */
function installDocument(html: string): void {
  const $ = cheerio.load(html);
  (globalThis as unknown as { document: unknown }).document = {
    querySelectorAll: (selector: string) =>
      $(selector)
        .toArray()
        .map(element => ({
          getAttribute: (name: string) => $(element).attr(name) ?? null,
        })),
  };
}

interface ExtractorInternals {
  extractTranslationFromHTML(targetLang: string): { text: string | null; availableCodes: string[] };
}

const extractor = (): ExtractorInternals =>
  new GoogleTranslateClient({
    baseUrl: 'https://translate.google.com',
    isDebugMode: () => false,
    cache: { getCacheKey: () => 'k', getFromCache: () => null, saveToCache: () => undefined },
  }) as unknown as ExtractorInternals;

// Mirrors the two divs Google renders: source first, translation second.
const GOOGLE_PAGE =
  '<div class="aJIq1d" dir="ltr" data-language-code="en" data-language-name="English"' +
  ' data-text="Can machines feel pride?"></div>' +
  '<div jslog="174272; track:JIbuQc;" class="aJIq1d" dir="ltr" data-language-code="fr"' +
  ' data-language-name="French" data-text="Les machines peuvent-elles ressentir de la fierté&nbsp;?"></div>';

describe('extractTranslationFromHTML', () => {
  beforeEach(() => {
    installDocument(GOOGLE_PAGE);
  });

  it('returns the target language, not the source div that appears first', () => {
    const { text, availableCodes } = extractor().extractTranslationFromHTML('fr');

    expect(text).toBe('Les machines peuvent-elles ressentir de la fierté ?');
    expect(availableCodes).toEqual(['en', 'fr']);
  });

  it('can target English, which the old data-language-name !== "English" check could not', () => {
    const { text } = extractor().extractTranslationFromHTML('en');

    expect(text).toBe('Can machines feel pride?');
  });

  it('does not depend on attribute order', () => {
    installDocument(
      '<div data-text="Bonjour" data-language-name="French" data-language-code="fr"></div>' +
        '<div data-language-code="en" data-text="Hello"></div>'
    );

    expect(extractor().extractTranslationFromHTML('fr').text).toBe('Bonjour');
  });

  it('matches regional codes against the base language', () => {
    installDocument('<div data-language-code="zh-CN" data-text="你好"></div>');

    expect(extractor().extractTranslationFromHTML('zh').text).toBe('你好');
  });

  it('reports a miss with the languages that were present', () => {
    const { text, availableCodes } = extractor().extractTranslationFromHTML('de');

    expect(text).toBeNull();
    expect(availableCodes).toEqual(['en', 'fr']);
  });

  it('treats an unpopulated target div as a miss rather than empty content', () => {
    installDocument(
      '<div data-language-code="en" data-text="Hello"></div><div data-language-code="fr" data-text="   "></div>'
    );

    const { text } = extractor().extractTranslationFromHTML('fr');

    expect(text).toBeNull();
  });
});
