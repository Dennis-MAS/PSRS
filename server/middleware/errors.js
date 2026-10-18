import { HttpError } from '../utils/helpers.js';

export const notFoundApi = (_req, _res, next) => next(new HttpError(404, 'Endpoint not found'));

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  let status = err.status || 500;
  let message = err.message;
  let details = err.details;
  if (err.code === 11000) { status = 409; message = 'A record with these details already exists'; }
  else if (err.name === 'ValidationError') { status = 422; message = 'Validation failed'; details = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message])); }
  else if (err.name === 'CastError') { status = 400; message = 'Invalid value supplied'; }
  else if (err.name === 'MulterError') { status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400; message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : 'Upload failed'; }
  else if (err.type === 'entity.parse.failed') { status = 400; message = 'Malformed JSON'; }
  else if (err.type === 'entity.too.large') { status = 413; message = 'Payload too large'; }
  if (status >= 500) {
    console.error(err);
    if (process.env.NODE_ENV === 'production') message = 'Something went wrong on our side';
  }
  res.status(status).json({ success: false, message, ...(details ? { errors: details } : {}) });
}
