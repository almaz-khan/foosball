import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

const FLAG_UP = 0x01; // user present
const FLAG_UV = 0x04; // user verified
const FLAG_AT = 0x40; // attested credential data included

/**
 * A software passkey: a real P-256 key producing real signatures, so the tests
 * exercise SimpleWebAuthn's verification end to end instead of mocking it.
 */
export class SoftAuthenticator {
  readonly id = randomBytes(16);
  private readonly privateKey: KeyObject;
  private readonly x: Buffer;
  private readonly y: Buffer;
  private counter = 0;
  /** The user handle from registration, returned on every sign-in as a real passkey does. */
  userHandle: string | null = null;

  /**
   * `nordpass` reproduces a behaviour observed in production: the user handle is
   * decoded as UTF-8 text and re-encoded, so non-UTF-8 bytes come back as U+FFFD.
   */
  constructor(
    private readonly origin: string,
    private readonly quirk: 'none' | 'nordpass' = 'none',
  ) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    this.privateKey = privateKey;
    this.x = Buffer.from(jwk.x!, 'base64url');
    this.y = Buffer.from(jwk.y!, 'base64url');
  }

  get credentialId(): string {
    return b64url(this.id);
  }

  private authData(rpID: string, flags: number, attested?: Uint8Array): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    return Buffer.concat([sha256(rpID), Buffer.from([flags]), counter, ...(attested ? [attested] : [])]);
  }

  private clientData(type: string, challenge: string, origin: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  register(
    options: PublicKeyCredentialCreationOptionsJSON,
    { origin = this.origin }: { origin?: string } = {},
  ): RegistrationResponseJSON {
    const cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, this.x],
        [-3, this.y],
      ]),
    );
    this.userHandle =
      this.quirk === 'nordpass'
        ? b64url(Buffer.from(new TextDecoder('utf-8').decode(Buffer.from(options.user.id, 'base64url')), 'utf8'))
        : options.user.id;
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.id.length);
    const attested = Buffer.concat([Buffer.alloc(16), idLength, this.id, cose]); // zero AAGUID
    const authData = this.authData(options.rp.id!, FLAG_UP | FLAG_UV | FLAG_AT, attested);
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]) as never,
    );
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: b64url(this.clientData('webauthn.create', options.challenge, origin)),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
    };
  }

  authenticate(
    options: PublicKeyCredentialRequestOptionsJSON,
    { origin = this.origin }: { origin?: string } = {},
  ): AuthenticationResponseJSON {
    this.counter += 1;
    const authData = this.authData(options.rpId!, FLAG_UP | FLAG_UV);
    const clientData = this.clientData('webauthn.get', options.challenge, origin);
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.privateKey);
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: b64url(clientData),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: this.userHandle ?? undefined,
      },
      clientExtensionResults: {},
    };
  }
}
