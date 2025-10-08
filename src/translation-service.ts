import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

export class TranslationService {
  private baseUrl = 'https://translate.google.com';
  private debugMode = false; // Set to false to enable real translation
  private debugFlag = true; // Set to false to process all chapters
  private execAsync = promisify(exec);

  /**
   * Translates an EPUB book file to the target language
   * @param filename - The name of the EPUB file in the uploads directory
   * @param targetLang - Target language code (e.g., 'fr', 'es', 'de')
   * @param sourceLang - Source language code or 'auto' for auto-detection
   * @returns Promise<string> - The translated text content
   */
  async translateBook(
    filename: string,
    targetLang: string,
    sourceLang: string = 'auto'
  ): Promise<string> {
    const startTime = new Date();
    console.log(`\n🚀 TRANSLATION STARTED: ${startTime.toISOString()}`);

    try {
      // Clean up temp directory
      fs.rmSync(path.join(__dirname, '../tmp'), { recursive: true, force: true });
      fs.rmSync(path.join(__dirname, '../old_epub'), { recursive: true, force: true });
      fs.mkdirSync(path.join(__dirname, '../tmp'));
      fs.mkdirSync(path.join(__dirname, '../old_epub'));

      // Open and read the EPUB file
      const filePath = path.join(__dirname, '../uploads', filename);
      console.log('Opening EPUB file:', filePath);

      // Extract EPUB first, then process files manually
      const newEPUBPath = await this.repackageEPUB(filename, targetLang, sourceLang);

      const endTime = new Date();
      const duration = (endTime.getTime() - startTime.getTime()) / 1000 / 60; // minutes
      console.log(`\n✅ TRANSLATION COMPLETED: ${endTime.toISOString()}`);
      console.log(`⏱️  TOTAL DURATION: ${duration.toFixed(2)} minutes`);

      return `Translation complete! New EPUB created: ${path.basename(newEPUBPath)}`;
    } catch (error) {
      console.error('Error opening EPUB file:', error);
      throw new Error(
        `Failed to open EPUB file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
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
  ): Promise<void> {
    try {
      const originalContent = fs.readFileSync(filePath, 'utf8');

      // Parse file line by line and chunk for translation
      const lines = originalContent.split('\n');
      let translatedContent = '';
      let i = 0;

      while (i < lines.length) {
        if (i > 2222) {
          console.log(`DEBUG: Breaking out of loop at line ${i}`);
          break;
        }

        // Build chunk until we hit >= 5000 chars
        let chunk = '';
        let chunkStart = i;

        while (i < lines.length) {
          const line = lines[i];
          const lineWithNewline = line + '\n';

          // Check if adding this line would exceed safe URL limit
          if (chunk.length + lineWithNewline.length > 4700) {
            // Safe URL limit
            break; // Don't add this line, keep it for next chunk
          }

          chunk += lineWithNewline;
          i++;
        }

        // Translate the chunk
        console.log(
          '\n#######################################################\n' +
            'DEBUG: START TRANSLATING CHUNK #',
          chunkStart + 1,
          '-',
          i,
          'of',
          lines.length
        );
        const translatedChunk = await this.translateChunk(chunk, targetLang, sourceLang);
        translatedContent += translatedChunk;
        const chars = chunk.length;
        console.log(
          `\nProcessed chunk ${chunkStart + 1}-${i}/${lines.length} with ${chars} characters`
        );
        // console.log(`DEBUG: Translated chunk:`, translatedChunk);
      }

      // Write translated content back to the same file
      fs.writeFileSync(filePath, translatedContent);
      console.log(`Translated and updated: ${path.basename(filePath)}`);
    } catch (error) {
      console.error(`Error translating file ${filePath}:`, error);
    }
  }

  /**
   * Translates a chunk of HTML content (multiple lines)
   * @param chunk - The HTML chunk to translate
   * @param targetLang - Target language code
   * @param sourceLang - Source language code
   * @returns Promise<string> - The translated chunk
   */
  private async translateChunk(
    chunk: string,
    targetLang: string,
    sourceLang: string
  ): Promise<string> {
    // First, translate only the text content
    // Extract only text content from the chunk (remove HTML tags)
    const textOnly = chunk.replace(/<[^>]*>/g, '').trim();
    const translatedChunk = await this.translateText(textOnly, targetLang, sourceLang);

    // Then split both original and translated into lines and intersperse them
    const originalLines = chunk.split('\n');
    const translatedLines = translatedChunk.split('\n');
    let result = '';

    // show length of both original and translated lines
    // console.log('\nDEBUG: ORIGINAL LINES:', originalLines.length);
    // console.log('\nDEBUG: TRANSLATED LINES:', translatedLines.length);

    // Track counters separately for original and translated lines
    let originalIndex = 0;
    let translatedIndex = 0;

    while (
      originalIndex < 1000 &&
      (originalIndex < originalLines.length || translatedIndex < translatedLines.length)
    ) {
      const originalLine = originalIndex < originalLines.length ? originalLines[originalIndex] : '';
      const translatedLine =
        translatedIndex < translatedLines.length ? translatedLines[translatedIndex].trim() : '';

      // console.log(`\nDEBUG-${originalIndex}: ORIGINAL LINE=${originalLine}`);
      // console.log(`\nDEBUG-${translatedIndex}: TRANSLATED LINE=${translatedLine}`);

      // Check if original line has actual text content (not just HTML tags)
      const originalHasText = originalLine && originalLine.replace(/<[^>]*>/g, '').trim();

      // Skip HTML declaration and head tags - don't advance counters
      if (originalLine.includes('<html xmlns') || originalLine.includes('<head')) {
        result += originalLine + '\n';
        originalIndex++; // Advance original counter
        continue; // Skip the rest of this iteration
      }

      // Only add translated line if original contains <p class AND has text content
      if (originalLine.includes('<p class=') && originalHasText && translatedLine) {
        result += '<p class="translated">' + translatedLine + '</p>\n';
      } else if (translatedLine == '' || translatedLine == null || translatedLine.length <= 5) {
        // console.log('\nDEBUG: TRANSLATED LINE IS EMPTY');
      }

      // Always add original line, with italic styling for p class lines
      if (originalLine) {
        if (originalLine.includes('<p class=')) {
          // Add inline italic style to the p tag
          const italicLine = originalLine.replace(
            '<p class="',
            '<p style="font-style: italic;" class="'
          );
          result += italicLine.trim() + '\n';
        } else {
          result += originalLine + '\n';
        }
      }

      translatedIndex++; // Advance translated counter
      originalIndex++; // Advance even if empty
    } // while loop

    return result;
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
    sourceLang: string = 'auto'
  ): Promise<string> {
    // Debug mode - return placeholder text
    if (this.debugMode) {
      // console.log('DEBUG MODE: Returning placeholder translation');
      return 'FAKE TRANSLATED TEXT';
    }

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

      const encodedText = encodeURIComponent(text);
      //   console.log('\nDEBUG: AFTER ENCODING TEXT:', encodedText);

      // Build the translation URL
      const url = `${this.baseUrl}/?sl=${sourceLang}&tl=${targetLang}&text=${encodedText}&op=translate`;
      // console.log(" DEBUG url", url);

      // Launch Puppeteer browser
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
        ],
      });
      const page = await browser.newPage();
      // Set user agent and viewport
      await page.setExtraHTTPHeaders({
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      await page.setViewport({ width: 1366, height: 768 });

      // Navigate to Google Translate
      //   console.log('Loading Google Translate page...');
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 10000,
      });

      // Try to find the translation result
      const translation = await page.evaluate(this.extractTranslationFromHTML);

      // Wait for translation to appear
      //   console.log('Waiting for translation to load...');
      // Delay here for page load and also not to hit translation server too fast!
      await new Promise(resolve => setTimeout(resolve, 3000)); // Was 3 second lowered to 1.
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
        throw new Error(
          'Could not extract translation from response - check temp_translated.html for debugging'
        );
      }

      //   console.log('\nDEBUG: BEFORE HTML DECODING:', translation);

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

      // console.log('\nDEBUG: AFTER HTML ENCODING:', decodedTranslation);

      return decodedTranslation;
    } catch (error) {
      console.error('Translation error:', error);
      throw new Error(
        `Translation failed: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
      );
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  // Extract translation from HTML content from googles page.
  private extractTranslationFromHTML(): string | null {
    // First try to extract from data-text attribute using regex
    const htmlContent = document.documentElement.outerHTML;

    // Look for non-English translations with better quote handling
    const dataTextMatches = htmlContent.match(
      /data-language-name="([^"]+)"[^>]*data-text="([^"]*(?:\\.[^"]*)*)"/g
    );

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

