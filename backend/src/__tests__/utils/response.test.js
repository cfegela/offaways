'use strict';

const R = require('../../utils/response');

describe('response helpers', () => {
  const expectJSON = (res, status, body) => {
    expect(res.statusCode).toBe(status);
    expect(res.headers['Content-Type']).toBe('application/json');
    if (body !== undefined) expect(JSON.parse(res.body)).toEqual(body);
  };

  test('ok() returns 200 with serialised body', () => {
    expectJSON(R.ok({ foo: 'bar' }), 200, { foo: 'bar' });
  });

  test('ok() handles arrays', () => {
    expectJSON(R.ok([1, 2, 3]), 200, [1, 2, 3]);
  });

  test('created() returns 201', () => {
    expectJSON(R.created({ id: '123' }), 201, { id: '123' });
  });

  test('noContent() returns 204 with empty body', () => {
    const res = R.noContent();
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  test('badRequest() returns 400 with message', () => {
    expectJSON(R.badRequest('bad input'), 400, { message: 'bad input' });
  });

  test('unauthorized() returns 401 with default message', () => {
    expectJSON(R.unauthorized(), 401, { message: 'Unauthorized' });
  });

  test('unauthorized() returns 401 with custom message', () => {
    expectJSON(R.unauthorized('token expired'), 401, { message: 'token expired' });
  });

  test('forbidden() returns 403 with default message', () => {
    expectJSON(R.forbidden(), 403, { message: 'Forbidden' });
  });

  test('forbidden() returns 403 with custom message', () => {
    expectJSON(R.forbidden('no access'), 403, { message: 'no access' });
  });

  test('notFound() returns 404 with default message', () => {
    expectJSON(R.notFound(), 404, { message: 'Not found' });
  });

  test('notFound() returns 404 with custom message', () => {
    expectJSON(R.notFound('Filing not found'), 404, { message: 'Filing not found' });
  });

  test('serverError() returns 500', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expectJSON(R.serverError(new Error('oops')), 500, { message: 'Internal server error' });
    spy.mockRestore();
  });

  test('all responses include CORS headers', () => {
    const responses = [
      R.ok({}), R.created({}), R.noContent(),
      R.badRequest('x'), R.unauthorized(), R.forbidden(), R.notFound(), R.serverError(new Error()),
    ];
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    responses.forEach((res) => {
      expect(res.headers['Access-Control-Allow-Origin']).toBeDefined();
    });
    spy.mockRestore();
  });
});
