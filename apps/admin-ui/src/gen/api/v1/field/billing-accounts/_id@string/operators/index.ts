/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../../../@types';

export type Methods = DefineMethods<{
  get: {
    status: 200;
    /** Operator list */
    resBody: Types.OperatorBillingAccountResponse[];
  };

  post: {
    status: 201;
    /** Operator added */
    resBody: Types.OperatorBillingAccountResponse;
    reqBody: Types.AddOperatorRequest;
  };
}>;
