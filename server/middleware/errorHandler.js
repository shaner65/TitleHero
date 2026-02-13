/**
 * Central error handler for Express. Logs errors and sends appropriate JSON response.
 */
export function errorHandler(err, req, res, next) {
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  // Known database errors
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Resource already exists' });
  }

  const message = err.message || 'Internal server error';
  const status = err.status ?? err.statusCode ?? 500;
  const body = { error: message };
  if (err.prefix != null) body.prefix = err.prefix;
  res.status(status).json(body);
}
