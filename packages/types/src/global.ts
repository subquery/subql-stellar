// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {Horizon, rpc} from '@stellar/stellar-sdk';
import '@subql/types-core/dist/global';

declare global {
  const api: undefined;
  const unsafeApi: {sorobanClient: rpc.Server; stellarClient: Horizon.Server};
}
