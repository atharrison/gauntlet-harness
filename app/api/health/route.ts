import { NextResponse } from 'next/server'

export function GET() {
  return NextResponse.json({ status: 'ok', ts: new Date().toISOString() })
}
