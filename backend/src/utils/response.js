'use strict';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  'Access-Control-Allow-Credentials': 'true',
  'Content-Type': 'application/json',
};

function ok(data) {
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(data),
  };
}

function created(data) {
  return {
    statusCode: 201,
    headers: CORS_HEADERS,
    body: JSON.stringify(data),
  };
}

function noContent() {
  return {
    statusCode: 204,
    headers: CORS_HEADERS,
    body: '',
  };
}

function badRequest(message) {
  return {
    statusCode: 400,
    headers: CORS_HEADERS,
    body: JSON.stringify({ message }),
  };
}

function unauthorized(message = 'Unauthorized') {
  return {
    statusCode: 401,
    headers: CORS_HEADERS,
    body: JSON.stringify({ message }),
  };
}

function forbidden(message = 'Forbidden') {
  return {
    statusCode: 403,
    headers: CORS_HEADERS,
    body: JSON.stringify({ message }),
  };
}

function notFound(message = 'Not found') {
  return {
    statusCode: 404,
    headers: CORS_HEADERS,
    body: JSON.stringify({ message }),
  };
}

function serverError(err) {
  console.error(err);
  return {
    statusCode: 500,
    headers: CORS_HEADERS,
    body: JSON.stringify({ message: 'Internal server error' }),
  };
}

module.exports = { ok, created, noContent, badRequest, unauthorized, forbidden, notFound, serverError };
