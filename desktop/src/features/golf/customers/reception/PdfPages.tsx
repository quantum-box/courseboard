import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState } from 'react'
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

/** Local previews only: original files still upload unchanged to Storage. */
export function PdfPages({ url, sourceIndex }: { url: string; sourceIndex: number }) {
  const { t } = useTranslation(['customers', 'common'])
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    setDocument(null)
    setError(false)
    const task = getDocument({ url })
    let disposed = false
    void task.promise.then(pdf => { if (!disposed) setDocument(pdf) }).catch(() => {
      if (!disposed) setError(true)
    })
    return () => { disposed = true; void task.destroy() }
  }, [url])
  if (error) return <p role="alert">{t('customers:reception.preview.pdfError')}</p>
  if (!document) return <p>{t('customers:reception.preview.pdfLoading')}</p>
  return <>{Array.from({ length: document.numPages }, (_, index) => (
    <PdfPage key={index} document={document} page={index + 1} sourceIndex={sourceIndex} />
  ))}</>
}

function PdfPage({ document, page, sourceIndex }: {
  document: PDFDocumentProxy; page: number; sourceIndex: number
}) {
  const { t } = useTranslation(['customers', 'common'])
  const canvas = useRef<HTMLCanvasElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!host.current) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '600px' })
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    let disposed = false
    let cancel: (() => void) | undefined
    void document.getPage(page).then(pdfPage => {
      if (disposed || !canvas.current) return
      const viewport = pdfPage.getViewport({ scale: 1.5 })
      canvas.current.width = viewport.width
      canvas.current.height = viewport.height
      const task = pdfPage.render({ canvas: canvas.current, viewport })
      cancel = () => task.cancel()
      return task.promise
    }).catch(error => { if (!disposed && error?.name !== 'RenderingCancelledException') setError(true) })
    return () => { disposed = true; cancel?.() }
  }, [document, page, visible])
  return <div ref={host} className="reception-pdf-page" data-source-index={sourceIndex} data-source-page={page}>
    <p className="reception-hint">{t('customers:reception.preview.pdfPage', { page: String(page), total: String(document.numPages) })}</p>
    {error ? <p role="alert">{t('customers:reception.preview.pageError')}</p> :
      <canvas ref={canvas} aria-label={`${page}ページ目の受付用紙`} />}
  </div>
}