  /**
   * Repackages translated chapters back into an EPUB file
   * @param originalFilename - The original EPUB filename
   * @param targetLang - Target language code
   * @param sourceLang - Source language code
   * @returns Promise<string> - Path to the new EPUB file
   */
  async repackageEPUB(
    originalFilename: string,
    targetLang: string,
    sourceLang: string = 'auto'
  ): Promise<string> {
    try {
      const originalPath = path.join(__dirname, '../uploads', originalFilename);
      const baseName = path.parse(originalFilename).name;
      const outputFilename = `${baseName}_${targetLang}.epub`;
      const outputPath = path.join(__dirname, '../uploads', outputFilename);

      // STEP 1: Setup dirs.
      // Remove old EPUB if exists
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      // Create temp directory for extraction
      const oldEpubDir = path.join(__dirname, '../old_epub');
      if (fs.existsSync(oldEpubDir)) {
        fs.rmSync(oldEpubDir, { recursive: true, force: true });
      }
      fs.mkdirSync(oldEpubDir);

      // STEP 2: Extract using PowerShell (now that it's a .zip file)
      console.log(`\n\nSTEP 2: Extracting EPUB... ${new Date().toISOString()}`);
      // Copy EPUB to temp location and rename to .zip for PowerShell
      const tempZipPath = path.join(__dirname, '../tmp', 'temp.zip');
      fs.copyFileSync(originalPath, tempZipPath);
      await this.execAsync(
        `powershell -Command "Expand-Archive -Path '${tempZipPath}' -DestinationPath '${oldEpubDir}' -Force"`
      );

      // STEP 3: Process and translate files directly in the extracted EPUB
      console.log('STEP 3: Processing files directly in extracted EPUB...');
      const newEpubDir = path.join(oldEpubDir, 'OEBPS', 'xhtml');
      let filesToTranslate = fs
        .readdirSync(newEpubDir)
        .filter(f => f.endsWith('.xhtml') || f.endsWith('.html'))
        .filter(f => f.includes('chapter')); // Only translate chapter files

      // DEBUG TESTING - only process one specific file
      const testFile = 'chapter10.xhtml'; // Set to undefined to process all files
      if (testFile) {
        if (filesToTranslate.includes(testFile)) {
          console.log(`TEST MODE: Only processing file: ${testFile}`);
          filesToTranslate = [testFile];
        } else {
          console.log(`Warning: testFile '${testFile}' not found, processing all files`);
        }
      }

      for (let i = 0; i < filesToTranslate.length; i++) {
        const file = filesToTranslate[i];
        const filePath = path.join(newEpubDir, file);

        console.log(
          `Processing file ${i + 1}/${filesToTranslate.length}: ${file} - ${new Date().toISOString()}`
        );
        await this.translateFile(filePath, targetLang, sourceLang);
      }

      // Step 3: Create EPUB with proper structure using 7zip.
      console.log('Step 3: Creating EPUB with proper structure...');
      console.log('Creating EPUB using 7zip...');
      try {
        await this.execAsync(
          `"C:\\Program Files\\7-Zip\\7z.exe" a -tzip "${outputPath}" "${oldEpubDir}\\*" -mx=0`
        );
        console.log('Created EPUB using 7zip');
      } catch (error) {
        console.error('7zip failed to create EPUB:', error);
        throw new Error(
          `Failed to create EPUB with 7zip: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }

      console.log(`EPUB repackaged successfully: ${outputPath}`);
      console.log(`COMPLETED \n\n\n`);
      return outputPath;
    } catch (error) {
      console.error('Error in repackage EPUB method:', error);
      throw new Error(
        `Failed to repackage EPUB: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
