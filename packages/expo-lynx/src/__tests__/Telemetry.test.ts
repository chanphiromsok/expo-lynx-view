import {
  safeLoadEvent,
  safeErrorEvent,
  safeUpdateEvent,
  redactUrlForTelemetry,
} from '../Telemetry';

describe('safeLoadEvent', () => {
  it('passes through valid event', () => {
    const e = safeLoadEvent({
      feature: 'delivery',
      version: 'v2',
      source: 'download',
      durationMs: 1234,
    });
    expect(e).toEqual({
      feature: 'delivery',
      version: 'v2',
      source: 'download',
      durationMs: 1234,
    });
  });

  it('clamps absurd durationMs to max 60s', () => {
    const e = safeLoadEvent({
      feature: 'f',
      version: 'v',
      source: 'cache',
      durationMs: 999_999_999,
    });
    expect(e?.durationMs).toBe(60_000);
  });

  it('clamps negative durationMs to 0', () => {
    const e = safeLoadEvent({
      feature: 'f',
      version: 'v',
      source: 'cache',
      durationMs: -10,
    });
    expect(e?.durationMs).toBe(0);
  });
});

describe('safeErrorEvent', () => {
  it('passes through clean error', () => {
    const e = safeErrorEvent({
      feature: 'f',
      stage: 'manifest',
      code: 'E_TEST',
      message: 'manifest decode failed',
    });
    expect(e?.message).toBe('manifest decode failed');
  });

  it('truncates very long message', () => {
    const longMessage = 'x'.repeat(2000);
    const e = safeErrorEvent({
      feature: 'f',
      stage: 'download',
      code: 'E_TEST',
      message: longMessage,
    });
    expect(e?.message.length).toBe(500);
  });

  it('drops messages containing bearer tokens', () => {
    const e = safeErrorEvent({
      feature: 'f',
      stage: 'signature',
      code: 'E_AUTH',
      message: 'failed with Authorization: Bearer eyJhbGc...',
    });
    expect(e).toBeNull();
  });

  it('drops messages containing token query strings', () => {
    const e = safeErrorEvent({
      feature: 'f',
      stage: 'download',
      code: 'E_URL',
      message: 'GET /path?token=secret HTTP 401',
    });
    expect(e).toBeNull();
  });
});

describe('redactUrlForTelemetry', () => {
  it('strips query string', () => {
    expect(redactUrlForTelemetry('https://api.example.com/foo?token=secret&key=abc')).toBe(
      'https://api.example.com/foo'
    );
  });

  it('truncates very long urls', () => {
    const long = 'https://api.example.com/' + 'a'.repeat(500);
    const redacted = redactUrlForTelemetry(long);
    expect(redacted.length).toBe(200);
  });

  it('passes through clean url', () => {
    expect(redactUrlForTelemetry('https://api.example.com/foo')).toBe(
      'https://api.example.com/foo'
    );
  });
});

describe('safeUpdateEvent', () => {
  it('keeps structured update fields and bounds timing', () => {
    expect(
      safeUpdateEvent({
        feature: 'delivery',
        channel: 'stable',
        phase: 'staged',
        releaseId: 'delivery-2026.08.29.1',
        version: '2026.08.29',
        revision: 4,
        durationMs: 99_999,
      })
    ).toEqual({
      feature: 'delivery',
      channel: 'stable',
      phase: 'staged',
      releaseId: 'delivery-2026.08.29.1',
      version: '2026.08.29',
      revision: 4,
      durationMs: 60_000,
    });
  });

  it('drops a telemetry error containing a credential', () => {
    expect(
      safeUpdateEvent({
        feature: 'delivery',
        channel: 'stable',
        phase: 'error',
        message: 'HTTP request failed with Authorization: Bearer secret',
      })
    ).toBeNull();
  });
});
