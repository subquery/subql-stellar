// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {BlockchainService} from './blockchain.service';
import {StellarApi, StellarApiService} from './stellar';

const SOROBAN_ENDPOINT = 'https://stellar.api.onfinality.io/public';

// https://stellar.expert/explorer/public/ledger/60124580
const blockHeight = 60124580;

describe('BlockchainService', () => {
  let blockchainService: BlockchainService;

  beforeEach(() => {
    const apiService = {
      api: new StellarApi(SOROBAN_ENDPOINT),
    } as StellarApiService;

    blockchainService = new BlockchainService(apiService);
  });

  it('correctly calculates block timestamp', async () => {
    const timestamp = await blockchainService.getBlockTimestamp(blockHeight);
    expect(timestamp.toISOString()).toBe('2025-12-03T00:51:22.000Z');
  });

  it('correctly gets the header for a height', async () => {
    const header = await blockchainService.getHeaderForHeight(blockHeight);

    expect(header).toEqual({
      blockHeight: blockHeight,
      blockHash: '38258f21481cb72305fbfee9cdd8fb4a6dc12889cea26ef7594fda5a529577a4',
      parentHash: 'f616488a2247b0831f53cab1b7bd7a3471df44fef3362aa1a670ed4ae6eb2eb1',
      timestamp: new Date('2025-12-03T00:51:22.000Z'),
    });
  });
});
