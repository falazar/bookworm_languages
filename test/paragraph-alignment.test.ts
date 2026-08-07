import { describe, expect, it } from 'vitest';
import { TranslationService } from '../src/translation-service.js';

/**
 * The numbered-marker helpers are private, so reach them through a narrow structural view
 * rather than loosening their visibility in production code.
 */
interface AlignmentInternals {
  buildParagraphMarker(index: number): string;
  joinParagraphsForTranslation(paragraphs: string[]): string;
  alignTranslatedParagraphs(translatedText: string, expectedCount: number): { lines: string[]; missing: number[] };
}

const internals = (): AlignmentInternals => new TranslationService() as unknown as AlignmentInternals;

describe('numbered paragraph markers', () => {
  it('prefixes every paragraph with its own index', () => {
    const service = internals();
    const joined = service.joinParagraphsForTranslation(['first', 'second', 'third']);

    expect(joined).toBe('[[[__BW_PSEP_0000__]]] first [[[__BW_PSEP_0001__]]] second [[[__BW_PSEP_0002__]]] third');
  });

  it('round-trips when every marker survives translation', () => {
    const service = internals();
    const paragraphs = ['alpha', 'beta', 'gamma'];
    const { lines, missing } = service.alignTranslatedParagraphs(
      service.joinParagraphsForTranslation(paragraphs),
      paragraphs.length
    );

    expect(missing).toEqual([]);
    expect(lines).toEqual(paragraphs);
  });

  /**
   * Regression for the observed real failure: Google returned a complete translation of a
   * 10-paragraph chunk but deleted the first three markers, merging paragraphs 0-3.
   * The surviving markers must still land on their original indexes.
   */
  it('keeps later paragraphs aligned when leading markers are deleted', () => {
    const service = internals();
    const marker = (index: number) => service.buildParagraphMarker(index);
    const translated =
      `${marker(0)} fr0 fr1 fr2 fr3 ` +
      `${marker(4)} fr4 ${marker(5)} fr5 ${marker(6)} fr6 ` +
      `${marker(7)} fr7 ${marker(8)} fr8 ${marker(9)} fr9`;

    const { lines, missing } = service.alignTranslatedParagraphs(translated, 10);

    expect(missing).toEqual([1, 2, 3]);
    // The merged text stays on the paragraph it started at.
    expect(lines[0]).toBe('fr0 fr1 fr2 fr3');
    expect(lines[1]).toBe('');
    expect(lines[3]).toBe('');
    // Everything after the damage is still on its own index, not shifted back by three.
    expect(lines.slice(4)).toEqual(['fr4', 'fr5', 'fr6', 'fr7', 'fr8', 'fr9']);
  });

  /**
   * Regression for `UNRESOLVED PARAGRAPH INDEXES: 0` seen on a 13-paragraph chunk. The leading
   * marker is the one the translator strips most often, and text ahead of the first surviving
   * marker used to be skipped entirely, silently dropping that paragraph's translation.
   */
  it('claims text before the first surviving marker for paragraph 0', () => {
    const service = internals();
    const marker = (index: number) => service.buildParagraphMarker(index);
    // Marker 0 deleted; the translation of paragraph 0 now leads the string.
    const translated = `fr0 ${marker(1)} fr1 ${marker(2)} fr2`;

    const { lines, missing } = service.alignTranslatedParagraphs(translated, 3);

    expect(missing).toEqual([]);
    expect(lines).toEqual(['fr0', 'fr1', 'fr2']);
  });

  it('does not let leading text overwrite a marker 0 that arrived out of order', () => {
    const service = internals();
    const marker = (index: number) => service.buildParagraphMarker(index);
    const translated = `stray ${marker(1)} fr1 ${marker(0)} fr0`;

    const { lines, missing } = service.alignTranslatedParagraphs(translated, 2);

    expect(missing).toEqual([]);
    expect(lines).toEqual(['fr0', 'fr1']);
  });

  it('recovers indexes from markers the translator reformatted', () => {
    const service = internals();
    const translated = '[[[__BW_PSEP_0000__]]] zero [[ bw psep 1 ]] one BW_PSEP_2 two';

    const { lines, missing } = service.alignTranslatedParagraphs(translated, 3);

    expect(missing).toEqual([]);
    expect(lines).toEqual(['zero', 'one', 'two']);
  });

  it('ignores invented duplicate and out-of-range indexes', () => {
    const service = internals();
    const marker = (index: number) => service.buildParagraphMarker(index);
    const translated = `${marker(0)} keep ${marker(0)} duplicate ${marker(9)} out-of-range ${marker(1)} second`;

    const { lines, missing } = service.alignTranslatedParagraphs(translated, 2);

    expect(missing).toEqual([]);
    expect(lines).toEqual(['keep', 'second']);
  });

  it('reports every index as missing when all markers are stripped', () => {
    const service = internals();

    const { lines, missing } = service.alignTranslatedParagraphs('a translation with no markers at all', 3);

    expect(missing).toEqual([0, 1, 2]);
    expect(lines).toEqual(['', '', '']);
  });
});
