import express from 'express';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3888;

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Middleware
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
  res.render('index', { 
    title: 'Hello World',
    message: 'Welcome to your Node.js TypeScript app with EJS!'
  });
});

app.get('/hello', (req, res) => {
  res.render('hello', {
    title: 'Hello Page',
    name: req.query.name || 'World'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
