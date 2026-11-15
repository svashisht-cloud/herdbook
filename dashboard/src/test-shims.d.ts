// The default-map test reads the committed map files from disk. The dashboard has no @types/node
// (and adds no dependency for one test), so declare only what that test uses.
declare module 'node:fs' {
  export function readFileSync(path: string | URL): Uint8Array<ArrayBuffer>
}
