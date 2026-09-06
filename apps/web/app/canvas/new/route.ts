import { NextResponse } from 'next/server';

/**
 * Allocates a diagram id and forwards to the workspace, keeping starter params
 * (`prompt`, `template`, `renderer`, `focus`) intact. Persistence arrives with @nivik/storage.
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const target = new URL(`/canvas/${crypto.randomUUID()}`, url.origin);
  target.search = url.search;
  return NextResponse.redirect(target, 307);
}
