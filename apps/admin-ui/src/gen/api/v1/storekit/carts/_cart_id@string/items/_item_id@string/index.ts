/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../../../../@types';

export type Methods = DefineMethods<{
  delete: {
    status: 200;
    resBody: Types.OkResponse;
  };

  post: {
    status: 200;
    resBody: Types.CartResponse;
    reqBody: Types.UpdateCartItemRequest;
  };
}>;
