require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const hermesRouter = require('./routes/hermes');
const { errorHandler } = require('./middleware/errorHandler');
const { logger } = require('./middleware/logger');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'hermes-information-evaluation',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/v1/hermes', hermesRouter);
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Hermes Information Evaluation API listening on port ${PORT}`);
});

module.exports = app;
