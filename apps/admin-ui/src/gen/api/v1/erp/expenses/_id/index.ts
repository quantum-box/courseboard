/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../../@types';

export type Methods = DefineMethods<{
  delete: {
    status: 204;
  };

  get: {
    status: 200;
    resBody: Types.ExpenseResponse;
  };

  patch: {
    status: 200;
    resBody: Types.ExpenseResponse;
    reqBody: Types.UpdateExpenseRequest;
  };
}>;
