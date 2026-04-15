/**
 * Short, room-code-friendly charset (uppercase, no confusing I/O).
 */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const activeCodes = new Set<string>();
const codeToRoomId = new Map<string, string>();

export function generateRoomCode(length = 5): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  if (activeCodes.has(code)) return generateRoomCode(length);
  activeCodes.add(code);
  return code;
}

export function reserveRoomCode(code: string): boolean {
  if (activeCodes.has(code)) return false;
  activeCodes.add(code);
  return true;
}

export function releaseRoomCode(code: string): void {
  activeCodes.delete(code);
  codeToRoomId.delete(code);
}

export function registerRoomCode(code: string, roomId: string): void {
  codeToRoomId.set(code, roomId);
}

export function resolveRoomCode(code: string): string | null {
  return codeToRoomId.get(code) ?? null;
}
