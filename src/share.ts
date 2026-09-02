import type { ProjectState } from './types'

/**
 * Projektzustand als teilbarer Link. Der komplette Zustand steckt komprimiert
 * im URL-Fragment (`#s=…`) – er wird dadurch nie an einen Server geschickt und
 * lässt sich trotzdem per Link weitergeben.
 *
 * Format: ein Kennbuchstabe, dann Base64url.
 *   z = mit „deflate-raw“ komprimiert, j = unkomprimiertes JSON (Rückfallebene)
 */
export const HASH_PREFIX = '#s='

export async function encodeState(state: ProjectState): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(state))
  const packed = await compress(bytes)
  return packed ? `z${toBase64Url(packed)}` : `j${toBase64Url(bytes)}`
}

export async function decodeState(token: string): Promise<ProjectState | null> {
  try {
    const bytes = fromBase64Url(token.slice(1))
    const raw = token[0] === 'z' ? await decompress(bytes) : bytes
    if (!raw) return null
    return JSON.parse(new TextDecoder().decode(raw)) as ProjectState
  } catch {
    return null
  }
}

/** Vollständige URL zum aktuellen Zustand. */
export function shareUrl(token: string): string {
  const { origin, pathname, search } = location
  return `${origin}${pathname}${search}${HASH_PREFIX}${token}`
}

/** Token aus der aktuellen Adresse, oder null. */
export function tokenFromLocation(): string | null {
  return location.hash.startsWith(HASH_PREFIX) ? location.hash.slice(HASH_PREFIX.length) : null
}

async function compress(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

async function decompress(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
