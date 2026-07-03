/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../../@types';

export type Methods = DefineMethods<{
  delete: {
    status: 200;
    resBody: Types.DeletedResponse;
  };

  get: {
    status: 200;
    resBody: Types.CustomerResponse;
  };

  post: {
    status: 200;
    resBody: Types.CustomerResponse;
    reqBody: Types.UpdateCustomerRequest;
  };
}>;
