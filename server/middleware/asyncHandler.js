/**
 * Wraps async route handlers to forward errors to Express error middleware.
 */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
}
