import { NextResponse } from "next/server";

/** JSON que soporta BigInt (ids) y Decimal de Prisma. */
export function jsonResponse(data: unknown, init?: ResponseInit) {
  const body = JSON.stringify(data, (_key, value) => {
    if (typeof value === "bigint") return value.toString();
    if (value && typeof value === "object" && value.constructor?.name === "Decimal") {
      return Number(value.toString());
    }
    return value;
  });
  return new NextResponse(body, {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...init?.headers },
  });
}

export function errorResponse(message: string, status = 500, extra: Record<string, unknown> = {}) {
  return jsonResponse({ success: false, error: message, ...extra }, { status });
}

export function parseId(value: string): bigint | null {
  return /^\d{1,18}$/.test(value) ? BigInt(value) : null;
}

export type IdRouteContext = { params: Promise<{ id: string }> };
