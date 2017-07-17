'use strict';

class HttpError extends Error {
  constructor(status, message, err) {
    let handledFlag = false;

    if (status instanceof HttpError) {
      return status;
    }

    if (status instanceof Error) {
      err = status;
      status = err.status;
      message = message || err.message;
    }

    if (typeof status == 'string' && parseInt(status) !== status) {
      err = typeof message == 'object' ? message : err;
      message = status;
      status = err && err.status;
    }

    if (typeof message == 'object') {
      err = message;
      message = err.message;
    }

    super(message);

    this.status = status || 500;
    this.error = err;
  }
}

module.exports = HttpError;
