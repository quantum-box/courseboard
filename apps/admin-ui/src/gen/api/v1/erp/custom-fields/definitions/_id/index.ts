/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../../../@types';

export type Methods = DefineMethods<{
  delete: {
    status: 204;
  };

  put: {
    status: 200;
    resBody: Types.CustomFieldDefinitionResponse;
    reqBody: Types.UpdateCustomFieldDefinitionRequest;
  };
}>;
