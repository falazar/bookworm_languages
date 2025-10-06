# Book Language Translator

A Node.js TypeScript web application for translating EPUB books to different languages. Upload an EPUB file, select your target language, and download the translated version.

## 🚀 Features

- **EPUB Upload**: Accept and process EPUB book files
- **Language Selection**: Choose from multiple target languages
- **Translation Processing**: Convert book content to selected language
- **Download Support**: Get your translated EPUB file
- **Modern UI**: Clean, responsive interface built with EJS templates
- **TypeScript**: Full type safety and modern JavaScript features
- **Development Tools**: Hot reload, testing framework, and more

## 🛠️ Tech Stack

- **Backend**: Node.js with Express.js
- **Language**: TypeScript
- **Templates**: EJS (Embedded JavaScript)
- **Testing**: Vitest
- **Development**: Nodemon for auto-reload
- **File Handling**: Built-in file upload support

## 📋 Prerequisites

- Node.js (v16 or higher)
- npm or yarn package manager

## 🚀 Quick Start

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd bookwork_languages
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development server**
   ```bash
   npm run dev
   ```

4. **Open your browser**
   Navigate to `http://localhost:3888`



## 🎯 Development Roadmap

See [TODO_LIST.txt](TODO_LIST.txt) for detailed development phases and tasks.


## 🔧 Configuration

### Environment Variables
Create a `.env` file in the root directory:

```env
PORT=3888
TRANSLATION_API_KEY=your_api_key_here
MAX_FILE_SIZE=50MB
SUPPORTED_LANGUAGES=en,es,fr,de,it,pt,ru,ja,ko,zh
```

### Supported Languages
The application will support translation to:
- English (en)
- Spanish (es)
- French (fr)
- German (de)
- Italian (it)
- Portuguese (pt)
- Russian (ru)
- Japanese (ja)
- Korean (ko)
- Chinese (zh)

## 📝 API Endpoints

### Current Endpoints
- `GET /` - Home page
- `GET /hello` - Hello page with dynamic content

### Planned Endpoints
- `POST /upload` - Upload EPUB file
- `POST /translate` - Start translation process
- `GET /download/:id` - Download translated file
- `GET /status/:id` - Check translation status
- `GET /languages` - Get supported languages

## 🧪 Testing

The project uses Vitest for testing. Run tests with:

```bash
npm test
```

For a visual test interface:
```bash
npm run test:ui
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request



This project is designed to be a comprehensive solution for translating EPUB books, making literature more accessible across different languages and cultures.
