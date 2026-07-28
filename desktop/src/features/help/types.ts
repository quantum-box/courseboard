export type PageHelpSection = {
  heading: string
  body: string
}

export type PageHelp = {
  title: string
  summary: string
  /** What to do on this page. */
  usage: PageHelpSection[]
  /** Words that appear on the page, explained in business terms. */
  data: PageHelpSection[]
}

export type HelpCatalog = {
  fallback: PageHelp
  routes: Record<string, PageHelp>
}
