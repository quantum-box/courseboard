"use client"

import { useState, useCallback } from "react"
import { Copy, Check } from "lucide-react"
import type { ReactNode } from "react"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "components/ui/toast"
import { useToast } from "components/ui/use-toast"

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  return ""
}

function CopyButton({
  title,
  description,
}: {
  title: ReactNode
  description: ReactNode
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    const text = [extractText(title), extractText(description)]
      .filter(Boolean)
      .join("\n")
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard write failed silently (permission denied, etc.)
    }
  }, [title, description])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="mt-1 flex items-center gap-1 text-xs text-red-200 opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3" />
          コピーしました
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          クリックでコピー
        </>
      )}
    </button>
  )
}

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        const isDestructive = props.variant === "destructive"
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
              {isDestructive && (
                <CopyButton title={title} description={description} />
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
