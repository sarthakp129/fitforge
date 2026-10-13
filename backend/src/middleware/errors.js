const CODE_FOR_STATUS = {
  400: 'invalid_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  412: 'precondition_failed',
  422: 'unprocessable',
  429: 'rate_limited',
  500: 'internal_error',
  502: 'bad_gateway',
  503: 'service_unavailable',
};

export class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = extra.code || CODE_FOR_STATUS[status] || 'request_error';
    this.extra = extra;
  }
}

export function notFound(req, res) {
  res.status(404).json({ error: 'not_found', message: `No route for ${req.method} ${req.path}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  const payload = {
    error: err.code || (status === 500 ? 'internal_error' : 'request_error'),
    message: err.message || 'Unexpected error',
    ...(err.extra || {}),
  };
  if (status >= 500) console.error('[fitforge] error:', err);
  res.status(status).json(payload);
}
