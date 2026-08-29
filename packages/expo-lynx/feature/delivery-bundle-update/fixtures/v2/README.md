# Lynx delivery V2 fixtures

These JSON files are portable test vectors for the V2 release protocol. They
contain no credentials or production artifact URLs.

- `valid-*-payload.json` is the decoded UTF-8 JSON document.
- `valid-*-envelope.json` is a structurally valid envelope containing the exact
  minified payload bytes as strict unpadded base64url. Its `signature` is a
  syntactically valid placeholder, **not** a cryptographic test signature.
- `invalid-*.json` vectors each break one required structural invariant and
  must fail before any network URL or local cache path is trusted.

M02/S01 add a development-only RSA key pair and cryptographically signed
envelopes. Private test material must never be copied to the Expo app resource
tree or used for production signing.
