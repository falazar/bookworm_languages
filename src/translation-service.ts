import { exec } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class TranslationService {
  private baseUrl = 'https://translate.google.com';
  private debugMode = false; // Set to false to enable real translation
  private debugFlag = true; // Set to false to process all chapters
  private execAsync = promisify(exec);
  private cacheDir = path.join(__dirname, '../data/cache');
  private cacheMap = new Map<string, string>(); // In-memory cache

  constructor() {
    // Initialize cache directory
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    this.loadCache();
  }

  /**
   * Translates an EPUB book file to the target language
   * @param filename - The name of the EPUB file in the uploads directory
   * @param targetLang - Target language code (e.g., 'fr', 'es', 'de')
   * @param sourceLang - Source language code or 'auto' for auto-detection
   * @returns Promise<string> - The translated text content
   */
  async translateBook(filename: string, targetLang: string, sourceLang: string = 'auto'): Promise<string> {
    const startTime = new Date();
    console.log(`\n🚀 TRANSLATION STARTED: ${startTime.toISOString()}`);
    console.log(`📁 Filename: ${filename}`);
    console.log(`🌍 Target Language: ${targetLang}`);
    console.log(`🌍 Source Language: ${sourceLang}`);

    try {
      const tmpDir = path.join(__dirname, '../data/tmp'); // unused?
      // const oldEpubDir = path.join(__dirname, '../data/old_epub');

      // Remove directories if they exist
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
      // if (fs.existsSync(oldEpubDir)) {
      //   fs.rmSync(oldEpubDir, { recursive: true, force: true });
      // }

      // Create directories
      fs.mkdirSync(tmpDir, { recursive: true });
      // fs.mkdirSync(oldEpubDir, { recursive: true });

      // Open and read the EPUB file
      const filePath = path.join(__dirname, '../data/uploads', filename);
      console.log('📖 Opening EPUB file:', filePath);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.error('❌ EPUB file not found:', filePath);
        throw new Error(`EPUB file not found: ${filePath}`);
      }
      console.log('✅ EPUB file exists and is accessible');

      // Extract EPUB first, then process files manually
      console.log('🔄 Starting EPUB translation...');
      const newEPUBPath = await this.translateEPUB(filename, targetLang, sourceLang);
      console.log('✅ EPUB translation completed');

      const endTime = new Date();
      const duration = (endTime.getTime() - startTime.getTime()) / 1000 / 60; // minutes
      console.log(`\n✅ TRANSLATION COMPLETED: ${endTime.toISOString()}`);
      console.log(`⏱️  TOTAL DURATION: ${duration.toFixed(2)} minutes`);

      return `Translation complete! New EPUB created: ${path.basename(newEPUBPath)}`;
    } catch (error) {
      // console.error('Error opening EPUB file:', error);
      throw new Error(`Failed to open EPUB file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Translates a single file in place
   * @param filePath - Path to the file to translate
   * @param targetLang - Target language code
   * @param sourceLang - Source language code
   */
  private async translateFile(
    filePath: string,
    targetLang: string,
    sourceLang: string
  ): Promise<{ skip?: boolean; translated?: boolean }> {
    try {
      const originalContent = fs.readFileSync(filePath, 'utf8');

      // See if new file has translated text in it or not yet, if any then skip...
      const translatedContentCheck = fs.readFileSync(filePath, 'utf8');
      if (translatedContentCheck.includes('<p class="translated">')) {
        console.log(`--Skipping file ${path.basename(filePath)} as it has already been translated`);
        return { skip: true };
      }
      const DEBUG_TESTING = false;

      // TODO: DIVIDE THIS METHOD UP A LITTLE BIT?
      // TODO parse out header and read also.
      // STEP 1: Parse file line by line and chunk for translation
      const lines = originalContent.split('\n');
      let translatedContent = '';
      let i = 0;
      while (i < lines.length) {
        if (i > 2222) {
          console.log(`DEBUG: Breaking out of loop at line ${i}`);
          break;
        }

        // STEP 2: Build chunk until we hit >= 5000 chars
        let chunk = '';
        let chunkStart = i;
        while (i < lines.length) {
          const line = lines[i];
          const lineWithNewline = line + '\n'; // may not need this?

          // Check if adding this line would exceed safe URL limit
          if (chunk.length + lineWithNewline.length > 4700) {
            // Safe URL limit
            break; // Don't add this line, keep it for next chunk
          }

          chunk += lineWithNewline;
          i++;
        }

        // STEP 3: Translate the chunk.
        console.log(
          // `\n#######################################################` +
          `\nSTART TRANSLATING CHUNK #${chunkStart + 1}-${i} of ${lines.length}`
        );
        const translatedChunk = await this.translateChunk(chunk, targetLang, sourceLang);
        // Append all text to our content.
        translatedContent += translatedChunk;

        const chars = chunk.length;
        console.log(
          `\x1b[35m  Processed chunk lines ${chunkStart + 1}-${i}/${lines.length} with ${chars} characters\x1b[0m`
        );
        // console.log(`\x1b[35mDEBUG: Translated chunk:\x1b[0m`, translatedChunk);

        if (DEBUG_TESTING) {
          console.log('DEBUG TESTING: Breaking after first chunk');
          break; // Break after first chunk for testing
        }
      } // while i
      // Part 3: Close body and html tags.
      translatedContent += '</body>\n</html>';
      //

      // Write translated content back to the same file
      if (DEBUG_TESTING) {
        // Rename file slightly so it doesnt overwrite us.
        filePath = filePath.replace('.html', '_FR.html');
      }
      fs.writeFileSync(filePath, translatedContent);
      // console.log(`DEBUG: Translated and updated: ${filePath}`);
      console.log(`Translated and updated: ${path.basename(filePath)}`);

      // Add 120 second delay after each file processing
      if (!DEBUG_TESTING) {
        console.log('\n⏱️ Waiting 120 seconds before processing next file...');
        await new Promise(resolve => setTimeout(resolve, 120000)); // was 160.
        console.log('✅ Delay complete, continuing to the next file...\n');
      }
    } catch (error) {
      // console.error(`Error translating file ${filePath}:`, error);
      console.error(`Error translating file ${filePath}`);
      // rethrow the error
      throw error;
    }

    return { translated: true };
  }

  /**
   * Translates a chunk of HTML content (multiple lines)
   * @param chunk - The HTML chunk to translate
   * @param targetLang - Target language code
   * @param sourceLang - Source language code
   * @returns Promise<string> - The translated chunk
   */
  private async translateChunk(chunk: string, targetLang: string, sourceLang: string): Promise<string> {
    // First, translate only the text content
    // Extract only text content from the chunk (remove HTML tags)
    const debugFlag = true;

    // Use Cheerio to parse partial page.
    const $ = cheerio.load(chunk, { xmlMode: true });
    const header = $('head').html() || '';
    // const paragraphs = $('body p')
    const paragraphs = $('p')
      .map((_, el) => $(el).text().trim())
      .get();
    // console.log('DEBUG Header:', header);
    console.log('  Paragraphs length:', paragraphs.length);
    // console.log('DEBUG Paragraphs:', paragraphs);

    const textOnly = paragraphs.join('\n\n'); // Join paragraphs with double newlines

    // For testing we can turn on or off cache.
    let useCache = true;
    if (debugFlag) {
      // useCache = true; // flip depending on your test need.
      // console.log('\n\x1b[33mDEBUG: Skipping cache for testing purposes\x1b[0m');
    }

    let translatedChunk = '';
    const originalLines = textOnly.split('\n\n');
    if (originalLines.length <= 1) {
      console.log('WARN: Only one or zero original lines found, skipping translation.');
    } else {
      translatedChunk = await this.translateText(textOnly, targetLang, sourceLang, useCache);
    }

    // Then split both original and translated into lines and intersperse them
    const translatedLines = translatedChunk.split('\n\n');

    let returnText = '';

    // Show length of both original and translated lines in purple
    // console.log(`\x1b[35m\nDEBUG: ORIGINAL LINES: ${originalLines.length}\x1b[0m`);
    // console.log(`\x1b[35mDEBUG: TRANSLATED LINES: ${translatedLines.length}\x1b[0m`);
    if (originalLines.length !== translatedLines.length) {
      // console.log('WARN: Line count mismatch between original and translated.');
    }
    // console.log(`\x1b[35m\nDEBUG: STARTING TO MERGE ORIGINAL AND TRANSLATED LINES...\x1b[0m`);
    // console.log(`-------------------------------------------------------`);
    // console.log('\x1b[35moriginalLines:', originalLines);
    // console.log('\x1b[35mtranslatedLines:', translatedLines);

    // PART 1: Write header back on top.
    if (header) {
      returnText +=
        "<?xml version='1.0' encoding='utf-8'?>\n" +
        '<html xmlns="http://www.w3.org/1999/xhtml">\n' +
        '<head>\n' +
        header +
        '\n</head>\n' +
        '<body class="calibre">\n';
    }

    // PART 2: Fill in body p tags.
    let originalIndex = 0;
    let translatedIndex = 0;
    while (originalIndex < 1000 && (originalIndex < originalLines.length || translatedIndex < translatedLines.length)) {
      const originalLine = originalIndex < originalLines.length ? originalLines[originalIndex] : '';
      const translatedLine = translatedIndex < translatedLines.length ? translatedLines[translatedIndex].trim() : '';

      returnText += '<p class="translated">' + translatedLine + '</p>\n';

      const italicLine = '<p style="font-style: italic;">';
      returnText += italicLine + originalLine + '</p>\n\n';

      translatedIndex++; // Advance translated counter
      originalIndex++; // Advance even if empty
    } // while loop

    return returnText;
  }

  /**
   * Translates text using Google Translate via Puppeteer
   * @param text - The text to translate
   * @param targetLang - Target language code (e.g., 'fr', 'es', 'de')
   * @param sourceLang - Source language code or 'auto' for auto-detection
   * @returns Promise<string> - The translated text
   */
  async translateText(
    text: string,
    targetLang: string,
    sourceLang: string = 'auto',
    useCache: boolean = true
  ): Promise<string> {
    const debugLogs = true;

    // Debug mode - return placeholder text
    if (this.debugMode) {
      console.log('DEBUG MODE: Returning placeholder translation');
      return 'FAKE TRANSLATED TEXT';
    }

    // Check cache first
    const cacheKey = this.getCacheKey(text, targetLang, sourceLang);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      console.log('  ✅ Using cached translation');
      return cached;
    }

    console.log('  🔄 Fetching new translation...');

    let browser;
    try {
      // URL encode the text
      text = text.replace(/”/g, '"');
      // console.log('\nDEBUG: BEFORE ENCODING TEXT:', text);
      // Replace smart quotes and special chars with ASCII
      text = text.replace('\u2019', "'");
      text = text.replace('\u2018', "'"); // ' → '
      text = text.replace('\u201c', '"'); // " → "
      text = text.replace('\u201d', '"'); // " → "
      text = text.replace('\u2014', '--'); // — → --
      text = text.replace('\u2013', '-'); // – → -
      text = text.replace('“', ' "'); // " → "
      text = text.replace('”', '" '); // " → "
      text = text.replace('—', '--'); // — → --
      // do smart single quote:
      text = text.replace('’', "'");

      // Check for an over limit size maybe here?
      if (text.length > 5000) {
        console.log('DEBUG: Text length:', text.length);
        console.log('ERROR: Text is too long to translate, debug test shortening.');
        // chop it for testing...
        text = text.substring(0, 5000);
        // console.log('Chopped text to:', text);
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
      // console.log('\nLoading Google Translate page...');
      await page.goto(url, {
        waitUntil: 'networkidle2',
        // timeout: 10000,
        timeout: 100000,
      });

      // Try to find the translation result
      const translation = await page.evaluate(this.extractTranslationFromHTML);

      // Wait for translation to appear
      //   console.log('Waiting for translation to load...');
      // Delay here for page load and also not to hit translation server too fast!
      // await new Promise(resolve => setTimeout(resolve, 3000)); // Was 3 second lowered to 1.
      // await new Promise(resolve => setTimeout(resolve, 6000)); // Was 6 second raised from 3.
      // failed on first part of chapter two, increasing from 6 to 10.
      // await new Promise(resolve => setTimeout(resolve, 10000)); // Was 10 second raised from 6. 2 sections done on ch2 then failed.
      // await new Promise(resolve => setTimeout(resolve, 20000)); // Was 10 raised to 20 4 sections in ch2 then failed.
      // It seems to be showing spanish version after this limit.
      await new Promise(resolve => setTimeout(resolve, 35000)); // Was 20 raised to 30 ?

      // 1 seemed to work ok. not working now
      // 2 was working ok for alot, back up to 3 to test larger.
      // 400 was too fast or the ones before it were, hmmm
      //   await new Promise(resolve => setTimeout(resolve, 3000));

      // Save the page content for debugging
      const pageContent = await page.content();
      const tempFilePath = path.join(__dirname, '../temp_translated_full.html');
      fs.writeFileSync(tempFilePath, pageContent);
      // console.log(`Debug: Saved full Google Translate page content to ${tempFilePath}`);

      if (!translation) {
        throw new Error('Could not extract translation from response - check temp_translated.html for debugging');
      }

      // console.log('\nDEBUG: BEFORE HTML DECODING:', translation);

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
        .replace(/&amp;/g, '&') // Must be last to avoid double-decoding
        .replace(/&[#\w]+;/g, ''); // Remove any remaining HTML entities

      // Fix common translation issues
      decodedTranslation = decodedTranslation
        .replace(/epub: type/g, 'epub:type')
        .replace(/aria-label = /g, 'aria-label=')
        .replace(/id = /g, 'id=')
        .replace(/role = /g, 'role=');

      // add turquiose color for debug text
      // console.log('\n\x1b[36mDEBUG: TRANSLATED TEXT AFTER HTML DECODING: ', decodedTranslation, '\x1b[0m');

      // Save to cache before returning.
      this.saveToCache(cacheKey, decodedTranslation);
      // console.log('💾 Translation saved to cache');

      return decodedTranslation;
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
          // console.log('DEBUG: Found text match:', textMatch[1]);
          return textMatch[1];
        }
      }
    }

    return null;
  }

  /**
   * Repackages translated chapters back into an EPUB file
   * @param originalFilename - The original EPUB filename
   * @param targetLang - Target language code
   * @param sourceLang - Source language code
   * @returns Promise<string> - Path to the new EPUB file
   */
  // this appears to translate and stuff as well, maybe break up this method?
  async translateEPUB(originalFilename: string, targetLang: string, sourceLang: string = 'auto'): Promise<string> {
    console.log(`📁 Original filename: ${originalFilename}`);

    try {
      const originalPath = path.join(__dirname, '../data/uploads', originalFilename);
      const baseName = path.parse(originalFilename).name;
      // Remove any trailing language suffixes like _fr, _en, _de, including repeated ones
      const cleanBaseName = baseName.replace(/(_[A-Za-z]{2,3}(?:-[A-Za-z]{2,3})?)+$/g, '');
      const outputFilename = `${cleanBaseName}_${targetLang}.epub`;
      const outputPath = path.join(__dirname, '../data/uploads', outputFilename);

      // STEP 1: Setup dirs.
      console.log('\n📝 STEP 1: Setting up directories...');
      // Create temp directory for extraction
      const oldEpubDir = path.join(__dirname, '../data/old_epub');
      if (fs.existsSync(oldEpubDir)) {
        console.log('📁 Old EPUB directory already exists, skipping creation and continuing...');
      } else {
        fs.mkdirSync(oldEpubDir, { recursive: true });
        console.log('📁 Created new EPUB directory for extraction');

        // STEP 2: Extract EPUB using PowerShell
        console.log(`\n📦 STEP 2: Extracting EPUB... ${new Date().toISOString()}`);
        await this.extractEpubWithPowerShell(originalPath, oldEpubDir);
      }

      // STEP 3: Detect EPUB content directory structure.
      console.log('\n📝 STEP 3: Checking if the extracted EPUB getting directory...');
      const contentDirectory = this.detectEpubContentDirectory(oldEpubDir);
      console.log(`📂 Final EPUB content directory: ${contentDirectory}`);

      // STEP 4: Find all files in the extracted EPUB.
      console.log('\n📝 STEP 4: Finding all files in the extracted EPUB...');
      const filesToTranslate = this.getFilesToTranslate(contentDirectory);
      console.log(`📚 Found ${filesToTranslate.length} files to translate.`);
      // console.log(`📚 Files to translate:`, filesToTranslate);

      // Step 5: Begin translating each file from where we left off using cache.
      let erroredOut = '';
      console.log('\n📝 STEP 5: Begin Translating each file...');
      try {
        for (let i = 0; i < filesToTranslate.length; i++) {
          const file = filesToTranslate[i];
          const filePath = path.join(contentDirectory, file);

          console.log(
            `Processing file ${i + 1}/${filesToTranslate.length}: ${file} - ${new Date().toLocaleTimeString([], { hour12: false })}`
          );
          const skipOrNew = await this.translateFile(filePath, targetLang, sourceLang);
        }
      } catch (error) {
        // Catch error here and continue, so it will make our partial book for testing.
        // This is an expected error when tralslate service on other side gets too many requests. Keep retrying.
        // console.error('Error during file translation loop:', error);
        erroredOut = `Error during file translation: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }

      // Step 6: Create EPUB with proper structure using 7zip.
      console.log('\n📝 STEP 6: Creating new EPUB with proper structure using 7zip...');
      try {
        await this.execAsync(`"C:\\Program Files\\7-Zip\\7z.exe" a -tzip "${outputPath}" "${oldEpubDir}\\*" -mx=0`);
        console.log('  Created EPUB using 7zip');
      } catch (error) {
        console.error('  7zip failed to create EPUB:', error);
        throw new Error(`Failed to create EPUB with 7zip: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      console.log(`\x1b[32m  EPUB repackaged successfully: ${outputPath}\x1b[0m\n\n`);

      // Rethrow error later after epub is rebuilt.
      if (erroredOut) {
        throw new Error(erroredOut);
      }

      // Can we do this if no erroredOut
      // CLean up Remove old_epub dir at the end.
      // if (fs.existsSync(oldEpubDir)) {
      //   fs.rmSync(oldEpubDir, { recursive: true, force: true });
      // cleanup cache dir todo
      // }

      console.log(`COMPLETED SUCCESSFULLY!\n\n\n`);
      return outputPath;
    } catch (error) {
      // console.error('Error in translateEPUB method:', error);
      throw new Error(`Failed to translate full EPUB: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Detects the EPUB content directory structure
   * @param oldEpubDir - Directory where the EPUB was extracted
   * @returns string - Path to the content directory
   */
  private detectEpubContentDirectory(oldEpubDir: string): string {
    // Determine the correct content directory based on EPUB structure
    let contentDirectory: string;

    // Check one: OEBPS/xhtml dir stores them.
    const oebpsPath = path.join(oldEpubDir, 'OEBPS');
    if (fs.existsSync(oebpsPath)) {
      // Standard EPUB structure
      let xhtmlPath = path.join(oebpsPath, 'xhtml');
      if (fs.existsSync(xhtmlPath)) {
        contentDirectory = xhtmlPath;
        console.log(`📂 Using standard EPUB structure: ${contentDirectory}`);
        return contentDirectory;
      }
      // Secondary dir check.
      xhtmlPath = path.join(oebpsPath, 'Text');
      if (fs.existsSync(xhtmlPath)) {
        contentDirectory = xhtmlPath;
        console.log(`📂 Using standard Text EPUB structure: ${contentDirectory}`);
        return contentDirectory;
      }

      // OEBPS exists but no xhtml subdirectory, check OEBPS directly
      contentDirectory = oebpsPath;
      console.log(`📂 Using OEBPS directory directly: ${contentDirectory}`);
      return contentDirectory;
    }

    // Check 2: text dir stores them.
    const textPath = path.join(oldEpubDir, 'text');
    console.log(`🔍 Checking for text directory in EPUB... textPath= ${textPath}`);
    if (fs.existsSync(textPath)) {
      // Standard EPUB structure
      contentDirectory = textPath;
      console.log(`📂 Using text directory directly: ${contentDirectory}`);

      return contentDirectory;
    }

    // Alternative EPUB structure - look for HTML files in root or subdirectories
    console.log('🔍 Using alternative EPUB structure...');

    const detectedDir = this.findContentDir(oldEpubDir);
    if (detectedDir) {
      contentDirectory = detectedDir;
      console.log(`📂 Using alternative EPUB structure: ${contentDirectory}`);
    } else {
      throw new Error('No HTML/XHTML files found in EPUB');
    }

    return contentDirectory;
  }

  // Returns the list of chapter files to translate from a content directory
  private getFilesToTranslate(contentDirectory: string): string[] {
    // Read all candidate files
    let filesToTranslate = fs.readdirSync(contentDirectory).filter(f => f.endsWith('.xhtml') || f.endsWith('.html'));

    // Skip known non-content file
    if (filesToTranslate.includes('part0000_split_000.html')) {
      filesToTranslate = filesToTranslate.filter(f => f !== 'part0000_split_000.html');
    }

    // If a specific test file is requested, narrow to it
    const testFile = ''; // set to specific file name for testing, or leave empty for all files
    if (testFile) {
      if (filesToTranslate.includes(testFile)) {
        console.log(`\x1b[35mTEST MODE: Only processing file: ${testFile}\x1b[0m`);
        filesToTranslate = [testFile];
      } else {
        console.log(`Warning: testFile '${testFile}' not found, processing all files`);
      }
    }

    if (filesToTranslate.length === 0) {
      console.error('❌ No files to translate found');
      throw new Error('No files to translate found');
    }

    return filesToTranslate;
  }

  /**
   * Extracts EPUB file using PowerShell
   * @param originalPath - Path to the original EPUB file
   * @param oldEpubDir - Directory to extract the EPUB to
   */
  private async extractEpubWithPowerShell(originalPath: string, oldEpubDir: string): Promise<void> {
    // Copy EPUB to temp location and rename to .zip for PowerShell
    const tempZipPath = path.join(__dirname, '../data/tmp', 'temp.zip');
    console.log(`📋 Copying EPUB to temp zip: ${tempZipPath}`);
    fs.copyFileSync(originalPath, tempZipPath);
    console.log('✅ EPUB copied to temp zip successfully');

    // Check if temp zip was created successfully
    if (!fs.existsSync(tempZipPath)) {
      throw new Error(`Failed to create temp zip file: ${tempZipPath}`);
    }
    const zipStats = fs.statSync(tempZipPath);
    console.log(`📊 Temp zip file size: ${zipStats.size} bytes`);

    const powershellCommand = `powershell -Command "Expand-Archive -Path '${tempZipPath}' -DestinationPath '${oldEpubDir}' -Force"`;
    console.log(`🔧 PowerShell command: ${powershellCommand}`);

    try {
      console.log('⚡ Executing PowerShell extraction...');
      console.log('⏱️ Starting extraction timer...');
      const startTime = Date.now();

      await this.execAsync(powershellCommand);
      const extractionTime = Date.now() - startTime;
      console.log(`✅ EPUB extraction completed successfully in ${extractionTime}ms`);
    } catch (error) {
      console.error('❌ PowerShell extraction failed:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        code: (error as { code?: string })?.code,
        stdout: (error as { stdout?: string })?.stdout,
        stderr: (error as { stderr?: string })?.stderr,
      });
      throw new Error(`Failed to extract EPUB: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Cache management methods
   */
  private getCacheKey(text: string, targetLang: string, sourceLang: string): string {
    // Create a hash of the text + language settings
    const hash = crypto
      .createHash('md5')
      .update(text + targetLang + sourceLang)
      .digest('hex');
    return hash;
  }

  private getFromCache(cacheKey: string): string | null {
    // Check in-memory cache first
    if (this.cacheMap.has(cacheKey)) {
      return this.cacheMap.get(cacheKey)!;
    }

    // Check file cache
    const cacheFile = path.join(this.cacheDir, `${cacheKey}.txt`);
    if (fs.existsSync(cacheFile)) {
      const cached = fs.readFileSync(cacheFile, 'utf8');
      // Store in memory for faster access
      this.cacheMap.set(cacheKey, cached);
      return cached;
    }

    return null;
  }

  private saveToCache(cacheKey: string, translation: string): void {
    // Save to in-memory cache
    this.cacheMap.set(cacheKey, translation);

    // Save to file cache
    const cacheFile = path.join(this.cacheDir, `${cacheKey}.txt`);
    // Ensure cache directory exists (defensive check in case constructor didn't run)
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    fs.writeFileSync(cacheFile, translation, 'utf8');
  }

  private loadCache(): void {
    // Load all cache files into memory
    try {
      const files = fs.readdirSync(this.cacheDir);
      let loaded = 0;
      for (const file of files) {
        if (file.endsWith('.txt')) {
          const cacheKey = path.basename(file, '.txt');
          const content = fs.readFileSync(path.join(this.cacheDir, file), 'utf8');
          this.cacheMap.set(cacheKey, content);
          loaded++;
        }
      }
      if (loaded > 0) {
        console.log(`📚 Loaded ${loaded} cached translations from disk`);
      }
    } catch {
      console.log('No existing cache found, starting fresh');
    }
  }
  /**
   * Recursively finds the first directory containing HTML/XHTML/HTM files
   * @param dir - Directory to search
   * @returns string | null - Path to directory containing HTML files, or null if not found
   */
  private findContentDir(dir: string): string | null {
    try {
      const items = fs.readdirSync(dir);
      const htmlFiles = items.filter(f => f.endsWith('.xhtml') || f.endsWith('.html') || f.endsWith('.htm'));

      if (htmlFiles.length > 0) {
        console.log(`📚 Found HTML files in: ${dir}`);
        return dir;
      }

      // Check subdirectories
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          console.log(`🔍 Searching subdirectory: ${fullPath}`);
          const subDirResult = this.findContentDir(fullPath); // Recursion fun!.
          if (subDirResult) return subDirResult;
        }
      }
    } catch (error) {
      console.warn(`⚠️ Could not read directory ${dir}:`, error);
    }
    return null;
  }
}
