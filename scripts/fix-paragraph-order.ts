import * as fs from 'fs';
import * as path from 'path';

/**
 * Fix paragraph order in HTML files:
 * 1. Check for empty <p style="font-style: italic;"></p> tags, skip if not found
 * 2. Parse file into paragraph sections
 * 3. Move <p style="font-style: italic;">...</p> elements to BEFORE the preceding <p> element
 * 4. Stop when we encounter two consecutive italic paragraphs
 */

interface Paragraph {
  fullText: string;
  isItalic: boolean;
  isEmpty: boolean;
}

function parseParagraphs(content: string): { before: string; paragraphs: Paragraph[]; after: string } {
  // Find where the body content starts
  const bodyMatch = content.match(/(<body[^>]*>)([\s\S]*?)(<\/body>)/i);
  if (!bodyMatch) {
    return { before: content, paragraphs: [], after: '' };
  }

  const before = content.substring(0, bodyMatch.index! + bodyMatch[1].length);
  const bodyContent = bodyMatch[2];
  const after = bodyMatch[3] + content.substring(bodyMatch.index! + bodyMatch[0].length);

  // Extract all <p> tags
  const pRegex = /<p(?:\s+[^>]*)?>(?:(?!<\/p>).|\n)*?<\/p>/gs;
  const paragraphs: Paragraph[] = [];
  const matches = bodyContent.matchAll(pRegex);

  for (const match of matches) {
    const fullText = match[0];
    const isItalic = fullText.includes('style="font-style: italic;"');
    const isEmpty = /<p[^>]*>\s*<\/p>/.test(fullText);
    paragraphs.push({ fullText, isItalic, isEmpty });
  }

  return { before, paragraphs, after };
}

function fixParagraphOrder(filePath: string): void {
  console.log(`Processing: ${filePath}`);

  let content = fs.readFileSync(filePath, 'utf-8');

  // Step 1: Check if empty italic paragraph exists
  const emptyItalicRegex = /<p style="font-style: italic;"><\/p>/;
  if (!emptyItalicRegex.test(content)) {
    console.log(`  No empty italic paragraphs found - skipping file`);
    return;
  }

  // Create a backup copy for debugging
  const backupPath = filePath.replace(/\.html$/, '.backup.html');
  fs.copyFileSync(filePath, backupPath);
  console.log(`  Created backup: ${backupPath}`);

  // Step 2: Parse into paragraph sections
  const { before, paragraphs, after } = parseParagraphs(content);
  console.log(`  Found ${paragraphs.length} paragraphs`);

  // Step 3: Remove empty italic paragraphs and process
  const filtered = paragraphs.filter(p => !(p.isItalic && p.isEmpty));
  console.log(`  Removed ${paragraphs.length - filtered.length} empty italic paragraph(s)`);

  const result: Paragraph[] = [];
  let swapCount = 0;

  for (let i = 0; i < filtered.length; i++) {
    const current = filtered[i];

    // Check if we hit two consecutive italic paragraphs - stop processing
    if (i > 0 && result.length > 0 && result[result.length - 1].isItalic && current.isItalic) {
      console.log(`  Found two consecutive italic paragraphs at position ${i} - stopping swaps`);
      // Add the rest as-is
      result.push(current);
      for (let j = i + 1; j < filtered.length; j++) {
        result.push(filtered[j]);
      }
      break;
    }

    // If current is italic and previous is not italic, swap them
    if (current.isItalic && result.length > 0 && !result[result.length - 1].isItalic) {
      const previous = result.pop()!;
      result.push(current);
      result.push(previous);
      swapCount++;
    } else {
      result.push(current);
    }
  }

  console.log(`  Swapped ${swapCount} paragraph(s)`);

  // Step 4: Reconstruct the file
  const newBodyContent = result.map(p => p.fullText).join('\n');
  const newContent = before + newBodyContent + after;

  // Write the fixed content back
  fs.writeFileSync(filePath, newContent, 'utf-8');
  console.log(`  Done! File updated.`);
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage: node fix-paragraph-order.ts <html-file>');
  console.log('Example: node fix-paragraph-order.ts data/old_epub/OEBPS/chapter003.html');
  process.exit(1);
}

const filePath = args[0];

if (!fs.existsSync(filePath)) {
  console.error(`Error: File not found: ${filePath}`);
  process.exit(1);
}

fixParagraphOrder(filePath);
