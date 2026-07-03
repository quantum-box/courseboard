/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../@types';

export type Methods = DefineMethods<{
  get: {
    status: 200;
    resBody: Types.QuotationListResponse;
  };

  post: {
    status: 201;
    resBody: Types.QuotationResponse;
    reqBody: Types.CreateQuotationRequest;
  };
}>;
