'use client'

import { useRouter } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import type { User } from '@supabase/supabase-js'

export default function UserMenu({ user }: { user: User }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const avatarUrl: string | undefined = user.user_metadata?.avatar_url
  const username: string = user.user_metadata?.user_name ?? user.email ?? 'User'

  async function handleSignOut() {
    // POST to server route so it can clear the httpOnly gh_provider_token cookie
    // in addition to the Supabase session — client-side JS can't delete httpOnly cookies.
    await fetch('/api/auth/signout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={menuRef} className="relative ml-auto">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-300 transition hover:bg-gray-800"
        aria-label="User menu"
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={username}
            width={28}
            height={28}
            className="rounded-full ring-1 ring-gray-700"
          />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-700 text-xs font-semibold text-white">
            {username[0]?.toUpperCase()}
          </span>
        )}
        <span className="hidden sm:inline">{username}</span>
        <svg
          className={`h-4 w-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl">
          <div className="border-b border-gray-800 px-3 py-2">
            <p className="text-xs font-medium text-white">{username}</p>
            {user.email && (
              <p className="truncate text-xs text-gray-500">{user.email}</p>
            )}
          </div>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-300 transition hover:bg-gray-800 hover:text-white"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h7a1 1 0 000-2H4V5h6a1 1 0 000-2H3zm11.293 4.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L15.586 11H9a1 1 0 110-2h6.586l-1.293-1.293a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
