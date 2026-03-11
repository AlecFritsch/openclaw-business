import { NextRequest, NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
    }

    const clerk = await clerkClient()
    await clerk.waitlistEntries.create({ emailAddress: email })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    if (err?.errors?.[0]?.code === 'duplicate_record') {
      return NextResponse.json({ ok: true })
    }
    console.error('[waitlist] error:', err?.errors || err?.message)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
