import type { AspidaClient, BasicHeaders } from 'aspida';
import type { Methods as Methods_ao48ap } from './api/agent/invoices';
import type { Methods as Methods_cixw9u } from './api/agent/invoices/_id';
import type { Methods as Methods_1k7ixvl } from './api/agent/invoices/_id/send';
import type { Methods as Methods_1iyd316 } from './api/agent/quotations';
import type { Methods as Methods_4xatot } from './api/agent/quotations/_id';
import type { Methods as Methods_15hr4zg } from './api/agent/quotations/_id/send';
import type { Methods as Methods_1mly45d } from './api/approvals';
import type { Methods as Methods_18qsrps } from './health';
import type { Methods as Methods_1rnk7uk } from './health/ready';
import type { Methods as Methods_r5l4d2 } from './v1/bridge/actions/_action@string';
import type { Methods as Methods_1qz1ong } from './v1/bridge/definitions';
import type { Methods as Methods_1r61wma } from './v1/bridge/definitions/_definition_id@string/runs/preview';
import type { Methods as Methods_15vxxqm } from './v1/bridge/runs/_run_id@string';
import type { Methods as Methods_1ulkw7q } from './v1/bridge/runs/_run_id@string/execute';
import type { Methods as Methods_1yczpa1 } from './v1/erp/approval-flows';
import type { Methods as Methods_qq877u } from './v1/erp/approval-flows/_id';
import type { Methods as Methods_sb1j18 } from './v1/erp/custom-fields/definitions';
import type { Methods as Methods_toxm3z } from './v1/erp/custom-fields/definitions/_id';
import type { Methods as Methods_1p1sdhl } from './v1/erp/custom-fields/values/_entity_type/_entity_id';
import type { Methods as Methods_u6icix } from './v1/erp/expense-categories';
import type { Methods as Methods_1qwtrx6 } from './v1/erp/expense-categories/_id';
import type { Methods as Methods_d0cy6f } from './v1/erp/expenses';
import type { Methods as Methods_drme4g } from './v1/erp/expenses/_id';
import type { Methods as Methods_ljp9de } from './v1/erp/expenses/_id/approve';
import type { Methods as Methods_1lz0ovi } from './v1/erp/expenses/_id/reject';
import type { Methods as Methods_5biy3d } from './v1/erp/purchase-orders';
import type { Methods as Methods_10av1nu } from './v1/erp/purchase-orders/_id';
import type { Methods as Methods_sbfxep } from './v1/erp/quotations';
import type { Methods as Methods_1gdewjm } from './v1/erp/quotations/_id';
import type { Methods as Methods_pafo0q } from './v1/erp/quotations/_id/convert-to-invoice';
import type { Methods as Methods_9dyjgt } from './v1/erp/vendors';
import type { Methods as Methods_1ghhl1y } from './v1/erp/vendors/_id';
import type { Methods as Methods_12bpkau } from './v1/field/api-keys';
import type { Methods as Methods_1g5sena } from './v1/field/api-keys/_id@string';
import type { Methods as Methods_thxi4x } from './v1/field/api-keys/_id@string/revoke';
import type { Methods as Methods_3u7uaz } from './v1/field/billing-accounts';
import type { Methods as Methods_g0yc1x } from './v1/field/billing-accounts/_id@string';
import type { Methods as Methods_3jwkjr } from './v1/field/billing-accounts/_id@string/operators';
import type { Methods as Methods_1yigpjw } from './v1/field/billing-accounts/_id@string/operators/_operator_id@string';
import type { Methods as Methods_15ucmd2 } from './v1/field/orders/batch/cancel-expired';
import type { Methods as Methods_1sk027z } from './v1/field/reports/payout';
import type { Methods as Methods_116wzil } from './v1/field/reports/payout.csv';
import type { Methods as Methods_3g9t7m } from './v1/invoice-reconciliations/square-payments';
import type { Methods as Methods_1pyisgt } from './v1/invoice-reconciliations/square-payments/_square_payment_id/reconcile';
import type { Methods as Methods_2gd440 } from './v1/invoices';
import type { Methods as Methods_vh2uiz } from './v1/invoices/_id';
import type { Methods as Methods_1ho9em6 } from './v1/invoices/_id/follow-up-status';
import type { Methods as Methods_157cr75 } from './v1/invoices/_id/payment-link/resend';
import type { Methods as Methods_fpp8d6 } from './v1/payment-links';
import type { Methods as Methods_a9x389 } from './v1/public/invoices/_id';
import type { Methods as Methods_2tlcqe } from './v1/public/invoices/_id/checkout';
import type { Methods as Methods_146tow5 } from './v1/public/invoices/_id/payment-intent';
import type { Methods as Methods_oz7ukb } from './v1/public/invoices/_id/stripe-publishable-key';
import type { Methods as Methods_6aml7b } from './v1/public/invoices/_tenant_id/_id';
import type { Methods as Methods_bnn7xw } from './v1/public/invoices/_tenant_id/_id/checkout';
import type { Methods as Methods_1t91ofz } from './v1/public/invoices/_tenant_id/_id/payment-intent';
import type { Methods as Methods_1b44ey9 } from './v1/public/invoices/_tenant_id/_id/stripe-publishable-key';
import type { Methods as Methods_c8zw0b } from './v1/storekit/carts';
import type { Methods as Methods_wk8snq } from './v1/storekit/carts/_cart_id@string';
import type { Methods as Methods_1ypp2hw } from './v1/storekit/carts/_cart_id@string/clear';
import type { Methods as Methods_1g07b25 } from './v1/storekit/carts/_cart_id@string/items';
import type { Methods as Methods_17ixyp1 } from './v1/storekit/carts/_cart_id@string/items/_item_id@string';
import type { Methods as Methods_6wsnaw } from './v1/storekit/categories';
import type { Methods as Methods_491zr8 } from './v1/storekit/checkout_sessions';
import type { Methods as Methods_r0y174 } from './v1/storekit/checkout_sessions/_order_id@string/confirm';
import type { Methods as Methods_orhpu6 } from './v1/storekit/consumer-orders/_order_id@string/receipt';
import type { Methods as Methods_11qo83i } from './v1/storekit/coupons/validate';
import type { Methods as Methods_1wp9lcl } from './v1/storekit/customers';
import type { Methods as Methods_zdpb96 } from './v1/storekit/customers/_customer_id@string';
import type { Methods as Methods_1dc5nat } from './v1/storekit/fulfillment-methods';
import type { Methods as Methods_u88nfx } from './v1/storekit/orders';
import type { Methods as Methods_1n5rgsc } from './v1/storekit/orders/_order_id@string';
import type { Methods as Methods_19hq73b } from './v1/storekit/orders/_order_id@string/cancel';
import type { Methods as Methods_1q9em5e } from './v1/storekit/orders/_order_id@string/deliver';
import type { Methods as Methods_1o8i9rl } from './v1/storekit/orders/_order_id@string/pickup';
import type { Methods as Methods_2y84lk } from './v1/storekit/orders/_order_id@string/prepare';
import type { Methods as Methods_16kz8kw } from './v1/storekit/orders/_order_id@string/ready';
import type { Methods as Methods_1ie7yy3 } from './v1/storekit/orders/_order_id@string/refund';
import type { Methods as Methods_jpnprm } from './v1/storekit/orders/_order_id@string/select-pickup-datetime';
import type { Methods as Methods_1kc978j } from './v1/storekit/orders/_order_id@string/ship';
import type { Methods as Methods_9wxfhk } from './v1/storekit/products';
import type { Methods as Methods_t1wq2s } from './v1/storekit/products/_product_id@string';
import type { Methods as Methods_7jjhsp } from './v1/storekit/products/_product_id@string/stock';

