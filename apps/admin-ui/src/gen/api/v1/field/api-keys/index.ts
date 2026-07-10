/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../@types';

export type Methods = DefineMethods<{
  get: {
    status: 200;
    /** API key list */
    resBody: Types.ApiKeyResponse[];
  };

  post: {
    status: 201;
    /** API key created */
    resBody: Types.CreateApiKeyResponse;
    reqBody: Types.CreateApiKeyRequest;
  };
}>;
