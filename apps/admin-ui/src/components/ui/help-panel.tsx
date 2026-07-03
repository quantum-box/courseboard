'use client'

import { ChevronDown, HelpCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

interface HelpSection {
  title: string
  content: string | React.ReactNode
}

interface HelpPanelProps {
  /** Unique key for persisting open/close state in localStorage */
  storageKey: string
  /** Panel heading text */
  title: string
  /** Brief summary shown next to the trigger button when closed */
  summary?: string
  /** Help content sections */
  sections: HelpSection[]
}

export function HelpPanel({
  storageKey,
  title,
  summary,
  sections,
}: HelpPanelProps) {
  const fullKey = `help-panel-${storageKey}`
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(fullKey)
    if (stored === 'true') setOpen(true)
  }, [fullKey])

  const handleToggle = () => {
    const next = !open
    setOpen(next)
    localStorage.setItem(fullKey, String(next))
  }

  return (
    <div className='rounded-lg border border-blue-200 bg-blue-50/50'>
      <button
        type='button'
        onClick={handleToggle}
        className='flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-blue-100/50 transition-colors rounded-lg'
      >
        <HelpCircle className='h-4 w-4 text-blue-600 shrink-0' />
        <span className='font-medium text-blue-900'>{title}</span>
        {summary && !open && (
          <span className='text-blue-600/70 truncate'>— {summary}</span>
        )}
        <ChevronDown
          className={`ml-auto h-4 w-4 text-blue-600 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className='px-4 pb-4 pt-1 space-y-3'>
          {sections.map(section => (
            <div key={section.title}>
              <h4 className='text-sm font-semibold text-blue-900 mb-1'>
                {section.title}
              </h4>
              <div className='text-sm text-blue-800/80 leading-relaxed whitespace-pre-line'>
                {section.content}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
