import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  decodeBase64Url,
  parseDeploymentPayload,
  parseReleasePayload,
  parseSignedEnvelope,
  parseUnverifiedEnvelopePayload,
  type ProtocolParseResult,
} from '../ReleaseProtocol';

const FIXTURE_DIRECTORY = resolve(__dirname, '../../feature/delivery-bundle-update/fixtures/v2');
const CRYPTO_FIXTURE_DIRECTORY = resolve(FIXTURE_DIRECTORY, 'crypto-development');

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIRECTORY, name), 'utf8')) as unknown;
}

function parsed<T>(result: ProtocolParseResult<T>): T {
  if (result.ok) return result.value;
  throw result.error;
}

function failureCode<T>(result: ProtocolParseResult<T>): string {
  if (!result.ok) return result.error.code;
  throw new Error('Expected protocol parsing to fail.');
}

function deploymentFixture(): Record<string, unknown> {
  return structuredClone(fixture('valid-deployment-payload.json')) as Record<string, unknown>;
}

function disabledDeploymentFixture(): Record<string, unknown> {
  return structuredClone(fixture('valid-disabled-deployment-payload.json')) as Record<
    string,
    unknown
  >;
}

function releaseFixture(): Record<string, unknown> {
  return structuredClone(fixture('valid-release-payload.json')) as Record<string, unknown>;
}

