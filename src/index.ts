import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { TranslationService } from './translation-service.js';

console.log('🚀 Starting server...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3888;
const UPLOADS_DIR = path.join(__dirname, '../data/uploads');
const translationService = new TranslationService();

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
        return {
          filename: file,
          displayName: file, // No timestamp to remove
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

// Routes
app.get('/', (req, res) => {
  const books = getBookList();
  res.render('index', {
    title: 'Book Language Translator',
    message: 'Upload and translate your EPUB books',
    books: books,
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
  console.log('\n=== TRANSLATION REQUEST RECEIVED ===');
  console.log('Request body:', req.body);

  try {
    const { filename, sourceLanguage, targetLanguage } = req.body;
    console.log('Extracted parameters:', { filename, sourceLanguage, targetLanguage });

    if (!filename || !targetLanguage) {
      console.log('ERROR: Missing required parameters');
      return res.status(400).json({ error: 'Filename and target language are required' });
    }

    console.log('Starting translation service...');
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

// Test endpoint to verify server is working
app.get('/test', (req, res) => {
  console.log('🧪 TEST ENDPOINT HIT');
  res.json({
    success: true,
    message: 'Server is working!',
    timestamp: new Date().toISOString(),
  });
});

// Start server
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
