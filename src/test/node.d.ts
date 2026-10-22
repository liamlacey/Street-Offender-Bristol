/** The one bit of Node the tests use (src/test/bristol.ts), without pulling in all of Node's types. */
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
}
