import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { EPub } from 'epub2';
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
  async translateBook(filename: string, targetLang: string, sourceLang: string = 'auto'): Promise<string> {
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
      return `Translation complete! New EPUB created: ${path.basename(newEPUBPath)}`;
    } catch (error) {
      console.error('Error opening EPUB file:', error);
      throw new Error(`Failed to open EPUB file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }


  /**
   * Translates a single file in place
   * @param filePath - Path to the file to translate
   * @param targetLang - Target language code
   * @param sourceLang - Source language code
   */
  private async translateFile(filePath: string, targetLang: string, sourceLang: string): Promise<void> {
    try {
      const originalContent = fs.readFileSync(filePath, 'utf8');
      
      // Parse file line by line
      const lines = originalContent.split('\n');
      let translatedContent = '';
      
      // add index to the lines
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let translatedLine = line;
        
        // Only translate paragraph content, preserve everything else
        if (line.includes('<p class=')) {
          translatedLine = await this.translateLine(line, targetLang, sourceLang);
          console.log(`${i + 1}/${lines.length} Text:`, translatedLine);
        }
        
        translatedContent += translatedLine;
      }
      
      // Write translated content back to the same file
      fs.writeFileSync(filePath, translatedContent);
      console.log(`Translated and updated: ${path.basename(filePath)}`);
      
    } catch (error) {
      console.error(`Error translating file ${filePath}:`, error);
    }
  }

  /**
   * Translates a single line of HTML content
   * @param line - The HTML line to translate
   * @param targetLang - Target language code
   * @param sourceLang - Source language code
   * @returns Promise<string> - The translated line(s)
   */
  private async translateLine(line: string, targetLang: string, sourceLang: string): Promise<string> {
    if (!line.trim()) {
      return line + '\n';
    }

    if (!line.includes('<p class=')) {
      // Non-paragraph lines: keep HTML unchanged
      return line + '\n';
    }
    
    // Extract text content from paragraph
    const textContent = line.replace(/<[^>]*>/g, '').trim();

    // Extract the opening p tag with all attributes
    const pTagMatch = line.match(/<p[^>]*>/);
    const pTag = pTagMatch ? pTagMatch[0] : '<p>';

    // Translate this text
    const translatedText = await this.translateText(textContent, targetLang, sourceLang);
    // TODO we might could optimize about 10 paragraphs before we got close to the limit, hmmmm 

    // Create translated line with same p tag
    const translatedLine = pTag + '<em style="background-color:rgb(254, 254, 127);">' + translatedText + '</em>' + '</p>';
    const englishLine = pTag + textContent + '</p>';
    
    return translatedLine + '\n' + englishLine + '\n';
  }

  /**
   * Translates text using Google Translate via Puppeteer
   * @param text - The text to translate
   * @param targetLang - Target language code (e.g., 'fr', 'es', 'de')
   * @param sourceLang - Source language code or 'auto' for auto-detection
   * @returns Promise<string> - The translated text
   */
  async translateText(text: string, targetLang: string, sourceLang: string = 'auto'): Promise<string> {
    // Debug mode - return placeholder text
    if (this.debugMode) {
      // console.log('DEBUG MODE: Returning placeholder translation');
      return 'TODO TRANSLATED TEXT';
    }

    let browser;
    try {
      // URL encode the text
      const encodedText = encodeURIComponent(text);

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
          '--disable-gpu'
        ]
      });

      const page = await browser.newPage();

      // Set user agent and viewport
      await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      await page.setViewport({ width: 1366, height: 768 });

      // Navigate to Google Translate
    //   console.log('Loading Google Translate page...');
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 10000
      });

      // Wait for translation to appear
    //   console.log('Waiting for translation to load...');
      // Delay here for page load and also not to hit translation server too fast!
      await new Promise(resolve => setTimeout(resolve, 2000));   // Was 3 second lowered to 1.
      // 1 seemed to work ok. not working now
      // 400 was too fast or the ones before it were, hmmm
    //   await new Promise(resolve => setTimeout(resolve, 3000)); 

      // Try to find the translation result
      const translation = await page.evaluate(this.extractTranslationFromHTML);

      // Save the page content for debugging
      const pageContent = await page.content();
      // const tempFilePath = path.join(__dirname, '../temp_translated.html');
      // fs.writeFileSync(tempFilePath, pageContent);
      // console.log(`Debug: Saved Google Translate page content to ${tempFilePath}`);

      if (!translation) {
        throw new Error('Could not extract translation from response - check temp_translated.html for debugging');
      }

      return translation;

    } catch (error) {
      console.error('Translation error:', error);
      throw new Error(`Translation failed: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
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
    const dataTextMatches = htmlContent.match(/data-language-name="([^"]+)"[^>]*data-text="([^"]+)"/g);

    if (dataTextMatches) {
      for (const match of dataTextMatches) {
        const languageMatch = match.match(/data-language-name="([^"]+)"/);
        const textMatch = match.match(/data-text="([^"]+)"/);

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
   * @returns Promise<string> - Path to the new EPUB file
   */
  async repackageEPUB(originalFilename: string, targetLang: string, sourceLang: string = 'auto'): Promise<string> {
    try {
      const originalPath = path.join(__dirname, '../uploads', originalFilename);
      const baseName = path.parse(originalFilename).name;
      const outputFilename = `${baseName}_${targetLang}.epub`;
      const outputPath = path.join(__dirname, '../uploads', outputFilename);
      
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

      console.log('STEP 1: Extracting EPUB...');
      // Copy EPUB to temp location and rename to .zip for PowerShell
      const tempZipPath = path.join(__dirname, '../tmp', 'temp.zip');
      fs.copyFileSync(originalPath, tempZipPath);    
 
      // Step 1: Extract using PowerShell (now that it's a .zip file)
      console.log('Step 1: Extracting EPUB...');
      await this.execAsync(`powershell -Command "Expand-Archive -Path '${tempZipPath}' -DestinationPath '${oldEpubDir}' -Force"`);

      // STEP 2: Process and translate files directly in the extracted EPUB
      console.log('STEP 2: Processing files directly in extracted EPUB...');
      const newEpubDir = path.join(oldEpubDir, 'OEBPS', 'xhtml');
      
      if (fs.existsSync(newEpubDir)) {
        const filesToTranslate = fs.readdirSync(newEpubDir)
          .filter(f => f.endsWith('.xhtml') || f.endsWith('.html'))
          .filter(f => f.includes('chapter')); // Only translate chapter files
        
        for (let i = 0; i < filesToTranslate.length; i++) {
          const file = filesToTranslate[i];
          const filePath = path.join(newEpubDir, file);
          
          // Debug flag: only process specific files when debugFlag is true
          if (this.debugFlag && i > 3) { // Only process chapter 6 (index 5)
            continue;
          }
          
          console.log(`Processing file ${i + 1}/${filesToTranslate.length}: ${file}`);
          await this.translateFile(filePath, targetLang, sourceLang);
        }
      }

      // Step 3: Create EPUB with proper structure using 7zip or manual method
      console.log('Step 3: Creating EPUB with proper structure...');
      
      try {
        // Try using 7zip if available (handles EPUB structure correctly)
        console.log('Attempting to create EPUB using 7zip...');
        await this.execAsync(`"C:\\Program Files\\7-Zip\\7z.exe" a -tzip "${outputPath}" "${oldEpubDir}\\*" -mx=0`);
        console.log('Created EPUB using 7zip');
      } catch (error) {
        console.log('7zip failed, using manual method...', error);
        
        // Manual method: create ZIP with mimetype first and uncompressed
        const tempZipOutput = outputPath.replace('.epub', '.zip');
        
        try {
          // Create ZIP with proper EPUB structure
          await this.execAsync(`powershell -Command "
            $zip = [System.IO.Compression.ZipFile]::Open('${tempZipOutput}', 'Create')
            $mimetypePath = '${oldEpubDir}\\mimetype'
            if (Test-Path $mimetypePath) {
              $entry = $zip.CreateEntry('mimetype', 'NoCompression')
              $stream = $entry.Open()
              $content = [System.IO.File]::ReadAllBytes($mimetypePath)
              $stream.Write($content, 0, $content.Length)
              $stream.Close()
            }
            Get-ChildItem '${oldEpubDir}' -Recurse | Where-Object { $_.Name -ne 'mimetype' } | ForEach-Object {
              $relativePath = $_.FullName.Substring('${oldEpubDir}'.Length + 1)
              $entry = $zip.CreateEntry($relativePath.Replace('\\', '/'), 'Optimal')
              $stream = $entry.Open()
              $content = [System.IO.File]::ReadAllBytes($_.FullName)
              $stream.Write($content, 0, $content.Length)
              $stream.Close()
            }
            $zip.Dispose()
          "`);
          
          // Check if ZIP was created before renaming
          if (fs.existsSync(tempZipOutput)) {
            fs.renameSync(tempZipOutput, outputPath);
            console.log('Created EPUB using manual method');
          } else {
            throw new Error('ZIP file was not created');
          }
        } catch (manualError) {
          console.error('Manual method also failed:', manualError);
          throw new Error(`Both 7zip and manual methods failed: ${error}, ${manualError}`);
        }
      }
      
      console.log(`EPUB repackaged successfully: ${outputPath}`);
      return outputPath;

    } catch (error) {
      console.error('Error in repackage EPUB method:', error);
      throw new Error(`Failed to repackage EPUB: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}