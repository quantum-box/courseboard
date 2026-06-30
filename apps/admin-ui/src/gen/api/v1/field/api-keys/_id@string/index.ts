/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../../@types';

export type Methods = DefineMethods<{
  delete: {
    status: 200;
    /** Deleted */
    resBody: Types.DeletedResponse;
  };

  get: {
    status: 200;
    /** API key detail */
    resBody: Types.ApiKeyResponse;
  };
}>;
