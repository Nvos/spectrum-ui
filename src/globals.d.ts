interface Uint8Array {
  // TODO: Can this be resolved normally, seems API is from 2025
  setFromBase64(base64: string): { read: number; written: number };
}
