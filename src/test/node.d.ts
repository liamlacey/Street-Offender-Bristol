/** The bits of Node the tests use (src/test/bristol.ts, src/map/geotiff.test.ts), without pulling in all of Node's types. */
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
  export function readFileSync(path: string | URL): Uint8Array;
}
declare module 'node:zlib' {
  export function deflateSync(data: Uint8Array): Uint8Array;
  export function inflateSync(data: Uint8Array): Uint8Array;
  export function gunzipSync(data: Uint8Array): Uint8Array;
}