describe('V2 release protocol', () => {
  it('parses the direct deployment response and legacy release fixture deterministically', () => {
    const releaseEnvelope = parsed(parseSignedEnvelope(fixture('valid-release-envelope.json')));

    expect(parsed(parseDeploymentPayload(deploymentFixture(), 'shopping'))).toMatchObject({
      schemaVersion: 1,
      type: 'lynx-deployment',
      feature: 'shopping',
      revision: 7,
      enabled: true,
      force: false,
      archiveUrl: '/v1/bundles/shopping/shopping-2026.09.01.1/release.zip',
    });
    expect(parsed(parseDeploymentPayload(disabledDeploymentFixture(), 'shopping'))).toEqual({
      schemaVersion: 1,
      type: 'lynx-deployment',
      feature: 'shopping',
      revision: 8,
      enabled: false,
      runtimeVersion: 'expo-57',
      issuedAt: '2026-08-29T10:00:00.000Z',
    });
    expect(parsed(parseReleasePayload(releaseFixture(), 'shopping'))).toMatchObject({
      type: 'lynx-release',
      feature: 'shopping',
      platform: 'ios',
      archive: { format: 'zip', entryCount: 2, uncompressedBytes: 20 },
    });
    expect(parsed(parseUnverifiedEnvelopePayload(releaseEnvelope))).toEqual(releaseFixture());
  });

  it('keeps the checked-in legacy release envelope fixture readable while Worker migration is pending', () => {
    const envelope = parsed(
      parseSignedEnvelope(fixture('crypto-development/valid-release-envelope.json'))
    );
    expect(parsed(parseUnverifiedEnvelopePayload(envelope))).toEqual(releaseFixture());
    expect(readFileSync(resolve(CRYPTO_FIXTURE_DIRECTORY, 'updates.public.pem'), 'utf8')).toMatch(
      /BEGIN PUBLIC KEY/
    );
  });

  it('rejects unsupported envelope versions, algorithms, padding, invalid alphabets, and non-canonical base64url', () => {
    expect(
      failureCode(
        parseSignedEnvelope({
          ...(fixture('valid-deployment-envelope.json') as object),
          schemaVersion: 2,
        })
      )
    ).toBe('unsupported-schema-version');
    expect(
      failureCode(
        parseSignedEnvelope({
          ...(fixture('valid-deployment-envelope.json') as object),
          algorithm: 'RSA-PSS',
        })
      )
    ).toBe('unsupported-algorithm');
    expect(
      failureCode(parseSignedEnvelope(fixture('invalid-envelope-padded-base64url.json')))
    ).toBe('invalid-base64url');
    expect(() => decodeBase64Url('AQ==')).toThrow(/base64url/i);
    expect(() => decodeBase64Url('AQ!')).toThrow(/base64url/i);
    expect(() => decodeBase64Url('AB')).toThrow(/canonical/i);
  });

  it('requires signed document type and exact requested feature before a payload can be used', () => {
    expect(failureCode(parseReleasePayload(deploymentFixture(), 'shopping'))).toBe('invalid-type');
    expect(
      failureCode(
        parseDeploymentPayload(fixture('invalid-deployment-payload-wrong-feature.json'), 'shopping')
      )
    ).toBe('feature-mismatch');
    const release = releaseFixture();
    release.feature = 'Shopping';
    expect(failureCode(parseReleasePayload(release, 'Shopping'))).toBe('invalid-feature');
  });

  it('rejects unsafe identifiers, URLs, revisions, and timestamps', () => {
    const invalidCases: [string, unknown, string][] = [
      ['feature', { feature: 'shopping/admin' }, 'invalid-feature'],
      ['releaseId', { releaseId: '../release' }, 'invalid-release-id'],
      ['archiveUrl', { archiveUrl: '//release.zip' }, 'invalid-url'],
      ['archiveBytes', { archiveBytes: 0 }, 'invalid-size'],
      ['revision', { revision: 0 }, 'invalid-revision'],
      ['issuedAt', { issuedAt: 'not-a-date' }, 'invalid-timestamp'],
    ];
    for (const [, change, expectedCode] of invalidCases) {
      expect(
        failureCode(parseDeploymentPayload({ ...deploymentFixture(), ...change }, 'shopping'))
      ).toBe(expectedCode);
    }
  });

  it('rejects cross-variant and unknown direct deployment fields', () => {
    expect(
      failureCode(
        parseDeploymentPayload(
          { ...deploymentFixture(), unsafeMode: 'skip-verification' },
          'shopping'
        )
      )
    ).toBe('unknown-field');
    expect(
      parsed(parseDeploymentPayload({ ...deploymentFixture(), force: true }, 'shopping')).force
    ).toBe(true);
    expect(
      failureCode(
        parseDeploymentPayload(
          { ...disabledDeploymentFixture(), releaseId: 'forbidden' },
          'shopping'
        )
      )
    ).toBe('unknown-field');
    expect(
      failureCode(parseDeploymentPayload({ ...deploymentFixture(), enabled: false }, 'shopping'))
    ).toBe('unknown-field');
  });

  it('rejects traversal, absolute, backslash, duplicate, and oversized release paths', () => {
    expect(
      failureCode(
        parseReleasePayload(fixture('invalid-release-payload-traversal.json'), 'shopping')
      )
    ).toBe('invalid-path');
    for (const path of [
      '../main.lynx.bundle',
      '/main.lynx.bundle',
      'static\\logo.png',
      'static//logo.png',
      './logo.png',
      'static/%2Flogo.png',
    ]) {
      const release = releaseFixture();
      const files = release.files as Record<string, unknown>[];
      files[1].path = path;
      expect(failureCode(parseReleasePayload(release, 'shopping'))).toBe('invalid-path');
    }
    const duplicate = releaseFixture();
    (duplicate.files as Record<string, unknown>[])[1].path = 'main.lynx.bundle';
    expect(failureCode(parseReleasePayload(duplicate, 'shopping'))).toBe('multiple-main-bundles');

    const caseCollision = releaseFixture();
    (caseCollision.files as Record<string, unknown>[])[1].path = 'MAIN.LYNX.BUNDLE';
    expect(failureCode(parseReleasePayload(caseCollision, 'shopping'))).toBe('duplicate-path');

    const oversized = releaseFixture();
    (oversized.files as Record<string, unknown>[])[1].path = `static/${'a'.repeat(600)}.png`;
    expect(failureCode(parseReleasePayload(oversized, 'shopping'))).toBe('invalid-path');
  });

  it('requires one main bundle and a self-consistent bounded archive/file contract', () => {
    const noMain = releaseFixture();
    (noMain.files as Record<string, unknown>[])[0].path = 'app.lynx.bundle';
    expect(failureCode(parseReleasePayload(noMain, 'shopping'))).toBe('missing-main-bundle');

    const multipleMain = releaseFixture();
    (multipleMain.files as Record<string, unknown>[])[1].path = 'main.lynx.bundle';
    expect(failureCode(parseReleasePayload(multipleMain, 'shopping'))).toBe(
      'multiple-main-bundles'
    );

    const invalidCases: [string, (release: Record<string, unknown>) => void, string][] = [
      [
        'hash',
        (release) => {
          (release.archive as Record<string, unknown>).sha256 = 'bad';
        },
        'invalid-sha256',
      ],
      [
        'size',
        (release) => {
          (release.archive as Record<string, unknown>).bytes = 0;
        },
        'invalid-size',
      ],
      [
        'format',
        (release) => {
          (release.archive as Record<string, unknown>).format = 'tar';
        },
        'invalid-archive-format',
      ],
      [
        'entry count',
        (release) => {
          (release.archive as Record<string, unknown>).entryCount = 3;
        },
        'archive-contract-mismatch',
      ],
      [
        'expanded bytes',
        (release) => {
          (release.archive as Record<string, unknown>).uncompressedBytes = 21;
        },
        'archive-contract-mismatch',
      ],
      [
        'ratio',
        (release) => {
          (release.archive as Record<string, unknown>).bytes = 1;
          (release.archive as Record<string, unknown>).uncompressedBytes = 200;
        },
        'archive-limit-exceeded',
      ],
      [
        'archive bytes limit',
        (release) => {
          (release.archive as Record<string, unknown>).bytes = 64 * 1024 * 1024 + 1;
        },
        'archive-limit-exceeded',
      ],
      [
        'expanded bytes limit',
        (release) => {
          (release.archive as Record<string, unknown>).uncompressedBytes = 256 * 1024 * 1024 + 1;
        },
        'archive-limit-exceeded',
      ],
    ];
    for (const [, mutate, expectedCode] of invalidCases) {
      const release = releaseFixture();
      mutate(release);
      expect(failureCode(parseReleasePayload(release, 'shopping'))).toBe(expectedCode);
    }
  });
});
