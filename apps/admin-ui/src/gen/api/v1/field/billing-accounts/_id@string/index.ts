/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../../@types';

export type Methods = DefineMethods<{
  get: {
    status: 200;
    /** Billing account detail */
    resBody: Types.BillingAccountResponse;
  };

  put: {
    status: 200;
    /** Billing account updated */
    resBody: Types.BillingAccountResponse;
    reqBody: Types.UpdateBillingAccountRequest;
  };
}>;
