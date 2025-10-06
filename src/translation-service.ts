import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

export class TranslationService {
  private baseUrl = 'https://translate.google.com';
  
  async translateText(text: string, targetLang: string, sourceLang: string = 'auto'): Promise<string> {
    try {
      // URL encode the text
      const encodedText = encodeURIComponent(text);
      
      // Build the translation URL
      const url = `${this.baseUrl}/?sl=${sourceLang}&tl=${targetLang}&text=${encodedText}&op=translate`;
      console.log(" DEBUG url", url);
      
      // Make the request with proper headers to avoid blocking
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 15000, // 15 second timeout to allow for JS execution
      });
      
      // Save the initial response to a temporary HTML file for debugging
      const tempFilePath = path.join(__dirname, '../temp_translated.html');
      fs.writeFileSync(tempFilePath, response.data);
      console.log(`Debug: Saved initial Google Translate response to ${tempFilePath}`);
      
      // Wait for the page to load and JavaScript to execute
      console.log('Waiting for Google Translate to process...');
      await this.delay(3000); // Wait 3 seconds for translation to complete
      
      // Make a second request to get the translated content
      // Google Translate often loads the result via AJAX after the initial page load
      const translatedResponse = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 15000,
      });
      
      // Save the second response as well
      const tempFilePath2 = path.join(__dirname, '../temp_translated_after_wait.html');
      fs.writeFileSync(tempFilePath2, translatedResponse.data);
      console.log(`Debug: Saved post-wait Google Translate response to ${tempFilePath2}`);
      
      // Parse the HTML response to extract translation
      const $ = cheerio.load(translatedResponse.data);

      // Look for the translation result (this selector may need adjustment)
      const translation = $('[data-result-index="0"]').text() || 
                         $('.VIiyi').text() || 
                         $('.J0lOec').text() ||
                         $('.t0').text() ||
                         $('.result-shield-container').text() ||
                         $('.VIiyi').first().text();
      
      console.log(" DEBUG translation", translation);
      if (!translation) {
        // console.log('Available text elements:', $('*').map((i, el) => $(el).text()).get().slice(0, 10));
        throw new Error('Could not extract translation from response - check temp_translated.html for debugging');
      }
      
      return translation.trim();
      
    } catch (error) {
      console.error('Translation error:', error);
      throw new Error(`Translation failed: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
    }
  }
  
  // Helper method to split text into chunks for translation
  splitTextIntoChunks(text: string, maxLength: number = 4000): string[] {
    const chunks: string[] = [];
    const sentences = text.split(/[.!?]+/);
    let currentChunk = '';
    
    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = sentence;
        } else {
          // If single sentence is too long, split by words
          const words = sentence.split(' ');
          let wordChunk = '';
          for (const word of words) {
            if (wordChunk.length + word.length > maxLength) {
              chunks.push(wordChunk.trim());
              wordChunk = word;
            } else {
              wordChunk += (wordChunk ? ' ' : '') + word;
            }
          }
          if (wordChunk) currentChunk = wordChunk;
        }
      } else {
        currentChunk += (currentChunk ? '. ' : '') + sentence;
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }
  
  // Add delay between requests to avoid rate limiting
  async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
