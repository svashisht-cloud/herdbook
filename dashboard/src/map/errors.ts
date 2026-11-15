/** A map problem worth showing to the user as-is (the message is the user-facing text). */
export class MapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MapError'
  }
}
