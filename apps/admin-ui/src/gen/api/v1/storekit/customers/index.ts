/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../@types';

export type Methods = DefineMethods<{
  get: {
    status: 200;
    resBody: Types.StoreKitList_CustomerResponse;
  };

  post: {
    status: 200;
    resBody: Types.CustomerResponse;
    reqBody: Types.CreateCustomerRequest;
  };
}>;
