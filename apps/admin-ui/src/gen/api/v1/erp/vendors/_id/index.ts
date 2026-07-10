/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../../@types';

export type Methods = DefineMethods<{
  get: {
    status: 200;
    resBody: Types.VendorResponse;
  };

  patch: {
    status: 200;
    resBody: Types.VendorResponse;
    reqBody: Types.UpdateVendorRequest;
  };
}>;
