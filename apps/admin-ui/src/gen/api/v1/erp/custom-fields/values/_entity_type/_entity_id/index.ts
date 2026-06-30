/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../../../../@types';

export type Methods = DefineMethods<{
  get: {
    status: 200;
    resBody: Types.CustomFieldValuesResponse;
  };

  put: {
    status: 200;
    resBody: Types.CustomFieldValuesResponse;
    reqBody: Types.SetCustomFieldValuesRequest;
  };
}>;
