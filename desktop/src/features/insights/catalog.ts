import { defineCatalog } from '@json-render/core'
import { schema } from '@json-render/react/schema'
import { z } from 'zod'

/**
 * What the model may draw with. Every data-carrying prop is meant to be bound
 * to a dataset (`{ "$state": "/datasets/<name>" }`) that the desk computed from
 * the tee sheet, so a chart can only ever show counted numbers.
 */

const cell = z.union([z.string(), z.number(), z.null()])
const rows = z.array(z.record(z.string(), cell))

const series = z.array(z.object({
  key: z.string().describe('Numeric column of the dataset'),
  label: z.string().describe('Legend label shown to the operator'),
}))

export const insightsCatalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: z.object({
        direction: z.enum(['vertical', 'horizontal']).nullable(),
      }),
      slots: ['default'],
      description: 'Layout container. Vertical by default; horizontal wraps on narrow screens.',
    },
    Grid: {
      props: z.object({
        columns: z.number().int().min(1).max(4).nullable(),
      }),
      slots: ['default'],
      description: 'Responsive grid of children (e.g. a row of Metric tiles or two charts side by side).',
    },
    Heading: {
      props: z.object({
        text: z.string(),
        level: z.enum(['1', '2', '3']).nullable(),
      }),
      description: 'Section heading.',
    },
    Text: {
      props: z.object({
        text: z.string(),
        tone: z.enum(['default', 'muted']).nullable(),
      }),
      description: 'Short explanatory sentence. Never state numbers that are not bound with $template.',
    },
    Callout: {
      props: z.object({
        text: z.string(),
        tone: z.enum(['info', 'warning']).nullable(),
      }),
      description: 'Highlighted note, e.g. to say a dataset cannot answer part of the question.',
    },
    Metric: {
      props: z.object({
        label: z.string(),
        value: z.union([z.number(), z.string(), z.null()]),
        unit: z.string().nullable(),
        detail: z.string().nullable(),
      }),
      description: 'One headline number. Bind value to a summary field, e.g. { "$state": "/datasets/summary/reservations" }.',
    },
    BarChart: {
      props: z.object({
        title: z.string().nullable(),
        data: rows,
        xKey: z.string().describe('Category column'),
        series,
        stacked: z.boolean().nullable(),
        orientation: z.enum(['vertical', 'horizontal']).nullable(),
      }),
      description: 'Bar chart comparing categories. Use for weekday, course, hour, status breakdowns.',
    },
    LineChart: {
      props: z.object({
        title: z.string().nullable(),
        data: rows,
        xKey: z.string(),
        series,
      }),
      description: 'Line chart for an ordered axis such as dates or hours.',
    },
    DonutChart: {
      props: z.object({
        title: z.string().nullable(),
        data: rows,
        labelKey: z.string(),
        valueKey: z.string(),
      }),
      description: 'Share of a whole (few categories, e.g. play type or status).',
    },
    Table: {
      props: z.object({
        title: z.string().nullable(),
        data: rows,
        columns: z.array(z.object({
          key: z.string(),
          label: z.string(),
          align: z.enum(['left', 'right']).nullable(),
        })),
        showTotal: z.boolean().nullable(),
      }),
      description: 'Plain table of a dataset. showTotal adds a sum row for numeric columns.',
    },
  },
  actions: {},
})
