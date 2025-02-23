// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {
  ApiConnectionError,
  ApiErrorType,
  IApiConnectionSpecific,
  NetworkMetadataPayload,
  TimeoutError,
  RateLimitError,
  DisconnectionError,
  LargeResponseError,
  IBlock,
} from '@subql/node-core';
import {
  StellarBlockWrapper,
  IStellarEndpointConfig,
} from '@subql/types-stellar';
import { StellarApi } from './api.stellar';
import SafeStellarProvider from './safe-api';
import { SorobanServer } from './soroban.server';

type FetchFunc = (
  api: StellarApi,
  batch: number[],
) => Promise<IBlock<StellarBlockWrapper>[]>;

export class StellarApiConnection
  implements
    IApiConnectionSpecific<
      StellarApi,
      SafeStellarProvider,
      IBlock<StellarBlockWrapper>[]
    >
{
  readonly networkMeta: NetworkMetadataPayload;

  constructor(
    public unsafeApi: StellarApi,
    private fetchBlocksBatches: FetchFunc,
  ) {
    this.networkMeta = {
      chain: unsafeApi.getChainId(),
      specName: unsafeApi.getSpecName(),
      genesisHash: unsafeApi.getGenesisHash(),
    };
  }

  static async create(
    endpoint: string,
    fetchBlockBatches: FetchFunc,
    soroban?: SorobanServer,
    config?: IStellarEndpointConfig,
  ): Promise<StellarApiConnection> {
    const api = new StellarApi(endpoint, soroban, config);

    await api.init();

    return new StellarApiConnection(api, fetchBlockBatches);
  }

  safeApi(height: number): SafeStellarProvider {
    //safe api not implemented
    throw new Error(`Not Implemented`);
  }

  async apiConnect(): Promise<void> {
    await this.unsafeApi.connect();
  }

  async apiDisconnect(): Promise<void> {
    await this.unsafeApi.disconnect();
  }

  async fetchBlocks(heights: number[]): Promise<IBlock<StellarBlockWrapper>[]> {
    const blocks = await this.fetchBlocksBatches(this.unsafeApi, heights);
    return blocks;
  }

  handleError = StellarApiConnection.handleError;

  static handleError(e: Error): ApiConnectionError {
    let formatted_error: ApiConnectionError;
    if (e.message.includes(`Timeout`)) {
      formatted_error = new TimeoutError(e);
    } else if (e.message.startsWith(`disconnected from `)) {
      formatted_error = new DisconnectionError(e);
    } else if (
      e.message.includes(`Rate Limit Exceeded`) ||
      e.message.includes('Too Many Requests')
    ) {
      formatted_error = new RateLimitError(e);
    } else if (e.message.includes(`limit must not exceed`)) {
      formatted_error = new LargeResponseError(e);
    } else {
      formatted_error = new ApiConnectionError(
        e.name,
        e.message,
        ApiErrorType.Default,
      );
    }
    return formatted_error;
  }
}
