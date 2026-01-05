import AdmZip from 'adm-zip';
import * as cheerio from 'cheerio';
import path from 'path';

export class ReaderService {
  /**
   * Get list of chapter document paths (XHTML/HTML) from an EPUB.
   * It reads container.xml → OPF and returns spine-ordered docs, falling back to all docs.
   */
  getChapters(epubPath: string): string[] {
    const zip = new AdmZip(epubPath);
    const entries = zip.getEntries();

    const getEntryText = (name: string): string | null => {
      const entry = entries.find((e: any) => e.entryName === name);
      if (!entry) return null;
      return entry.getData().toString('utf8');
    };

    const containerXml = getEntryText('META-INF/container.xml');
    if (!containerXml) {
      // Invalid EPUB; return fallback list
      return this.listAllHtmlDocs(entries);
    }
    const $container = cheerio.load(containerXml, { xmlMode: true });
    const rootfilePath = $container('rootfile').attr('full-path');
    if (!rootfilePath) {
      return this.listAllHtmlDocs(entries);
    }

    const opfXml = getEntryText(rootfilePath);
    if (!opfXml) {
      return this.listAllHtmlDocs(entries);
    }
    const $opf = cheerio.load(opfXml, { xmlMode: true });
    const manifest: Record<string, string> = {};
    $opf('manifest item').each((_, el) => {
      const id = $opf(el).attr('id');
      const href = $opf(el).attr('href');
      const mediaType = $opf(el).attr('media-type');
      if (id && href && mediaType && /xhtml|html/.test(mediaType)) {
        manifest[id] = href;
      }
    });
    const spineIds: string[] = [];
    $opf('spine itemref').each((_, el) => {
      const idref = $opf(el).attr('idref');
      if (idref) spineIds.push(idref);
    });
    const opfDir = path.posix.dirname(rootfilePath.replace(/\\/g, '/'));
    const docs = spineIds
      .map(id => manifest[id])
      .filter(Boolean)
      .map(href => (opfDir && href ? `${opfDir}/${href}` : (href as string)));

    if (docs.length === 0) {
      return this.listAllHtmlDocs(entries);
    }
    return docs;
  }

  /**
   * Count chapters for an EPUB using spine; fallback to all HTML/XHTML files.
   */
  getChapterCount(epubPath: string): number {
    try {
      const docs = this.getChapters(epubPath);
      return docs.length;
    } catch {
      return 0;
    }
  }

  /**
   * Produce human-friendly labels for chapters by reading each doc's heading or title.
   * Falls back to file basename or sequential numbering.
   */
  getChapterLabels(epubPath: string, docs: string[]): string[] {
    try {
      const zip = new AdmZip(epubPath);
      const entries = zip.getEntries();
      const labels: string[] = [];
      for (let i = 0; i < docs.length; i++) {
        const docPath = docs[i];
        const entry = entries.find((e: any) => e.entryName === docPath);
        let label = '';
        if (entry) {
          try {
            const raw = entry.getData().toString('utf8');
            const $ = cheerio.load(raw, { xmlMode: true });
            label = $('h1').first().text().trim()
              || $('h2').first().text().trim()
              || $('h3').first().text().trim()
              || $('title').first().text().trim();
            label = (label || '').replace(/\s+/g, ' ').trim();
          } catch {}
        }
        if (!label) {
          const base = path.posix.basename(docPath).replace(/\.[^.]+$/, '');
          label = base || `Chapter ${i + 1}`;
        }
        labels.push(label);
      }
      return labels;
    } catch {
      // Fallback to simple numbering
      return docs.map((_, i) => `Chapter ${i + 1}`);
    }
  }

  private listAllHtmlDocs(entries: any[]): string[] {
    return entries.map((e: any) => e.entryName).filter((n: string) => /\.xhtml$|\.html$/i.test(n));
  }

  /**
   * Return a data URL for the EPUB cover image, if found.
   * Attempts EPub2 (metadata meta[name=cover]) and EPub3 (manifest item properties~="cover-image").
   */
  getCoverDataUrl(epubPath: string): string | null {
    try {
      const zip = new AdmZip(epubPath);
      const entries = zip.getEntries();
      const getEntryText = (name: string): string | null => {
        const entry = entries.find((e: any) => e.entryName === name);
        if (!entry) return null;
        return entry.getData().toString('utf8');
      };
      const containerXml = getEntryText('META-INF/container.xml');
      if (!containerXml) return null;
      const $container = cheerio.load(containerXml, { xmlMode: true });
      const rootfilePath = $container('rootfile').attr('full-path');
      if (!rootfilePath) return null;
      const opfXml = getEntryText(rootfilePath);
      if (!opfXml) return null;
      const $opf = cheerio.load(opfXml, { xmlMode: true });

      // Try EPub2: metadata meta[name="cover"] content points to manifest id
      let coverId = $opf('metadata meta[name="cover"]').attr('content') || '';
      let coverHref = '';
      let coverType = '';

      if (coverId) {
        const coverItem = $opf(`manifest item[id="${coverId}"]`).first();
        coverHref = coverItem.attr('href') || '';
        coverType = coverItem.attr('media-type') || '';
      }

      // EPub3: item[properties~="cover-image"]
      if (!coverHref) {
        const coverItem = $opf('manifest item')
          .filter((_, el) => {
            const props = $opf(el).attr('properties') || '';
            return props.split(/\s+/).includes('cover-image');
          })
          .first();
        coverHref = coverItem.attr('href') || coverHref;
        coverType = coverItem.attr('media-type') || coverType;
      }

      // Heuristic fallback: first image item whose id or href suggests cover
      if (!coverHref) {
        const items = $opf('manifest item').toArray();
        const match = items.find(el => {
          const mt = $opf(el).attr('media-type') || '';
          const id = $opf(el).attr('id') || '';
          const href = $opf(el).attr('href') || '';
          return /^image\//.test(mt) && (/cover/i.test(id) || /cover/i.test(href));
        });
        if (match) {
          coverHref = $opf(match).attr('href') || '';
          coverType = $opf(match).attr('media-type') || '';
        }
      }

      if (!coverHref) return null;
      const opfDir = path.posix.dirname(rootfilePath.replace(/\\/g, '/'));
      const entryPath = opfDir ? `${opfDir}/${coverHref}` : coverHref;
      const entry = entries.find((e: any) => e.entryName === entryPath);
      if (!entry) return null;
      const buf = entry.getData();
      const mime = coverType || this.inferMime(coverHref);
      if (!mime) return null;
      const base64 = buf.toString('base64');
      return `data:${mime};base64,${base64}`;
    } catch {
      return null;
    }
  }

  private inferMime(href: string): string | '' {
    const lower = href.toLowerCase();
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    if (lower.endsWith('.gif')) return 'image/gif';
    return '';
  }
}
