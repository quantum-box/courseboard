/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../@types';

export type Methods = DefineMethods<{
  delete: {
    status: 200;
    resBody: Types.DeleteInvoiceResponse;
  };

  get: {
    status: 200;
    resBody: Types.InvoiceResponse;
  };

  patch: {
    status: 200;
    resBody: Types.InvoiceResponse;
    reqBody: Types.UpdateInvoiceRequest;
  };
}>;
