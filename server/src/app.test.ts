import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from './app';
import { AppError } from './lib/appError';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { requestContextMiddleware } from './middleware/requestContext';
import { validate, validated } from './middleware/validate';
import { authorize } from './core/permissions/principal';

describe('app bootstrap', () => {
  const app = buildApp();

  it('GET /health is live without a database', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /ready is 503 when the database is not connected', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('NOT_READY');
  });

  it('unknown routes use the error envelope', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.requestId).toBeTruthy();
  });

  it('sets security headers and hides x-powered-by', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('ignores a client-supplied request id', async () => {
    const res = await request(app).get('/health').set('x-request-id', 'attacker');
    expect(res.headers['x-request-id']).not.toBe('attacker');
  });

  it('only allows configured CORS origins', async () => {
    const ok = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await request(app).get('/health').set('Origin', 'http://evil.test');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('error handling + validation conventions', () => {
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  const schema = { body: z.object({ name: z.string().min(2), qty: z.coerce.number().int().default(1) }) };
  app.post('/echo', validate(schema), (req, res) => {
    res.json({ data: validated<typeof schema.body>(req).body });
  });
  app.get('/boom', () => {
    throw new Error('secret internals');
  });
  app.get('/conflict', () => {
    throw AppError.conflict('STAGE_SKIP', 'Cannot skip stages', { to: 'BOOKED' });
  });
  app.get('/dup', () => {
    throw Object.assign(new Error('E11000'), { code: 11000, keyPattern: { phoneE164: 1 }, keyValue: { phoneE164: '+919999999999' } });
  });
  app.get('/guarded', authorize('enquiries.view'), (_req, res) => {
    res.json({ data: 'secret' });
  });
  app.use(notFound);
  app.use(errorHandler);

  it('passes validated + coerced input to the controller', async () => {
    const res = await request(app).post('/echo').send({ name: 'Raj', qty: '3' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ name: 'Raj', qty: 3 });
  });

  it('returns field-level validation details', async () => {
    const res = await request(app).post('/echo').send({ name: 'R' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('name');
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(app).post('/echo').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('maps AppError to its status/code/details', async () => {
    const res = await request(app).get('/conflict');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'STAGE_SKIP', details: { to: 'BOOKED' } });
  });

  it('hides internals of unexpected errors', async () => {
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret internals');
  });

  it('reports duplicate-key conflicts by field only, never value', async () => {
    const res = await request(app).get('/dup');
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ fields: ['phoneE164'] });
    expect(JSON.stringify(res.body)).not.toContain('9999999999');
  });

  it('authorize() fails closed (401) with no authenticated principal', async () => {
    const res = await request(app).get('/guarded');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
