# Development-only cryptographic vectors

`updates.public.pem` is a 3072-bit RSA SubjectPublicKeyInfo public key. The
two signed envelopes authenticate the exact bytes of their sibling valid V2
payload JSON files. These fixtures are solely for TypeScript, Swift, and Worker
interoperability tests.

The matching PKCS#8 private key was generated in a temporary directory and was
discarded after signing. It is not in this repository, native app resources,
package output, or any runtime configuration. Never use this public key or its
former private half for an internal or production release.
