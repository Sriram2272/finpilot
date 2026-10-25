const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();
const routes = require('./routes/api');
const { engineName } = require('./lib/extract');

const app = express();
const port = process.env.PORT || 5000;

mongoose.set('strictQuery', true);
mongoose
    .connect(process.env.MONGO_DB_URI, { serverSelectionTimeoutMS: 10_000 })
    .then(() => console.log('Database connected successfully'))
    .catch((err) => console.error('Database connection failed:', err.message));

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('Referrer-Policy', 'no-referrer');
    next();
});
app.use(express.json({ limit: '20kb' }));

app.use('/api', routes);

// Unknown API routes get JSON, not the React page.
app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } }));

// One place for unexpected errors, so the client always gets a readable message.
app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON.' } });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Request is too large.' } });
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Something went wrong on our side. Please try again.' } });
});

// Serve the built React app
app.use(express.static(path.join(__dirname, 'client', 'dist')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});

app.listen(port, () => {
    console.log(`FinPilot running on port ${port} (extraction engine: ${engineName()})`);
});