const api = <T>({ baseURL, fetch }: AspidaClient<T>) => {
  const prefix = (baseURL === undefined ? '' : baseURL).replace(/\/$/, '');
  const PATH0 = '/api/agent/invoices';
  const PATH1 = '/send';
  const PATH2 = '/api/agent/quotations';
  const PATH3 = '/api/approvals';
  const PATH4 = '/health';
  const PATH5 = '/health/ready';
  const PATH6 = '/v1/bridge/actions';
  const PATH7 = '/v1/bridge/definitions';
  const PATH8 = '/runs/preview';
  const PATH9 = '/v1/bridge/runs';
  const PATH10 = '/execute';
  const PATH11 = '/v1/erp/approval-flows';
  const PATH12 = '/v1/erp/custom-fields/definitions';
  const PATH13 = '/v1/erp/custom-fields/values';
  const PATH14 = '/v1/erp/expense-categories';
  const PATH15 = '/v1/erp/expenses';
  const PATH16 = '/approve';
  const PATH17 = '/reject';
  const PATH18 = '/v1/erp/purchase-orders';
  const PATH19 = '/v1/erp/quotations';
  const PATH20 = '/convert-to-invoice';
  const PATH21 = '/v1/erp/vendors';
  const PATH22 = '/v1/field/api-keys';
  const PATH23 = '/revoke';
  const PATH24 = '/v1/field/billing-accounts';
  const PATH25 = '/operators';
  const PATH26 = '/v1/field/orders/batch/cancel-expired';
  const PATH27 = '/v1/field/reports/payout';
  const PATH28 = '/v1/field/reports/payout.csv';
  const PATH29 = '/v1/invoice-reconciliations/square-payments';
  const PATH30 = '/reconcile';
  const PATH31 = '/v1/invoices';
  const PATH32 = '/follow-up-status';
  const PATH33 = '/payment-link/resend';
  const PATH34 = '/v1/payment-links';
  const PATH35 = '/v1/public/invoices';
  const PATH36 = '/checkout';
  const PATH37 = '/payment-intent';
  const PATH38 = '/stripe-publishable-key';
  const PATH39 = '/v1/storekit/carts';
  const PATH40 = '/clear';
  const PATH41 = '/items';
  const PATH42 = '/v1/storekit/categories';
  const PATH43 = '/v1/storekit/checkout_sessions';
  const PATH44 = '/confirm';
  const PATH45 = '/v1/storekit/consumer-orders';
  const PATH46 = '/receipt';
  const PATH47 = '/v1/storekit/coupons/validate';
  const PATH48 = '/v1/storekit/customers';
  const PATH49 = '/v1/storekit/fulfillment-methods';
  const PATH50 = '/v1/storekit/orders';
  const PATH51 = '/cancel';
  const PATH52 = '/deliver';
  const PATH53 = '/pickup';
  const PATH54 = '/prepare';
  const PATH55 = '/ready';
  const PATH56 = '/refund';
  const PATH57 = '/select-pickup-datetime';
  const PATH58 = '/ship';
  const PATH59 = '/v1/storekit/products';
  const PATH60 = '/stock';
  const GET = 'GET';
  const POST = 'POST';
  const PUT = 'PUT';
  const DELETE = 'DELETE';
  const PATCH = 'PATCH';

  return {
    api: {
      agent: {
        invoices: {
          _id: (val3: number | string) => {
            const prefix3 = `${PATH0}/${val3}`;

            return {
              send: {
                post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_1k7ixvl['post']['resBody'], BasicHeaders, Methods_1k7ixvl['post']['status']>(prefix, `${prefix3}${PATH1}`, POST, option).json(),
                $post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_1k7ixvl['post']['resBody'], BasicHeaders, Methods_1k7ixvl['post']['status']>(prefix, `${prefix3}${PATH1}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH1}`,
              },
              get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_cixw9u['get']['resBody'], BasicHeaders, Methods_cixw9u['get']['status']>(prefix, prefix3, GET, option).json(),
              $get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_cixw9u['get']['resBody'], BasicHeaders, Methods_cixw9u['get']['status']>(prefix, prefix3, GET, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix3}`,
            };
          },
          get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_ao48ap['get']['resBody'], BasicHeaders, Methods_ao48ap['get']['status']>(prefix, PATH0, GET, option).json(),
          $get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_ao48ap['get']['resBody'], BasicHeaders, Methods_ao48ap['get']['status']>(prefix, PATH0, GET, option).json().then(r => r.body),
          post: (option: { body: Methods_ao48ap['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_ao48ap['post']['resBody'], BasicHeaders, Methods_ao48ap['post']['status']>(prefix, PATH0, POST, option).json(),
          $post: (option: { body: Methods_ao48ap['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_ao48ap['post']['resBody'], BasicHeaders, Methods_ao48ap['post']['status']>(prefix, PATH0, POST, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH0}`,
        },
        quotations: {
          _id: (val3: number | string) => {
            const prefix3 = `${PATH2}/${val3}`;

            return {
              send: {
                post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_15hr4zg['post']['resBody'], BasicHeaders, Methods_15hr4zg['post']['status']>(prefix, `${prefix3}${PATH1}`, POST, option).json(),
                $post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_15hr4zg['post']['resBody'], BasicHeaders, Methods_15hr4zg['post']['status']>(prefix, `${prefix3}${PATH1}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH1}`,
              },
              get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_4xatot['get']['resBody'], BasicHeaders, Methods_4xatot['get']['status']>(prefix, prefix3, GET, option).json(),
              $get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_4xatot['get']['resBody'], BasicHeaders, Methods_4xatot['get']['status']>(prefix, prefix3, GET, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix3}`,
            };
          },
          get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_1iyd316['get']['resBody'], BasicHeaders, Methods_1iyd316['get']['status']>(prefix, PATH2, GET, option).json(),
          $get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_1iyd316['get']['resBody'], BasicHeaders, Methods_1iyd316['get']['status']>(prefix, PATH2, GET, option).json().then(r => r.body),
          post: (option: { body: Methods_1iyd316['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_1iyd316['post']['resBody'], BasicHeaders, Methods_1iyd316['post']['status']>(prefix, PATH2, POST, option).json(),
          $post: (option: { body: Methods_1iyd316['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_1iyd316['post']['resBody'], BasicHeaders, Methods_1iyd316['post']['status']>(prefix, PATH2, POST, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH2}`,
        },
      },
      approvals: {
        get: (option?: { config?: T | undefined } | undefined) =>
          fetch<Methods_1mly45d['get']['resBody'], BasicHeaders, Methods_1mly45d['get']['status']>(prefix, PATH3, GET, option).json(),
        $get: (option?: { config?: T | undefined } | undefined) =>
          fetch<Methods_1mly45d['get']['resBody'], BasicHeaders, Methods_1mly45d['get']['status']>(prefix, PATH3, GET, option).json().then(r => r.body),
        post: (option: { body: Methods_1mly45d['post']['reqBody'], config?: T | undefined }) =>
          fetch<Methods_1mly45d['post']['resBody'], BasicHeaders, Methods_1mly45d['post']['status']>(prefix, PATH3, POST, option).json(),
        $post: (option: { body: Methods_1mly45d['post']['reqBody'], config?: T | undefined }) =>
          fetch<Methods_1mly45d['post']['resBody'], BasicHeaders, Methods_1mly45d['post']['status']>(prefix, PATH3, POST, option).json().then(r => r.body),
        $path: () => `${prefix}${PATH3}`,
      },
    },
    health: {
      ready: {
        /**
         * Returns 200 when all dependencies are healthy, 503 otherwise.
         */
        get: (option?: { config?: T | undefined } | undefined) =>
          fetch<void, BasicHeaders, Methods_1rnk7uk['get']['status']>(prefix, PATH5, GET, option).send(),
        /**
         * Returns 200 when all dependencies are healthy, 503 otherwise.
         */
        $get: (option?: { config?: T | undefined } | undefined) =>
          fetch<void, BasicHeaders, Methods_1rnk7uk['get']['status']>(prefix, PATH5, GET, option).send().then(r => r.body),
        $path: () => `${prefix}${PATH5}`,
      },
      get: (option?: { config?: T | undefined } | undefined) =>
        fetch<void, BasicHeaders, Methods_18qsrps['get']['status']>(prefix, PATH4, GET, option).send(),
      $get: (option?: { config?: T | undefined } | undefined) =>
        fetch<void, BasicHeaders, Methods_18qsrps['get']['status']>(prefix, PATH4, GET, option).send().then(r => r.body),
      $path: () => `${prefix}${PATH4}`,
    },
    v1: {
      bridge: {
        actions: {
          _action: (val3: string) => {
            const prefix3 = `${PATH6}/${val3}`;

            return {
              /**
               * @returns Bridge action availability
               */
              post: (option: { body: Methods_r5l4d2['post']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_r5l4d2['post']['resBody'], BasicHeaders, Methods_r5l4d2['post']['status']>(prefix, prefix3, POST, option).json(),
              /**
               * @returns Bridge action availability
               */
              $post: (option: { body: Methods_r5l4d2['post']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_r5l4d2['post']['resBody'], BasicHeaders, Methods_r5l4d2['post']['status']>(prefix, prefix3, POST, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix3}`,
            };
          },
        },
        definitions: {
          _definition_id: (val3: string) => {
            const prefix3 = `${PATH7}/${val3}`;

            return {
              runs: {
                preview: {
                  /**
                   * @returns Existing idempotent Bridge run preview
                   */
                  post: (option: { body: Methods_1r61wma['post']['reqBody'], config?: T | undefined }) =>
                    fetch<Methods_1r61wma['post']['resBody'], BasicHeaders, Methods_1r61wma['post']['status']>(prefix, `${prefix3}${PATH8}`, POST, option).json(),
                  /**
                   * @returns Existing idempotent Bridge run preview
                   */
                  $post: (option: { body: Methods_1r61wma['post']['reqBody'], config?: T | undefined }) =>
                    fetch<Methods_1r61wma['post']['resBody'], BasicHeaders, Methods_1r61wma['post']['status']>(prefix, `${prefix3}${PATH8}`, POST, option).json().then(r => r.body),
                  $path: () => `${prefix}${prefix3}${PATH8}`,
                },
              },
            };
          },
          /**
           * @returns Bridge definition list
           */
          get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_1qz1ong['get']['resBody'], BasicHeaders, Methods_1qz1ong['get']['status']>(prefix, PATH7, GET, option).json(),
          /**
           * @returns Bridge definition list
           */
          $get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_1qz1ong['get']['resBody'], BasicHeaders, Methods_1qz1ong['get']['status']>(prefix, PATH7, GET, option).json().then(r => r.body),
          /**
           * @returns Bridge definition created
           */
          post: (option: { body: Methods_1qz1ong['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_1qz1ong['post']['resBody'], BasicHeaders, Methods_1qz1ong['post']['status']>(prefix, PATH7, POST, option).json(),
          /**
           * @returns Bridge definition created
           */
          $post: (option: { body: Methods_1qz1ong['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_1qz1ong['post']['resBody'], BasicHeaders, Methods_1qz1ong['post']['status']>(prefix, PATH7, POST, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH7}`,
        },
        runs: {
          _run_id: (val3: string) => {
            const prefix3 = `${PATH9}/${val3}`;

            return {
              execute: {
                /**
                 * @returns Bridge run executed and draft targets created
                 */
                post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_1ulkw7q['post']['resBody'], BasicHeaders, Methods_1ulkw7q['post']['status']>(prefix, `${prefix3}${PATH10}`, POST, option).json(),
                /**
                 * @returns Bridge run executed and draft targets created
                 */
                $post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_1ulkw7q['post']['resBody'], BasicHeaders, Methods_1ulkw7q['post']['status']>(prefix, `${prefix3}${PATH10}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH10}`,
              },
              /**
               * @returns Bridge run detail
               */
              get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_15vxxqm['get']['resBody'], BasicHeaders, Methods_15vxxqm['get']['status']>(prefix, prefix3, GET, option).json(),
              /**
               * @returns Bridge run detail
               */
              $get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_15vxxqm['get']['resBody'], BasicHeaders, Methods_15vxxqm['get']['status']>(prefix, prefix3, GET, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix3}`,
            };
          },
        },
      },
      erp: {
        approval_flows: {
          _id: (val3: number | string) => {
            const prefix3 = `${PATH11}/${val3}`;

            return {
              delete: (option?: { config?: T | undefined } | undefined) =>
                fetch<void, BasicHeaders, Methods_qq877u['delete']['status']>(prefix, prefix3, DELETE, option).send(),
              $delete: (option?: { config?: T | undefined } | undefined) =>
                fetch<void, BasicHeaders, Methods_qq877u['delete']['status']>(prefix, prefix3, DELETE, option).send().then(r => r.body),
              get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_qq877u['get']['resBody'], BasicHeaders, Methods_qq877u['get']['status']>(prefix, prefix3, GET, option).json(),
              $get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_qq877u['get']['resBody'], BasicHeaders, Methods_qq877u['get']['status']>(prefix, prefix3, GET, option).json().then(r => r.body),
              put: (option: { body: Methods_qq877u['put']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_qq877u['put']['resBody'], BasicHeaders, Methods_qq877u['put']['status']>(prefix, prefix3, PUT, option).json(),
              $put: (option: { body: Methods_qq877u['put']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_qq877u['put']['resBody'], BasicHeaders, Methods_qq877u['put']['status']>(prefix, prefix3, PUT, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix3}`,
            };
          },
          get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_1yczpa1['get']['resBody'], BasicHeaders, Methods_1yczpa1['get']['status']>(prefix, PATH11, GET, option).json(),
          $get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_1yczpa1['get']['resBody'], BasicHeaders, Methods_1yczpa1['get']['status']>(prefix, PATH11, GET, option).json().then(r => r.body),
          post: (option: { body: Methods_1yczpa1['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_1yczpa1['post']['resBody'], BasicHeaders, Methods_1yczpa1['post']['status']>(prefix, PATH11, POST, option).json(),
          $post: (option: { body: Methods_1yczpa1['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_1yczpa1['post']['resBody'], BasicHeaders, Methods_1yczpa1['post']['status']>(prefix, PATH11, POST, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH11}`,
        },
        custom_fields: {
          definitions: {
            _id: (val4: number | string) => {
              const prefix4 = `${PATH12}/${val4}`;

              return {
                delete: (option?: { config?: T | undefined } | undefined) =>
                  fetch<void, BasicHeaders, Methods_toxm3z['delete']['status']>(prefix, prefix4, DELETE, option).send(),
                $delete: (option?: { config?: T | undefined } | undefined) =>
                  fetch<void, BasicHeaders, Methods_toxm3z['delete']['status']>(prefix, prefix4, DELETE, option).send().then(r => r.body),
                put: (option: { body: Methods_toxm3z['put']['reqBody'], config?: T | undefined }) =>
                  fetch<Methods_toxm3z['put']['resBody'], BasicHeaders, Methods_toxm3z['put']['status']>(prefix, prefix4, PUT, option).json(),
                $put: (option: { body: Methods_toxm3z['put']['reqBody'], config?: T | undefined }) =>
                  fetch<Methods_toxm3z['put']['resBody'], BasicHeaders, Methods_toxm3z['put']['status']>(prefix, prefix4, PUT, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix4}`,
              };
            },
            get: (option?: { config?: T | undefined } | undefined) =>
              fetch<Methods_sb1j18['get']['resBody'], BasicHeaders, Methods_sb1j18['get']['status']>(prefix, PATH12, GET, option).json(),
            $get: (option?: { config?: T | undefined } | undefined) =>
              fetch<Methods_sb1j18['get']['resBody'], BasicHeaders, Methods_sb1j18['get']['status']>(prefix, PATH12, GET, option).json().then(r => r.body),
            post: (option: { body: Methods_sb1j18['post']['reqBody'], config?: T | undefined }) =>
              fetch<Methods_sb1j18['post']['resBody'], BasicHeaders, Methods_sb1j18['post']['status']>(prefix, PATH12, POST, option).json(),
            $post: (option: { body: Methods_sb1j18['post']['reqBody'], config?: T | undefined }) =>
              fetch<Methods_sb1j18['post']['resBody'], BasicHeaders, Methods_sb1j18['post']['status']>(prefix, PATH12, POST, option).json().then(r => r.body),
            $path: () => `${prefix}${PATH12}`,
          },
          values: {
            _entity_type: (val4: number | string) => {
              const prefix4 = `${PATH13}/${val4}`;

              return {
                _entity_id: (val5: number | string) => {
                  const prefix5 = `${prefix4}/${val5}`;

                  return {
                    get: (option?: { config?: T | undefined } | undefined) =>
                      fetch<Methods_1p1sdhl['get']['resBody'], BasicHeaders, Methods_1p1sdhl['get']['status']>(prefix, prefix5, GET, option).json(),
                    $get: (option?: { config?: T | undefined } | undefined) =>
                      fetch<Methods_1p1sdhl['get']['resBody'], BasicHeaders, Methods_1p1sdhl['get']['status']>(prefix, prefix5, GET, option).json().then(r => r.body),
                    put: (option: { body: Methods_1p1sdhl['put']['reqBody'], config?: T | undefined }) =>
                      fetch<Methods_1p1sdhl['put']['resBody'], BasicHeaders, Methods_1p1sdhl['put']['status']>(prefix, prefix5, PUT, option).json(),
                    $put: (option: { body: Methods_1p1sdhl['put']['reqBody'], config?: T | undefined }) =>
                      fetch<Methods_1p1sdhl['put']['resBody'], BasicHeaders, Methods_1p1sdhl['put']['status']>(prefix, prefix5, PUT, option).json().then(r => r.body),
                    $path: () => `${prefix}${prefix5}`,
                  };
                },
              };
            },
          },
        },
        expense_categories: {
          _id: (val3: number | string) => {
            const prefix3 = `${PATH14}/${val3}`;

            return {
              patch: (option: { body: Methods_1qwtrx6['patch']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_1qwtrx6['patch']['resBody'], BasicHeaders, Methods_1qwtrx6['patch']['status']>(prefix, prefix3, PATCH, option).json(),
              $patch: (option: { body: Methods_1qwtrx6['patch']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_1qwtrx6['patch']['resBody'], BasicHeaders, Methods_1qwtrx6['patch']['status']>(prefix, prefix3, PATCH, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix3}`,
            };
          },
          get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_u6icix['get']['resBody'], BasicHeaders, Methods_u6icix['get']['status']>(prefix, PATH14, GET, option).json(),
          $get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_u6icix['get']['resBody'], BasicHeaders, Methods_u6icix['get']['status']>(prefix, PATH14, GET, option).json().then(r => r.body),
          post: (option: { body: Methods_u6icix['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_u6icix['post']['resBody'], BasicHeaders, Methods_u6icix['post']['status']>(prefix, PATH14, POST, option).json(),
          $post: (option: { body: Methods_u6icix['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_u6icix['post']['resBody'], BasicHeaders, Methods_u6icix['post']['status']>(prefix, PATH14, POST, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH14}`,
        },
        expenses: {
          _id: (val3: number | string) => {
            const prefix3 = `${PATH15}/${val3}`;

            return {
              approve: {
                post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_ljp9de['post']['resBody'], BasicHeaders, Methods_ljp9de['post']['status']>(prefix, `${prefix3}${PATH16}`, POST, option).json(),
                $post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_ljp9de['post']['resBody'], BasicHeaders, Methods_ljp9de['post']['status']>(prefix, `${prefix3}${PATH16}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH16}`,
              },
              reject: {
                post: (option: { body: Methods_1lz0ovi['post']['reqBody'], config?: T | undefined }) =>
                  fetch<Methods_1lz0ovi['post']['resBody'], BasicHeaders, Methods_1lz0ovi['post']['status']>(prefix, `${prefix3}${PATH17}`, POST, option).json(),
                $post: (option: { body: Methods_1lz0ovi['post']['reqBody'], config?: T | undefined }) =>
                  fetch<Methods_1lz0ovi['post']['resBody'], BasicHeaders, Methods_1lz0ovi['post']['status']>(prefix, `${prefix3}${PATH17}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH17}`,
              },
              delete: (option?: { config?: T | undefined } | undefined) =>
                fetch<void, BasicHeaders, Methods_drme4g['delete']['status']>(prefix, prefix3, DELETE, option).send(),
              $delete: (option?: { config?: T | undefined } | undefined) =>
                fetch<void, BasicHeaders, Methods_drme4g['delete']['status']>(prefix, prefix3, DELETE, option).send().then(r => r.body),
              get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_drme4g['get']['resBody'], BasicHeaders, Methods_drme4g['get']['status']>(prefix, prefix3, GET, option).json(),
              $get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_drme4g['get']['resBody'], BasicHeaders, Methods_drme4g['get']['status']>(prefix, prefix3, GET, option).json().then(r => r.body),
              patch: (option: { body: Methods_drme4g['patch']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_drme4g['patch']['resBody'], BasicHeaders, Methods_drme4g['patch']['status']>(prefix, prefix3, PATCH, option).json(),
              $patch: (option: { body: Methods_drme4g['patch']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_drme4g['patch']['resBody'], BasicHeaders, Methods_drme4g['patch']['status']>(prefix, prefix3, PATCH, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix3}`,
            };
          },
          get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_d0cy6f['get']['resBody'], BasicHeaders, Methods_d0cy6f['get']['status']>(prefix, PATH15, GET, option).json(),
          $get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_d0cy6f['get']['resBody'], BasicHeaders, Methods_d0cy6f['get']['status']>(prefix, PATH15, GET, option).json().then(r => r.body),
          post: (option: { body: Methods_d0cy6f['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_d0cy6f['post']['resBody'], BasicHeaders, Methods_d0cy6f['post']['status']>(prefix, PATH15, POST, option).json(),
          $post: (option: { body: Methods_d0cy6f['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_d0cy6f['post']['resBody'], BasicHeaders, Methods_d0cy6f['post']['status']>(prefix, PATH15, POST, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH15}`,
        },
        purchase_orders: {
          _id: (val3: number | string) => {
            const prefix3 = `${PATH18}/${val3}`;

            return {
              get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_10av1nu['get']['resBody'], BasicHeaders, Methods_10av1nu['get']['status']>(prefix, prefix3, GET, option).json(),
              $get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_10av1nu['get']['resBody'], BasicHeaders, Methods_10av1nu['get']['status']>(prefix, prefix3, GET, option).json().then(r => r.body),
              patch: (option: { body: Methods_10av1nu['patch']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_10av1nu['patch']['resBody'], BasicHeaders, Methods_10av1nu['patch']['status']>(prefix, prefix3, PATCH, option).json(),
              $patch: (option: { body: Methods_10av1nu['patch']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_10av1nu['patch']['resBody'], BasicHeaders, Methods_10av1nu['patch']['status']>(prefix, prefix3, PATCH, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix3}`,
            };
          },
          get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_5biy3d['get']['resBody'], BasicHeaders, Methods_5biy3d['get']['status']>(prefix, PATH18, GET, option).json(),
          $get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_5biy3d['get']['resBody'], BasicHeaders, Methods_5biy3d['get']['status']>(prefix, PATH18, GET, option).json().then(r => r.body),
          post: (option: { body: Methods_5biy3d['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_5biy3d['post']['resBody'], BasicHeaders, Methods_5biy3d['post']['status']>(prefix, PATH18, POST, option).json(),
          $post: (option: { body: Methods_5biy3d['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_5biy3d['post']['resBody'], BasicHeaders, Methods_5biy3d['post']['status']>(prefix, PATH18, POST, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH18}`,
        },
        quotations: {
          _id: (val3: number | string) => {
            const prefix3 = `${PATH19}/${val3}`;

            return {
              convert_to_invoice: {
                post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_pafo0q['post']['resBody'], BasicHeaders, Methods_pafo0q['post']['status']>(prefix, `${prefix3}${PATH20}`, POST, option).json(),
                $post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_pafo0q['post']['resBody'], BasicHeaders, Methods_pafo0q['post']['status']>(prefix, `${prefix3}${PATH20}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH20}`,
              },
              get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_1gdewjm['get']['resBody'], BasicHeaders, Methods_1gdewjm['get']['status']>(prefix, prefix3, GET, option).json(),
              $get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_1gdewjm['get']['resBody'], BasicHeaders, Methods_1gdewjm['get']['status']>(prefix, prefix3, GET, option).json().then(r => r.body),
              patch: (option: { body: Methods_1gdewjm['patch']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_1gdewjm['patch']['resBody'], BasicHeaders, Methods_1gdewjm['patch']['status']>(prefix, prefix3, PATCH, option).json(),
              $patch: (option: { body: Methods_1gdewjm['patch']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_1gdewjm['patch']['resBody'], BasicHeaders, Methods_1gdewjm['patch']['status']>(prefix, prefix3, PATCH, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix3}`,
            };
          },
          get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_sbfxep['get']['resBody'], BasicHeaders, Methods_sbfxep['get']['status']>(prefix, PATH19, GET, option).json(),
          $get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_sbfxep['get']['resBody'], BasicHeaders, Methods_sbfxep['get']['status']>(prefix, PATH19, GET, option).json().then(r => r.body),
          post: (option: { body: Methods_sbfxep['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_sbfxep['post']['resBody'], BasicHeaders, Methods_sbfxep['post']['status']>(prefix, PATH19, POST, option).json(),
          $post: (option: { body: Methods_sbfxep['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_sbfxep['post']['resBody'], BasicHeaders, Methods_sbfxep['post']['status']>(prefix, PATH19, POST, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH19}`,
        },
        vendors: {
          _id: (val3: number | string) => {
            const prefix3 = `${PATH21}/${val3}`;

            return {
              get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_1ghhl1y['get']['resBody'], BasicHeaders, Methods_1ghhl1y['get']['status']>(prefix, prefix3, GET, option).json(),
              $get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_1ghhl1y['get']['resBody'], BasicHeaders, Methods_1ghhl1y['get']['status']>(prefix, prefix3, GET, option).json().then(r => r.body),
              patch: (option: { body: Methods_1ghhl1y['patch']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_1ghhl1y['patch']['resBody'], BasicHeaders, Methods_1ghhl1y['patch']['status']>(prefix, prefix3, PATCH, option).json(),
              $patch: (option: { body: Methods_1ghhl1y['patch']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_1ghhl1y['patch']['resBody'], BasicHeaders, Methods_1ghhl1y['patch']['status']>(prefix, prefix3, PATCH, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix3}`,
            };
          },
          get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_9dyjgt['get']['resBody'], BasicHeaders, Methods_9dyjgt['get']['status']>(prefix, PATH21, GET, option).json(),
          $get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_9dyjgt['get']['resBody'], BasicHeaders, Methods_9dyjgt['get']['status']>(prefix, PATH21, GET, option).json().then(r => r.body),
          post: (option: { body: Methods_9dyjgt['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_9dyjgt['post']['resBody'], BasicHeaders, Methods_9dyjgt['post']['status']>(prefix, PATH21, POST, option).json(),
          $post: (option: { body: Methods_9dyjgt['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_9dyjgt['post']['resBody'], BasicHeaders, Methods_9dyjgt['post']['status']>(prefix, PATH21, POST, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH21}`,
        },
      },
      field: {
        api_keys: {
          _id: (val3: string) => {
            const prefix3 = `${PATH22}/${val3}`;

            return {
              revoke: {
                /**
                 * @returns Revoked
                 */
                post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_thxi4x['post']['resBody'], BasicHeaders, Methods_thxi4x['post']['status']>(prefix, `${prefix3}${PATH23}`, POST, option).json(),
                /**
                 * @returns Revoked
                 */
                $post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_thxi4x['post']['resBody'], BasicHeaders, Methods_thxi4x['post']['status']>(prefix, `${prefix3}${PATH23}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH23}`,
              },
              /**
               * @returns Deleted
               */
              delete: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_1g5sena['delete']['resBody'], BasicHeaders, Methods_1g5sena['delete']['status']>(prefix, prefix3, DELETE, option).json(),
              /**
               * @returns Deleted
               */
              $delete: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_1g5sena['delete']['resBody'], BasicHeaders, Methods_1g5sena['delete']['status']>(prefix, prefix3, DELETE, option).json().then(r => r.body),
              /**
               * @returns API key detail
               */
              get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_1g5sena['get']['resBody'], BasicHeaders, Methods_1g5sena['get']['status']>(prefix, prefix3, GET, option).json(),
              /**
               * @returns API key detail
               */
              $get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_1g5sena['get']['resBody'], BasicHeaders, Methods_1g5sena['get']['status']>(prefix, prefix3, GET, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix3}`,
            };
          },
          /**
           * @returns API key list
           */
          get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_12bpkau['get']['resBody'], BasicHeaders, Methods_12bpkau['get']['status']>(prefix, PATH22, GET, option).json(),
          /**
           * @returns API key list
           */
          $get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_12bpkau['get']['resBody'], BasicHeaders, Methods_12bpkau['get']['status']>(prefix, PATH22, GET, option).json().then(r => r.body),
          /**
           * @returns API key created
           */
          post: (option: { body: Methods_12bpkau['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_12bpkau['post']['resBody'], BasicHeaders, Methods_12bpkau['post']['status']>(prefix, PATH22, POST, option).json(),
          /**
           * @returns API key created
           */
          $post: (option: { body: Methods_12bpkau['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_12bpkau['post']['resBody'], BasicHeaders, Methods_12bpkau['post']['status']>(prefix, PATH22, POST, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH22}`,
        },
        billing_accounts: {
          _id: (val3: string) => {
            const prefix3 = `${PATH24}/${val3}`;

            return {
              operators: {
                _operator_id: (val5: string) => {
                  const prefix5 = `${prefix3}${PATH25}/${val5}`;

                  return {
                    /**
                     * @returns Operator removed
                     */
                    delete: (option?: { config?: T | undefined } | undefined) =>
                      fetch<Methods_1yigpjw['delete']['resBody'], BasicHeaders, Methods_1yigpjw['delete']['status']>(prefix, prefix5, DELETE, option).json(),
                    /**
                     * @returns Operator removed
                     */
                    $delete: (option?: { config?: T | undefined } | undefined) =>
                      fetch<Methods_1yigpjw['delete']['resBody'], BasicHeaders, Methods_1yigpjw['delete']['status']>(prefix, prefix5, DELETE, option).json().then(r => r.body),
                    $path: () => `${prefix}${prefix5}`,
                  };
                },
                /**
                 * @returns Operator list
                 */
                get: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_3jwkjr['get']['resBody'], BasicHeaders, Methods_3jwkjr['get']['status']>(prefix, `${prefix3}${PATH25}`, GET, option).json(),
                /**
                 * @returns Operator list
                 */
                $get: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_3jwkjr['get']['resBody'], BasicHeaders, Methods_3jwkjr['get']['status']>(prefix, `${prefix3}${PATH25}`, GET, option).json().then(r => r.body),
                /**
                 * @returns Operator added
                 */
                post: (option: { body: Methods_3jwkjr['post']['reqBody'], config?: T | undefined }) =>
                  fetch<Methods_3jwkjr['post']['resBody'], BasicHeaders, Methods_3jwkjr['post']['status']>(prefix, `${prefix3}${PATH25}`, POST, option).json(),
                /**
                 * @returns Operator added
                 */
                $post: (option: { body: Methods_3jwkjr['post']['reqBody'], config?: T | undefined }) =>
                  fetch<Methods_3jwkjr['post']['resBody'], BasicHeaders, Methods_3jwkjr['post']['status']>(prefix, `${prefix3}${PATH25}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH25}`,
              },
              /**
               * @returns Billing account detail
               */
              get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_g0yc1x['get']['resBody'], BasicHeaders, Methods_g0yc1x['get']['status']>(prefix, prefix3, GET, option).json(),
              /**
               * @returns Billing account detail
               */
              $get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_g0yc1x['get']['resBody'], BasicHeaders, Methods_g0yc1x['get']['status']>(prefix, prefix3, GET, option).json().then(r => r.body),
              /**
               * @returns Billing account updated
               */
              put: (option: { body: Methods_g0yc1x['put']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_g0yc1x['put']['resBody'], BasicHeaders, Methods_g0yc1x['put']['status']>(prefix, prefix3, PUT, option).json(),
              /**
               * @returns Billing account updated
               */
              $put: (option: { body: Methods_g0yc1x['put']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_g0yc1x['put']['resBody'], BasicHeaders, Methods_g0yc1x['put']['status']>(prefix, prefix3, PUT, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix3}`,
            };
          },
          /**
           * @returns Billing account list
           */
          get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_3u7uaz['get']['resBody'], BasicHeaders, Methods_3u7uaz['get']['status']>(prefix, PATH24, GET, option).json(),
          /**
           * @returns Billing account list
           */
          $get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_3u7uaz['get']['resBody'], BasicHeaders, Methods_3u7uaz['get']['status']>(prefix, PATH24, GET, option).json().then(r => r.body),
          /**
           * @returns Billing account created
           */
          post: (option: { body: Methods_3u7uaz['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_3u7uaz['post']['resBody'], BasicHeaders, Methods_3u7uaz['post']['status']>(prefix, PATH24, POST, option).json(),
          /**
           * @returns Billing account created
           */
          $post: (option: { body: Methods_3u7uaz['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_3u7uaz['post']['resBody'], BasicHeaders, Methods_3u7uaz['post']['status']>(prefix, PATH24, POST, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH24}`,
        },
        orders: {
          batch: {
            cancel_expired: {
              /**
               * Returns the number of orders cancelled.
               * @returns Cancelled expired orders
               */
              post: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_15ucmd2['post']['resBody'], BasicHeaders, Methods_15ucmd2['post']['status']>(prefix, PATH26, POST, option).json(),
              /**
               * Returns the number of orders cancelled.
               * @returns Cancelled expired orders
               */
              $post: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_15ucmd2['post']['resBody'], BasicHeaders, Methods_15ucmd2['post']['status']>(prefix, PATH26, POST, option).json().then(r => r.body),
              $path: () => `${prefix}${PATH26}`,
            },
          },
        },
        reports: {
          payout: {
            /**
             * @returns Payout report
             */
            get: (option?: { config?: T | undefined } | undefined) =>
              fetch<Methods_1sk027z['get']['resBody'], BasicHeaders, Methods_1sk027z['get']['status']>(prefix, PATH27, GET, option).json(),
            /**
             * @returns Payout report
             */
            $get: (option?: { config?: T | undefined } | undefined) =>
              fetch<Methods_1sk027z['get']['resBody'], BasicHeaders, Methods_1sk027z['get']['status']>(prefix, PATH27, GET, option).json().then(r => r.body),
            $path: () => `${prefix}${PATH27}`,
          },
          payout_csv: {
            get: (option?: { config?: T | undefined } | undefined) =>
              fetch<void, BasicHeaders, Methods_116wzil['get']['status']>(prefix, PATH28, GET, option).send(),
            $get: (option?: { config?: T | undefined } | undefined) =>
              fetch<void, BasicHeaders, Methods_116wzil['get']['status']>(prefix, PATH28, GET, option).send().then(r => r.body),
            $path: () => `${prefix}${PATH28}`,
          },
        },
      },
      invoice_reconciliations: {
        square_payments: {
          _square_payment_id: (val3: number | string) => {
            const prefix3 = `${PATH29}/${val3}`;

            return {
              reconcile: {
                post: (option: { body: Methods_1pyisgt['post']['reqBody'], config?: T | undefined }) =>
                  fetch<Methods_1pyisgt['post']['resBody'], BasicHeaders, Methods_1pyisgt['post']['status']>(prefix, `${prefix3}${PATH30}`, POST, option).json(),
                $post: (option: { body: Methods_1pyisgt['post']['reqBody'], config?: T | undefined }) =>
                  fetch<Methods_1pyisgt['post']['resBody'], BasicHeaders, Methods_1pyisgt['post']['status']>(prefix, `${prefix3}${PATH30}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH30}`,
              },
            };
          },
          get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_3g9t7m['get']['resBody'], BasicHeaders, Methods_3g9t7m['get']['status']>(prefix, PATH29, GET, option).json(),
          $get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_3g9t7m['get']['resBody'], BasicHeaders, Methods_3g9t7m['get']['status']>(prefix, PATH29, GET, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH29}`,
        },
      },
      invoices: {
        _id: (val2: number | string) => {
          const prefix2 = `${PATH31}/${val2}`;

          return {
            follow_up_status: {
              post: (option: { body: Methods_1ho9em6['post']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_1ho9em6['post']['resBody'], BasicHeaders, Methods_1ho9em6['post']['status']>(prefix, `${prefix2}${PATH32}`, POST, option).json(),
              $post: (option: { body: Methods_1ho9em6['post']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_1ho9em6['post']['resBody'], BasicHeaders, Methods_1ho9em6['post']['status']>(prefix, `${prefix2}${PATH32}`, POST, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix2}${PATH32}`,
            },
            payment_link: {
              resend: {
                post: (option: { body: Methods_157cr75['post']['reqBody'], config?: T | undefined }) =>
                  fetch<Methods_157cr75['post']['resBody'], BasicHeaders, Methods_157cr75['post']['status']>(prefix, `${prefix2}${PATH33}`, POST, option).json(),
                $post: (option: { body: Methods_157cr75['post']['reqBody'], config?: T | undefined }) =>
                  fetch<Methods_157cr75['post']['resBody'], BasicHeaders, Methods_157cr75['post']['status']>(prefix, `${prefix2}${PATH33}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix2}${PATH33}`,
              },
            },
            delete: (option?: { config?: T | undefined } | undefined) =>
              fetch<Methods_vh2uiz['delete']['resBody'], BasicHeaders, Methods_vh2uiz['delete']['status']>(prefix, prefix2, DELETE, option).json(),
            $delete: (option?: { config?: T | undefined } | undefined) =>
              fetch<Methods_vh2uiz['delete']['resBody'], BasicHeaders, Methods_vh2uiz['delete']['status']>(prefix, prefix2, DELETE, option).json().then(r => r.body),
            get: (option?: { config?: T | undefined } | undefined) =>
              fetch<Methods_vh2uiz['get']['resBody'], BasicHeaders, Methods_vh2uiz['get']['status']>(prefix, prefix2, GET, option).json(),
            $get: (option?: { config?: T | undefined } | undefined) =>
              fetch<Methods_vh2uiz['get']['resBody'], BasicHeaders, Methods_vh2uiz['get']['status']>(prefix, prefix2, GET, option).json().then(r => r.body),
            patch: (option: { body: Methods_vh2uiz['patch']['reqBody'], config?: T | undefined }) =>
              fetch<Methods_vh2uiz['patch']['resBody'], BasicHeaders, Methods_vh2uiz['patch']['status']>(prefix, prefix2, PATCH, option).json(),
            $patch: (option: { body: Methods_vh2uiz['patch']['reqBody'], config?: T | undefined }) =>
              fetch<Methods_vh2uiz['patch']['resBody'], BasicHeaders, Methods_vh2uiz['patch']['status']>(prefix, prefix2, PATCH, option).json().then(r => r.body),
            $path: () => `${prefix}${prefix2}`,
          };
        },
        get: (option?: { config?: T | undefined } | undefined) =>
          fetch<Methods_2gd440['get']['resBody'], BasicHeaders, Methods_2gd440['get']['status']>(prefix, PATH31, GET, option).json(),
        $get: (option?: { config?: T | undefined } | undefined) =>
          fetch<Methods_2gd440['get']['resBody'], BasicHeaders, Methods_2gd440['get']['status']>(prefix, PATH31, GET, option).json().then(r => r.body),
        post: (option: { body: Methods_2gd440['post']['reqBody'], config?: T | undefined }) =>
          fetch<Methods_2gd440['post']['resBody'], BasicHeaders, Methods_2gd440['post']['status']>(prefix, PATH31, POST, option).json(),
        $post: (option: { body: Methods_2gd440['post']['reqBody'], config?: T | undefined }) =>
          fetch<Methods_2gd440['post']['resBody'], BasicHeaders, Methods_2gd440['post']['status']>(prefix, PATH31, POST, option).json().then(r => r.body),
        $path: () => `${prefix}${PATH31}`,
      },
      payment_links: {
        post: (option: { body: Methods_fpp8d6['post']['reqBody'], config?: T | undefined }) =>
          fetch<Methods_fpp8d6['post']['resBody'], BasicHeaders, Methods_fpp8d6['post']['status']>(prefix, PATH34, POST, option).json(),
        $post: (option: { body: Methods_fpp8d6['post']['reqBody'], config?: T | undefined }) =>
          fetch<Methods_fpp8d6['post']['resBody'], BasicHeaders, Methods_fpp8d6['post']['status']>(prefix, PATH34, POST, option).json().then(r => r.body),
        $path: () => `${prefix}${PATH34}`,
      },
      public: {
        invoices: {
          _id: (val3: number | string) => {
            const prefix3 = `${PATH35}/${val3}`;

            return {
              checkout: {
                post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_2tlcqe['post']['resBody'], BasicHeaders, Methods_2tlcqe['post']['status']>(prefix, `${prefix3}${PATH36}`, POST, option).json(),
                $post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_2tlcqe['post']['resBody'], BasicHeaders, Methods_2tlcqe['post']['status']>(prefix, `${prefix3}${PATH36}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH36}`,
              },
              payment_intent: {
                post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_146tow5['post']['resBody'], BasicHeaders, Methods_146tow5['post']['status']>(prefix, `${prefix3}${PATH37}`, POST, option).json(),
                $post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_146tow5['post']['resBody'], BasicHeaders, Methods_146tow5['post']['status']>(prefix, `${prefix3}${PATH37}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH37}`,
              },
              stripe_publishable_key: {
                get: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_oz7ukb['get']['resBody'], BasicHeaders, Methods_oz7ukb['get']['status']>(prefix, `${prefix3}${PATH38}`, GET, option).json(),
                $get: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_oz7ukb['get']['resBody'], BasicHeaders, Methods_oz7ukb['get']['status']>(prefix, `${prefix3}${PATH38}`, GET, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH38}`,
              },
              get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_a9x389['get']['resBody'], BasicHeaders, Methods_a9x389['get']['status']>(prefix, prefix3, GET, option).json(),
              $get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_a9x389['get']['resBody'], BasicHeaders, Methods_a9x389['get']['status']>(prefix, prefix3, GET, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix3}`,
            };
          },
          _tenant_id: (val3: number | string) => {
            const prefix3 = `${PATH35}/${val3}`;

            return {
              _id: (val4: number | string) => {
                const prefix4 = `${prefix3}/${val4}`;

                return {
                  checkout: {
                    post: (option?: { config?: T | undefined } | undefined) =>
                      fetch<Methods_bnn7xw['post']['resBody'], BasicHeaders, Methods_bnn7xw['post']['status']>(prefix, `${prefix4}${PATH36}`, POST, option).json(),
                    $post: (option?: { config?: T | undefined } | undefined) =>
                      fetch<Methods_bnn7xw['post']['resBody'], BasicHeaders, Methods_bnn7xw['post']['status']>(prefix, `${prefix4}${PATH36}`, POST, option).json().then(r => r.body),
                    $path: () => `${prefix}${prefix4}${PATH36}`,
                  },
                  payment_intent: {
                    post: (option?: { config?: T | undefined } | undefined) =>
                      fetch<Methods_1t91ofz['post']['resBody'], BasicHeaders, Methods_1t91ofz['post']['status']>(prefix, `${prefix4}${PATH37}`, POST, option).json(),
                    $post: (option?: { config?: T | undefined } | undefined) =>
                      fetch<Methods_1t91ofz['post']['resBody'], BasicHeaders, Methods_1t91ofz['post']['status']>(prefix, `${prefix4}${PATH37}`, POST, option).json().then(r => r.body),
                    $path: () => `${prefix}${prefix4}${PATH37}`,
                  },
                  stripe_publishable_key: {
                    get: (option?: { config?: T | undefined } | undefined) =>
                      fetch<Methods_1b44ey9['get']['resBody'], BasicHeaders, Methods_1b44ey9['get']['status']>(prefix, `${prefix4}${PATH38}`, GET, option).json(),
                    $get: (option?: { config?: T | undefined } | undefined) =>
                      fetch<Methods_1b44ey9['get']['resBody'], BasicHeaders, Methods_1b44ey9['get']['status']>(prefix, `${prefix4}${PATH38}`, GET, option).json().then(r => r.body),
                    $path: () => `${prefix}${prefix4}${PATH38}`,
                  },
                  get: (option?: { config?: T | undefined } | undefined) =>
                    fetch<Methods_6aml7b['get']['resBody'], BasicHeaders, Methods_6aml7b['get']['status']>(prefix, prefix4, GET, option).json(),
                  $get: (option?: { config?: T | undefined } | undefined) =>
                    fetch<Methods_6aml7b['get']['resBody'], BasicHeaders, Methods_6aml7b['get']['status']>(prefix, prefix4, GET, option).json().then(r => r.body),
                  $path: () => `${prefix}${prefix4}`,
                };
              },
            };
          },
        },
      },
      storekit: {
        carts: {
          _cart_id: (val3: string) => {
            const prefix3 = `${PATH39}/${val3}`;

            return {
              clear: {
                post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_1ypp2hw['post']['resBody'], BasicHeaders, Methods_1ypp2hw['post']['status']>(prefix, `${prefix3}${PATH40}`, POST, option).json(),
                $post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_1ypp2hw['post']['resBody'], BasicHeaders, Methods_1ypp2hw['post']['status']>(prefix, `${prefix3}${PATH40}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH40}`,
              },
              items: {
                _item_id: (val5: string) => {
                  const prefix5 = `${prefix3}${PATH41}/${val5}`;

                  return {
                    delete: (option?: { config?: T | undefined } | undefined) =>
                      fetch<Methods_17ixyp1['delete']['resBody'], BasicHeaders, Methods_17ixyp1['delete']['status']>(prefix, prefix5, DELETE, option).json(),
                    $delete: (option?: { config?: T | undefined } | undefined) =>
                      fetch<Methods_17ixyp1['delete']['resBody'], BasicHeaders, Methods_17ixyp1['delete']['status']>(prefix, prefix5, DELETE, option).json().then(r => r.body),
                    post: (option: { body: Methods_17ixyp1['post']['reqBody'], config?: T | undefined }) =>
                      fetch<Methods_17ixyp1['post']['resBody'], BasicHeaders, Methods_17ixyp1['post']['status']>(prefix, prefix5, POST, option).json(),
                    $post: (option: { body: Methods_17ixyp1['post']['reqBody'], config?: T | undefined }) =>
                      fetch<Methods_17ixyp1['post']['resBody'], BasicHeaders, Methods_17ixyp1['post']['status']>(prefix, prefix5, POST, option).json().then(r => r.body),
                    $path: () => `${prefix}${prefix5}`,
                  };
                },
                post: (option: { body: Methods_1g07b25['post']['reqBody'], config?: T | undefined }) =>
                  fetch<Methods_1g07b25['post']['resBody'], BasicHeaders, Methods_1g07b25['post']['status']>(prefix, `${prefix3}${PATH41}`, POST, option).json(),
                $post: (option: { body: Methods_1g07b25['post']['reqBody'], config?: T | undefined }) =>
                  fetch<Methods_1g07b25['post']['resBody'], BasicHeaders, Methods_1g07b25['post']['status']>(prefix, `${prefix3}${PATH41}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH41}`,
              },
              get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_wk8snq['get']['resBody'], BasicHeaders, Methods_wk8snq['get']['status']>(prefix, prefix3, GET, option).json(),
              $get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_wk8snq['get']['resBody'], BasicHeaders, Methods_wk8snq['get']['status']>(prefix, prefix3, GET, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix3}`,
            };
          },
          post: (option: { body: Methods_c8zw0b['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_c8zw0b['post']['resBody'], BasicHeaders, Methods_c8zw0b['post']['status']>(prefix, PATH39, POST, option).json(),
          $post: (option: { body: Methods_c8zw0b['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_c8zw0b['post']['resBody'], BasicHeaders, Methods_c8zw0b['post']['status']>(prefix, PATH39, POST, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH39}`,
        },
        categories: {
          get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_6wsnaw['get']['resBody'], BasicHeaders, Methods_6wsnaw['get']['status']>(prefix, PATH42, GET, option).json(),
          $get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_6wsnaw['get']['resBody'], BasicHeaders, Methods_6wsnaw['get']['status']>(prefix, PATH42, GET, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH42}`,
        },
        checkout_sessions: {
          _order_id: (val3: string) => {
            const prefix3 = `${PATH43}/${val3}`;

            return {
              confirm: {
                post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_r0y174['post']['resBody'], BasicHeaders, Methods_r0y174['post']['status']>(prefix, `${prefix3}${PATH44}`, POST, option).json(),
                $post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_r0y174['post']['resBody'], BasicHeaders, Methods_r0y174['post']['status']>(prefix, `${prefix3}${PATH44}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH44}`,
              },
            };
          },
          post: (option: { body: Methods_491zr8['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_491zr8['post']['resBody'], BasicHeaders, Methods_491zr8['post']['status']>(prefix, PATH43, POST, option).json(),
          $post: (option: { body: Methods_491zr8['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_491zr8['post']['resBody'], BasicHeaders, Methods_491zr8['post']['status']>(prefix, PATH43, POST, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH43}`,
        },
        consumer_orders: {
          _order_id: (val3: string) => {
            const prefix3 = `${PATH45}/${val3}`;

            return {
              receipt: {
                get: (option?: { config?: T | undefined } | undefined) =>
                  fetch<void, BasicHeaders, Methods_orhpu6['get']['status']>(prefix, `${prefix3}${PATH46}`, GET, option).send(),
                $get: (option?: { config?: T | undefined } | undefined) =>
                  fetch<void, BasicHeaders, Methods_orhpu6['get']['status']>(prefix, `${prefix3}${PATH46}`, GET, option).send().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH46}`,
              },
            };
          },
        },
        coupons: {
          validate: {
            post: (option: { body: Methods_11qo83i['post']['reqBody'], config?: T | undefined }) =>
              fetch<Methods_11qo83i['post']['resBody'], BasicHeaders, Methods_11qo83i['post']['status']>(prefix, PATH47, POST, option).json(),
            $post: (option: { body: Methods_11qo83i['post']['reqBody'], config?: T | undefined }) =>
              fetch<Methods_11qo83i['post']['resBody'], BasicHeaders, Methods_11qo83i['post']['status']>(prefix, PATH47, POST, option).json().then(r => r.body),
            $path: () => `${prefix}${PATH47}`,
          },
        },
        customers: {
          _customer_id: (val3: string) => {
            const prefix3 = `${PATH48}/${val3}`;

            return {
              delete: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_zdpb96['delete']['resBody'], BasicHeaders, Methods_zdpb96['delete']['status']>(prefix, prefix3, DELETE, option).json(),
              $delete: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_zdpb96['delete']['resBody'], BasicHeaders, Methods_zdpb96['delete']['status']>(prefix, prefix3, DELETE, option).json().then(r => r.body),
              get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_zdpb96['get']['resBody'], BasicHeaders, Methods_zdpb96['get']['status']>(prefix, prefix3, GET, option).json(),
              $get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_zdpb96['get']['resBody'], BasicHeaders, Methods_zdpb96['get']['status']>(prefix, prefix3, GET, option).json().then(r => r.body),
              post: (option: { body: Methods_zdpb96['post']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_zdpb96['post']['resBody'], BasicHeaders, Methods_zdpb96['post']['status']>(prefix, prefix3, POST, option).json(),
              $post: (option: { body: Methods_zdpb96['post']['reqBody'], config?: T | undefined }) =>
                fetch<Methods_zdpb96['post']['resBody'], BasicHeaders, Methods_zdpb96['post']['status']>(prefix, prefix3, POST, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix3}`,
            };
          },
          get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_1wp9lcl['get']['resBody'], BasicHeaders, Methods_1wp9lcl['get']['status']>(prefix, PATH48, GET, option).json(),
          $get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_1wp9lcl['get']['resBody'], BasicHeaders, Methods_1wp9lcl['get']['status']>(prefix, PATH48, GET, option).json().then(r => r.body),
          post: (option: { body: Methods_1wp9lcl['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_1wp9lcl['post']['resBody'], BasicHeaders, Methods_1wp9lcl['post']['status']>(prefix, PATH48, POST, option).json(),
          $post: (option: { body: Methods_1wp9lcl['post']['reqBody'], config?: T | undefined }) =>
            fetch<Methods_1wp9lcl['post']['resBody'], BasicHeaders, Methods_1wp9lcl['post']['status']>(prefix, PATH48, POST, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH48}`,
        },
        fulfillment_methods: {
          get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_1dc5nat['get']['resBody'], BasicHeaders, Methods_1dc5nat['get']['status']>(prefix, PATH49, GET, option).json(),
          $get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_1dc5nat['get']['resBody'], BasicHeaders, Methods_1dc5nat['get']['status']>(prefix, PATH49, GET, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH49}`,
        },
        orders: {
          _order_id: (val3: string) => {
            const prefix3 = `${PATH50}/${val3}`;

            return {
              cancel: {
                post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_19hq73b['post']['resBody'], BasicHeaders, Methods_19hq73b['post']['status']>(prefix, `${prefix3}${PATH51}`, POST, option).json(),
                $post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_19hq73b['post']['resBody'], BasicHeaders, Methods_19hq73b['post']['status']>(prefix, `${prefix3}${PATH51}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH51}`,
              },
              deliver: {
                post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_1q9em5e['post']['resBody'], BasicHeaders, Methods_1q9em5e['post']['status']>(prefix, `${prefix3}${PATH52}`, POST, option).json(),
                $post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_1q9em5e['post']['resBody'], BasicHeaders, Methods_1q9em5e['post']['status']>(prefix, `${prefix3}${PATH52}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH52}`,
              },
              pickup: {
                post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_1o8i9rl['post']['resBody'], BasicHeaders, Methods_1o8i9rl['post']['status']>(prefix, `${prefix3}${PATH53}`, POST, option).json(),
                $post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_1o8i9rl['post']['resBody'], BasicHeaders, Methods_1o8i9rl['post']['status']>(prefix, `${prefix3}${PATH53}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH53}`,
              },
              prepare: {
                post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_2y84lk['post']['resBody'], BasicHeaders, Methods_2y84lk['post']['status']>(prefix, `${prefix3}${PATH54}`, POST, option).json(),
                $post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_2y84lk['post']['resBody'], BasicHeaders, Methods_2y84lk['post']['status']>(prefix, `${prefix3}${PATH54}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH54}`,
              },
              ready: {
                post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_16kz8kw['post']['resBody'], BasicHeaders, Methods_16kz8kw['post']['status']>(prefix, `${prefix3}${PATH55}`, POST, option).json(),
                $post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_16kz8kw['post']['resBody'], BasicHeaders, Methods_16kz8kw['post']['status']>(prefix, `${prefix3}${PATH55}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH55}`,
              },
              refund: {
                post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_1ie7yy3['post']['resBody'], BasicHeaders, Methods_1ie7yy3['post']['status']>(prefix, `${prefix3}${PATH56}`, POST, option).json(),
                $post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_1ie7yy3['post']['resBody'], BasicHeaders, Methods_1ie7yy3['post']['status']>(prefix, `${prefix3}${PATH56}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH56}`,
              },
              select_pickup_datetime: {
                post: (option: { body: Methods_jpnprm['post']['reqBody'], config?: T | undefined }) =>
                  fetch<Methods_jpnprm['post']['resBody'], BasicHeaders, Methods_jpnprm['post']['status']>(prefix, `${prefix3}${PATH57}`, POST, option).json(),
                $post: (option: { body: Methods_jpnprm['post']['reqBody'], config?: T | undefined }) =>
                  fetch<Methods_jpnprm['post']['resBody'], BasicHeaders, Methods_jpnprm['post']['status']>(prefix, `${prefix3}${PATH57}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH57}`,
              },
              ship: {
                post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_1kc978j['post']['resBody'], BasicHeaders, Methods_1kc978j['post']['status']>(prefix, `${prefix3}${PATH58}`, POST, option).json(),
                $post: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_1kc978j['post']['resBody'], BasicHeaders, Methods_1kc978j['post']['status']>(prefix, `${prefix3}${PATH58}`, POST, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH58}`,
              },
              get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_1n5rgsc['get']['resBody'], BasicHeaders, Methods_1n5rgsc['get']['status']>(prefix, prefix3, GET, option).json(),
              $get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_1n5rgsc['get']['resBody'], BasicHeaders, Methods_1n5rgsc['get']['status']>(prefix, prefix3, GET, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix3}`,
            };
          },
          get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_u88nfx['get']['resBody'], BasicHeaders, Methods_u88nfx['get']['status']>(prefix, PATH50, GET, option).json(),
          $get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_u88nfx['get']['resBody'], BasicHeaders, Methods_u88nfx['get']['status']>(prefix, PATH50, GET, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH50}`,
        },
        products: {
          _product_id: (val3: string) => {
            const prefix3 = `${PATH59}/${val3}`;

            return {
              stock: {
                get: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_7jjhsp['get']['resBody'], BasicHeaders, Methods_7jjhsp['get']['status']>(prefix, `${prefix3}${PATH60}`, GET, option).json(),
                $get: (option?: { config?: T | undefined } | undefined) =>
                  fetch<Methods_7jjhsp['get']['resBody'], BasicHeaders, Methods_7jjhsp['get']['status']>(prefix, `${prefix3}${PATH60}`, GET, option).json().then(r => r.body),
                $path: () => `${prefix}${prefix3}${PATH60}`,
              },
              get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_t1wq2s['get']['resBody'], BasicHeaders, Methods_t1wq2s['get']['status']>(prefix, prefix3, GET, option).json(),
              $get: (option?: { config?: T | undefined } | undefined) =>
                fetch<Methods_t1wq2s['get']['resBody'], BasicHeaders, Methods_t1wq2s['get']['status']>(prefix, prefix3, GET, option).json().then(r => r.body),
              $path: () => `${prefix}${prefix3}`,
            };
          },
          get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_9wxfhk['get']['resBody'], BasicHeaders, Methods_9wxfhk['get']['status']>(prefix, PATH59, GET, option).json(),
          $get: (option?: { config?: T | undefined } | undefined) =>
            fetch<Methods_9wxfhk['get']['resBody'], BasicHeaders, Methods_9wxfhk['get']['status']>(prefix, PATH59, GET, option).json().then(r => r.body),
          $path: () => `${prefix}${PATH59}`,
        },
      },
    },
  };
};

export type ApiInstance = ReturnType<typeof api>;
export default api;
