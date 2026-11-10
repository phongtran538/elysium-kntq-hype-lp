export const positionManagerAbi = [
  {
    type: 'function',
    name: 'modifyLiquidities',
    stateMutability: 'payable',
    inputs: [
      { name: 'unlockData', type: 'bytes' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'nextTokenId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getPositionLiquidity',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'liquidity', type: 'uint128' }],
  },
  {
    type: 'function',
    name: 'getPoolAndPositionInfo',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      {
        name: 'poolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { name: 'info', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
  { type: 'error', name: 'MaximumAmountExceeded', inputs: [
    { name: 'maximumAmount', type: 'uint128' },
    { name: 'amountRequested', type: 'uint128' },
  ] },
  { type: 'error', name: 'MinimumAmountInsufficient', inputs: [
    { name: 'minimumAmount', type: 'uint128' },
    { name: 'amountReceived', type: 'uint128' },
  ] },
  { type: 'error', name: 'DeadlinePassed', inputs: [{ name: 'deadline', type: 'uint256' }] },
  { type: 'error', name: 'NotApproved', inputs: [{ name: 'caller', type: 'address' }] },
  { type: 'error', name: 'UnsupportedAction', inputs: [{ name: 'action', type: 'uint256' }] },
  { type: 'error', name: 'ContractLocked', inputs: [] },
  { type: 'error', name: 'InputLengthMismatch', inputs: [] },
  { type: 'error', name: 'DeltaNotPositive', inputs: [{ name: 'currency', type: 'address' }] },
  { type: 'error', name: 'DeltaNotNegative', inputs: [{ name: 'currency', type: 'address' }] },
] as const
