/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../@types';

export type Methods = DefineMethods<{
  get: {
    status: 200;
    /** Billing account list */
    resBody: Types.BillingAccountResponse[];
  };

  post: {
    status: 201;
    /** Billing account created */
    resBody: Types.BillingAccountResponse;
    reqBody: Types.CreateBillingAccountRequest;
  };
}>;
