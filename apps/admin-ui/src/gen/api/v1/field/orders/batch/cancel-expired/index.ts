/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../../../@types';

export type Methods = DefineMethods<{
  /** Returns the number of orders cancelled. */
  post: {
    status: 200;
    /** Cancelled expired orders */
    resBody: Types.CancelExpiredResponse;
  };
}>;
