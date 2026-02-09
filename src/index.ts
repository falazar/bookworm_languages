import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { TranslationService } from './translation-service.js';
import * as cheerio from 'cheerio';
import AdmZip from 'adm-zip';
import { ReaderService } from './reader-service.js';

console.log('🚀 Starting server...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3888;
const UPLOADS_DIR = path.join(__dirname, '../data/uploads');
const PROGRESS_FILE = path.join(__dirname, '../data/progress.json');
const translationService = new TranslationService();
const readerService = new ReaderService();

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // Keep original filename
    cb(null, file.originalname);
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Accept only EPUB files
    if (file.mimetype === 'application/epub+zip' || path.extname(file.originalname).toLowerCase() === '.epub') {
      cb(null, true);
    } else {
      cb(new Error('Only EPUB files are allowed!'));
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

// Middleware
app.use(express.static(path.join(__dirname, '../public')));

// Request logging middleware - MUST be before JSON parsing
app.use((req, res, next) => {
  try {
    console.log(`\n🌐 ${new Date().toISOString()} - ${req.method} ${req.path}`);
    // console.log('Headers:', req.headers);
    next();
  } catch (error) {
    console.error('❌ Error in request logging middleware:', error);
    next(error);
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper function to get book list
function getBookList() {
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    return files
      .filter(file => file.toLowerCase().endsWith('.epub'))
      .map(file => {
        const filePath = path.join(UPLOADS_DIR, file);
        const stats = fs.statSync(filePath);
        const baseName = path.parse(file).name;
        const cleanBaseName = baseName.replace(/(_[A-Za-z]{2,3}(?:-[A-Za-z]{2,3})?)+$/i, '');
        const originalCandidate = path.join(UPLOADS_DIR, `${cleanBaseName}.epub`);
        const sourceFilename = fs.existsSync(originalCandidate) ? `${cleanBaseName}.epub` : file;
        return {
          filename: file,
          displayName: file, // No timestamp to remove
          sourceFilename,
          size: stats.size,
          uploadDate: stats.mtime,
          sizeFormatted: formatFileSize(stats.size),
        };
      })
      .sort((a, b) => b.uploadDate.getTime() - a.uploadDate.getTime());
  } catch (error) {
    console.error('Error reading uploads directory:', error);
    return [];
  }
}

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper functions for progress
// New simplified structure: { "book.epub": { lastDoc: "chapter.html", paragraphIndex: 5 } }
interface BookProgress {
  lastDoc: string;
  paragraphIndex: number;
}

function loadProgress(): Record<string, BookProgress> {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const data = fs.readFileSync(PROGRESS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading progress:', error);
  }
  return {};
}

function saveProgress(progress: Record<string, BookProgress>): void {
  try {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  } catch (error) {
    console.error('Error saving progress:', error);
  }
}

// Routes
app.get('/', (req, res) => {
  const books = getBookList();
  res.render('index', {
    title: 'Book Language Translator',
    message: 'Upload and translate your EPUB books',
    books: books,
  });
});

// Simple Books page: lists all uploaded EPUBs
app.get('/books', (req, res) => {
  const books = getBookList();
  const booksWithCounts = books.map(b => {
    const epubPath = path.join(UPLOADS_DIR, b.filename);
    const chapterCount = readerService.getChapterCount(epubPath);
    const coverDataUrl = readerService.getCoverDataUrl(epubPath);
    return { ...b, chapterCount, coverDataUrl };
  });
  res.render('books', {
    title: 'Books',
    books: booksWithCounts,
  });
});

app.post('/upload', upload.single('epubFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  res.json({
    success: true,
    message: 'File uploaded successfully',
    filename: req.file.filename,
  });
});

app.get('/translate/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(UPLOADS_DIR, filename);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  // Supported languages
  const languages = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'ru', name: 'Russian' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'zh', name: 'Chinese' },
  ];

  res.render('translate', {
    title: 'Translate Book',
    filename: filename,
    displayName: filename, // No timestamp to remove
    languages: languages,
  });
});

