import * as fs from 'fs';
import * as path from 'path';

/**
 * Fix the second half of files where italics are already paired:
 * 1. Find where two consecutive italic <p> tags appear
 * 2. From that point, push each italic paragraph past the next non-italic one
 * 3. Continue this pattern for the rest of the file
 */

interface Paragraph {
  fullText: string;
  isItalic: boolean;
  isTranslated: boolean;
  isEmpty: boolean;
}

function parseParagraphs(content: string): { before: string; paragraphs: Paragraph[]; after: string } {
  const bodyMatch = content.match(/(<body[^>]*>)([\s\S]*?)(<\/body>)/i);
  if (!bodyMatch) {
    return { before: content, paragraphs: [], after: '' };
  }

  const before = content.substring(0, bodyMatch.index! + bodyMatch[1].length);
  const bodyContent = bodyMatch[2];
  const after = bodyMatch[3] + content.substring(bodyMatch.index! + bodyMatch[0].length);

  const pRegex = /<p(?:\s+[^>]*)?>(?:(?!<\/p>).|\n)*?<\/p>/gs;
  const paragraphs: Paragraph[] = [];
  const matches = bodyContent.matchAll(pRegex);

  for (const match of matches) {
    const fullText = match[0];
    const isItalic = fullText.includes('style="font-style: italic;"');
    const isTranslated = fullText.includes('class="translated"');
    const isEmpty = /<p[^>]*>\s*<\/p>/.test(fullText);
    paragraphs.push({ fullText, isItalic, isTranslated, isEmpty });
  }

  return { before, paragraphs, after };
}

function fixSecondHalf(filePath: string): void {
  console.log(`Processing: ${filePath}`);

  // Create a backup copy for debugging
  const backupPath = filePath.replace(/\.html$/, '.backup2.html');
  fs.copyFileSync(filePath, backupPath);
  console.log(`  Created backup: ${backupPath}`);

  let content = fs.readFileSync(filePath, 'utf-8');

  const { before, paragraphs, after } = parseParagraphs(content);
  console.log(`  Found ${paragraphs.length} paragraphs`);

  // Find empty translated paragraph - that's where the problem starts
  let splitIndex = -1;
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].isTranslated && paragraphs[i].isEmpty) {
      splitIndex = i + 1; // Start from after the empty paragraph
      console.log(`  Found empty translated paragraph at position ${i}`);
      console.log(`  Will fix from position ${splitIndex} onwards`);
      break;
    }
  }

  if (splitIndex === -1) {
    console.log(`  No empty translated paragraph found - nothing to fix`);
    return;
  }

  // Remove the empty paragraph and split into before/after sections
  const firstHalf = paragraphs.slice(0, splitIndex - 1); // Don't include empty paragraph
  const secondHalf = paragraphs.slice(splitIndex);

  // Fix second half: move each translated paragraph UP before the italic that precedes it
  const result: Paragraph[] = [...firstHalf];
  let swapCount = 0;

  for (let i = 0; i < secondHalf.length; i++) {
    const current = secondHalf[i];

    // If current is translated and the last thing we added was italic, swap them
    if (current.isTranslated && result.length > 0 && result[result.length - 1].isItalic) {
      const previousItalic = result.pop()!;
      result.push(current); // Add translated first
      result.push(previousItalic); // Then add italic
      swapCount++;
    } else {
      result.push(current);
    }
  }

  console.log(`  Swapped ${swapCount} paragraph(s) in second half`);

  // Reconstruct the file
  const newBodyContent = result.map(p => p.fullText).join('\n');
  const newContent = before + newBodyContent + after;

  // Write the fixed content back
  fs.writeFileSync(filePath, newContent, 'utf-8');
  console.log(`  Done! File updated.`);
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage: node fix-second-half.ts <html-file>');
  console.log('Example: node fix-second-half.ts data/old_epub/OEBPS/chapter003.html');
  process.exit(1);
}

const filePath = args[0];

if (!fs.existsSync(filePath)) {
  console.error(`Error: File not found: ${filePath}`);
  process.exit(1);
}

fixSecondHalf(filePath);