app.post('/translate-book', async (req, res) => {
  try {
    const { filename, sourceLanguage, targetLanguage } = req.body;
    if (!filename || !targetLanguage) {
      console.log('ERROR: Missing required parameters');
      return res.status(400).json({ error: 'Filename and target language are required' });
    }

    const translatedText = await translationService.translateBook(
      filename,
      targetLanguage,
      sourceLanguage === 'auto' ? 'auto' : sourceLanguage
    );

    console.log('Translation completed successfully');
    res.json({
      success: true,
      translatedText: translatedText,
    });
  } catch (error) {
    console.error('\n=== TRANSLATION ERROR ===');
    console.error('Error type:', typeof error);
    console.error('Error message:', error instanceof Error ? error.message : 'Unknown error');
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('Full error object:', error);

    res.status(500).json({
      error: 'Translation failed',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
});

app.get('/hello', (req, res) => {
  res.render('hello', {
    title: 'Hello Page',
    name: req.query.name || 'World',
  });
});

// Chrome TTS page: speaks HTML paragraphs using speechSynthesis
app.get('/tts', async (req, res) => {
  try {
    // List uploaded EPUB books
    const books = getBookList().map(b => b.filename);
    // console.log('[TTS] Found books:', books);
    if (books.length === 0) {
      return res.status(200).send('No EPUBs uploaded yet. Please upload a book first.');
    }

    // Validate and get book path
    const { selectedBook, epubPath } = validateAndGetBookPath(req.query.book as string | undefined, books);

    // Parse EPUB chapters via ReaderService
    const docs = readerService.getChapters(epubPath);
    const docLabels = readerService.getChapterLabels(epubPath, docs);
    console.log('[TTS] Chapters (docs) count:', docs.length);
    console.log('[TTS] Available docs:', docs.slice(0, 10)); // Log first 10 chapters

    // Determine which document and paragraph to start from (validates and normalizes)
    const { selectedDoc, paragraphIndex: savedParagraphIndex } = getBookPosition(
      selectedBook,
      docs,
      req.query.doc as string | undefined
    );

    console.log('[TTS] Final selected doc:', selectedDoc);
    console.log('[TTS] Selected doc index in docs array:', docs.indexOf(selectedDoc));

    // Extract paragraphs from the selected document
    const paragraphs = extractParagraphsFromDoc(epubPath, selectedDoc);

    res.render('tts', {
      title: 'Read Aloud (Chrome Voices)',
      file: selectedDoc,
      paragraphs,
      // New: pass book and docs for selection in UI
      books,
      book: selectedBook,
      docs,
      docLabels,
      doc: selectedDoc,
      // Use paragraph index determined earlier
      savedParagraphIndex,
    });
  } catch (error) {
    console.error('Error in /tts:', error);
    res.status(500).send('Internal error preparing TTS page');
  }
});

/**
 * Validates book selection and returns the safe file path
 * @param requestedBook - Book filename from query parameter (optional)
 * @param availableBooks - List of available book filenames
 * @returns Object with selectedBook name and epubPath
 */
function validateAndGetBookPath(
  requestedBook: string | undefined,
  availableBooks: string[]
): { selectedBook: string; epubPath: string } {
  // Select book from query or use first available
  const selectedBook = requestedBook || availableBooks[0];

  // Validate book filename to prevent path traversal
  if (!isSafeFilename(selectedBook)) {
    console.warn('[TTS] SECURITY: Invalid book filename rejected:', selectedBook);
    throw new Error('Invalid book filename');
  }

  // Verify book exists in our list (whitelist check)
  if (!availableBooks.includes(selectedBook)) {
    console.warn('[TTS] SECURITY: Book not in whitelist:', selectedBook);
    throw new Error('Book not in whitelist');
  }

  console.log('[TTS] Selected book:', selectedBook);
  const uploadsPath = path.join(__dirname, '../data/uploads');
  const epubPath = path.join(uploadsPath, selectedBook);

  // Double-check resolved path is within uploads directory
  const resolvedPath = path.resolve(epubPath);
  const resolvedUploads = path.resolve(uploadsPath);
  if (!resolvedPath.startsWith(resolvedUploads)) {
    console.error('[TTS] SECURITY: Path traversal attempt detected');
    throw new Error('Path traversal attempt detected');
  }

  // Verify file exists
  if (!fs.existsSync(epubPath)) {
    throw new Error('EPUB file not found');
  }

  return { selectedBook, epubPath };
}

/**
 * Determines which document and paragraph to start reading from
 * @param selectedBook - The book filename
 * @param docs - Array of available documents in the book
 * @param queryDoc - Optional doc parameter from query string
 * @returns Object with selectedDoc path and paragraph index to start from
 */
function getBookPosition(
  selectedBook: string,
  docs: string[],
  queryDoc?: string
): { selectedDoc: string; paragraphIndex: number } {
  const progress = loadProgress();
  const bookProgress = progress[selectedBook];
  console.log('[TTS] Saved progress for this book:', JSON.stringify(bookProgress, null, 2));

  let selectedDoc: string;
  let paragraphIndex = 0;

  if (!queryDoc) {
    // No doc specified in query - use saved progress or first chapter
    if (bookProgress?.lastDoc) {
      selectedDoc = bookProgress.lastDoc;
      paragraphIndex = bookProgress.paragraphIndex || 0;
      console.log(`[TTS] Resuming last read: ${selectedDoc} at paragraph ${paragraphIndex}`);
    } else {
      selectedDoc = docs[0];
      console.log(`[TTS] No saved progress, starting at first chapter: ${docs[0]}`);
    }
  } else {
    // Doc was specified in query
    selectedDoc = queryDoc;
    console.log(`[TTS] Doc specified in query: ${selectedDoc}`);
    if (bookProgress?.lastDoc === selectedDoc) {
      paragraphIndex = bookProgress.paragraphIndex || 0;
      console.log(`[TTS] Resuming at paragraph ${paragraphIndex}`);
    } else {
      console.log(`[TTS] Different doc than saved, starting at paragraph 0`);
    }
  }

  // Validate doc path to prevent path traversal
  if (!isSafeDocPath(selectedDoc)) {
    console.warn('[TTS] SECURITY: Invalid doc path rejected:', selectedDoc);
    throw new Error('Invalid document path');
  }

  // Normalize: remove ./ in front
  selectedDoc = selectedDoc.replace(/^\.\//g, '');

  // Verify doc exists in EPUB's chapter list (whitelist check)
  if (!docs.includes(selectedDoc)) {
    console.warn('[TTS] SECURITY: Doc not in EPUB chapter list:', selectedDoc);
    throw new Error('Selected document not found in EPUB');
  }

  return { selectedDoc, paragraphIndex };
}

/**
 * Extracts paragraphs from a document in an EPUB file
 * @param epubPath - Path to the EPUB file
 * @param selectedDoc - Document path within the EPUB
 * @returns Array of paragraph objects with text and language
 */
function extractParagraphsFromDoc(epubPath: string, selectedDoc: string): Array<{ text: string; lang: string }> {
  const zip = new AdmZip(epubPath);
  const entries = zip.getEntries();

  const docEntry = entries.find((e: any) => e.entryName === selectedDoc);
  if (!docEntry) {
    console.log('[TTS] Selected doc entry not found in EPUB:', selectedDoc);
    throw new Error('Selected document not found in EPUB');
  }

  const rawHtml = docEntry.getData().toString('utf8');
  const $ = cheerio.load(rawHtml, { xmlMode: true });

  const paragraphs = $('p')
    .map((_, el) => {
      const text = $(el).text().trim();
      if (!text) return null;
      const isTranslated = $(el).hasClass('translated');
      const lang = isTranslated ? 'fr' : 'en';
      return { text, lang };
    })
    .get()
    .filter((p: { text: string; lang: string } | null) => p !== null);

  return paragraphs as Array<{ text: string; lang: string }>;
}

// Progress routes
app.get('/get-progress', (req, res) => {
  const { book } = req.query;
  if (!book) {
    return res.status(400).json({ error: 'Book parameter required' });
  }
  const progress = loadProgress();
  const bookProgress = progress[book as string];
  console.log('[SERVER] Loaded progress:', bookProgress);
  res.json(bookProgress || { lastDoc: null, paragraphIndex: 0 });
});

app.post('/save-progress', (req, res) => {
  const { book, doc, paragraphIndex } = req.body;
  console.log('[SERVER] /save-progress request received:', { book, doc, paragraphIndex });

  if (!book || !doc || typeof paragraphIndex !== 'number') {
    console.error('[SERVER] Invalid save-progress request - missing parameters');
    return res.status(400).json({ error: 'Book, doc, and paragraphIndex required' });
  }

  console.log('[SERVER] Saving progress:', { book, doc, paragraphIndex });
  const progress = loadProgress();
  console.log('[SERVER] Current progress before save:', JSON.stringify(progress, null, 2));

  // Store only the last read chapter per book
  progress[book] = {
    lastDoc: doc,
    paragraphIndex: paragraphIndex,
  };

  saveProgress(progress);
  console.log('[SERVER] Progress saved successfully, new state:', JSON.stringify(progress[book], null, 2));

  res.json({ success: true });
});

// Test endpoint to verify server is working
app.get('/test', (req, res) => {
  console.log('🧪 TEST ENDPOINT HIT');
  res.json({
    success: true,
    message: 'Server is working!',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Security Helper Functions
// ============================================================================

// Security: Input validation to prevent path traversal attacks
// This protects against directory traversal vulnerabilities
function isSafeFilename(filename: string): boolean {
  if (!filename || typeof filename !== 'string') return false;
  // Reject path traversal patterns (../, ..\, ..%2F, etc.)
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) return false;
  // Reject absolute paths
  if (filename.startsWith('/') || /^[a-zA-Z]:/.test(filename)) return false;
  // Only allow alphanumeric, dash, underscore, dot (for extensions)
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return false;
  // Reject hidden files and special names
  if (filename.startsWith('.') || filename === '.' || filename === '..') return false;
  return true;
}

function isSafeDocPath(docPath: string): boolean {
  if (!docPath || typeof docPath !== 'string') return false;
  // Remove leading ./ if present (common in EPUB paths)
  const normalized = docPath.replace(/^\.\//, '');
  // Reject path traversal patterns
  if (normalized.includes('..')) return false;
  // Must not start with / or \ (no absolute paths)
  if (normalized.startsWith('/') || normalized.startsWith('\\')) return false;
  // Only allow forward slashes, alphanumeric, dash, underscore, dot
  if (!/^[a-zA-Z0-9._\/-]+$/.test(normalized)) return false;
  return true;
}

// ============================================================================
// Start server
// ============================================================================

const server = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT (Ctrl+C). Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed successfully');
    process.exit(0);
  });
});

// Global error handler
app.use((error: any, req: any, res: any, next: any) => {
  console.error('\n💥 GLOBAL ERROR HANDLER TRIGGERED');
  console.error('Error:', error);
  console.error('Request:', req.method, req.path);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message || 'Unknown error occurred',
  });
});
