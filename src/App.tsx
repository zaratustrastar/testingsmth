import { useMemo, useState } from 'react';
import { formatUnits, isAddress, parseUnits, type Address } from 'viem';
import { waitForTransactionReceipt } from 'wagmi/actions';
import {
  useAccount,
  useChainId,
  useConfig,
  useConnect,
  useDisconnect,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
} from 'wagmi';
import { base } from 'wagmi/chains';
import { ERC20_ABI, FACTORY_ABI, SPLIT_VAULT_ABI } from './abis';

const FACTORY_ADDRESS = '0x51fA7D0E4387819eA8655b054200983DE0d753B6' as Address;
const DEFAULT_VAULT = '0xe35169978C50305Cc1310006877650e5cb17Da77' as Address;
const DEFAULT_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
const BLOCKSCOUT_TX = 'https://base.blockscout.com/tx/';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

type TokenInfo = {
  address?: Address;
  name?: string;
  symbol?: string;
  decimals?: number;
  userBalance?: bigint;
  vaultBalance?: bigint;
  allowance?: bigint;
};

type TxRecord = { label: string; hash: `0x${string}` };

function getResult<T>(item: unknown): T | undefined {
  if (!item || typeof item !== 'object' || !('result' in item)) return undefined;
  return (item as { result?: T }).result;
}

function formatAmount(value?: bigint, decimals?: number, fallback = '—') {
  if (value === undefined || decimals === undefined) return fallback;
  return formatUnits(value, decimals);
}

function unixToDate(value?: bigint) {
  if (value === undefined) return '—';
  return `${value.toString()} (${new Date(Number(value) * 1000).toLocaleString()})`;
}

function parseHumanAmount(value: string, decimals?: number) {
  if (!value.trim() || decimals === undefined) return undefined;
  try {
    return parseUnits(value.trim(), decimals);
  } catch {
    return undefined;
  }
}

function displayAddress(address?: string) {
  if (!address) return '—';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function App() {
  const config = useConfig();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectors, connectAsync, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, error: switchError } = useSwitchChain();
  const { writeContractAsync, error: writeError, isPending: isWriting } = useWriteContract();

  const [vaultInput, setVaultInput] = useState<Address>(DEFAULT_VAULT);
  const vaultAddress = isAddress(vaultInput) ? (vaultInput as Address) : undefined;
  const [collateralAmount, setCollateralAmount] = useState('');
  const [pRecipient, setPRecipient] = useState('');
  const [pTransferAmount, setPTransferAmount] = useState('');
  const [nExerciseAmount, setNExerciseAmount] = useState('');
  const [pRedeemAmount, setPRedeemAmount] = useState('');
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [txError, setTxError] = useState<string>();
  const [createForm, setCreateForm] = useState({
    collateral: '',
    usdc: DEFAULT_USDC,
    strikeWad: '',
    maturity: '',
    exerciseWindow: '',
    namePrefix: '',
    symbolPrefix: '',
  });

  const onBase = chainId === base.id;

  const vaultReads = useReadContracts({
    contracts: vaultAddress
      ? ([
          { address: vaultAddress, abi: SPLIT_VAULT_ABI, functionName: 'collateral' },
          { address: vaultAddress, abi: SPLIT_VAULT_ABI, functionName: 'usdc' },
          { address: vaultAddress, abi: SPLIT_VAULT_ABI, functionName: 'pToken' },
          { address: vaultAddress, abi: SPLIT_VAULT_ABI, functionName: 'nToken' },
          { address: vaultAddress, abi: SPLIT_VAULT_ABI, functionName: 'strikeWad' },
          { address: vaultAddress, abi: SPLIT_VAULT_ABI, functionName: 'maturity' },
          { address: vaultAddress, abi: SPLIT_VAULT_ABI, functionName: 'exerciseDeadline' },
          { address: vaultAddress, abi: SPLIT_VAULT_ABI, functionName: 'settled' },
        ] as const)
      : [],
    query: { enabled: Boolean(vaultAddress) },
  });

  const collateral = getResult<Address>(vaultReads.data?.[0]);
  const usdc = getResult<Address>(vaultReads.data?.[1]);
  const pToken = getResult<Address>(vaultReads.data?.[2]);
  const nToken = getResult<Address>(vaultReads.data?.[3]);
  const strikeWad = getResult<bigint>(vaultReads.data?.[4]);
  const maturity = getResult<bigint>(vaultReads.data?.[5]);
  const exerciseDeadline = getResult<bigint>(vaultReads.data?.[6]);
  const settled = getResult<boolean>(vaultReads.data?.[7]);

  const tokenReads = useReadContracts({
    contracts:
      vaultAddress && collateral && usdc && pToken && nToken
        ? ([
            { address: collateral, abi: ERC20_ABI, functionName: 'name' },
            { address: collateral, abi: ERC20_ABI, functionName: 'symbol' },
            { address: collateral, abi: ERC20_ABI, functionName: 'decimals' },
            { address: collateral, abi: ERC20_ABI, functionName: 'balanceOf', args: [address ?? ZERO_ADDRESS] },
            { address: collateral, abi: ERC20_ABI, functionName: 'balanceOf', args: [vaultAddress] },
            { address: collateral, abi: ERC20_ABI, functionName: 'allowance', args: [address ?? ZERO_ADDRESS, vaultAddress] },
            { address: usdc, abi: ERC20_ABI, functionName: 'name' },
            { address: usdc, abi: ERC20_ABI, functionName: 'symbol' },
            { address: usdc, abi: ERC20_ABI, functionName: 'decimals' },
            { address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [address ?? ZERO_ADDRESS] },
            { address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [vaultAddress] },
            { address: usdc, abi: ERC20_ABI, functionName: 'allowance', args: [address ?? ZERO_ADDRESS, vaultAddress] },
            { address: pToken, abi: ERC20_ABI, functionName: 'name' },
            { address: pToken, abi: ERC20_ABI, functionName: 'symbol' },
            { address: pToken, abi: ERC20_ABI, functionName: 'decimals' },
            { address: pToken, abi: ERC20_ABI, functionName: 'balanceOf', args: [address ?? ZERO_ADDRESS] },
            { address: nToken, abi: ERC20_ABI, functionName: 'name' },
            { address: nToken, abi: ERC20_ABI, functionName: 'symbol' },
            { address: nToken, abi: ERC20_ABI, functionName: 'decimals' },
            { address: nToken, abi: ERC20_ABI, functionName: 'balanceOf', args: [address ?? ZERO_ADDRESS] },
          ] as const)
        : [],
    query: { enabled: Boolean(vaultAddress && collateral && usdc && pToken && nToken) },
  });

  const tokenInfo = useMemo(() => {
    const d = tokenReads.data;
    const info = {
      collateral: {
        address: collateral,
        name: getResult<string>(d?.[0]),
        symbol: getResult<string>(d?.[1]),
        decimals: getResult<number>(d?.[2]),
        userBalance: getResult<bigint>(d?.[3]),
        vaultBalance: getResult<bigint>(d?.[4]),
        allowance: getResult<bigint>(d?.[5]),
      },
      usdc: {
        address: usdc,
        name: getResult<string>(d?.[6]),
        symbol: getResult<string>(d?.[7]),
        decimals: getResult<number>(d?.[8]),
        userBalance: getResult<bigint>(d?.[9]),
        vaultBalance: getResult<bigint>(d?.[10]),
        allowance: getResult<bigint>(d?.[11]),
      },
      p: {
        address: pToken,
        name: getResult<string>(d?.[12]),
        symbol: getResult<string>(d?.[13]),
        decimals: getResult<number>(d?.[14]),
        userBalance: getResult<bigint>(d?.[15]),
      },
      n: {
        address: nToken,
        name: getResult<string>(d?.[16]),
        symbol: getResult<string>(d?.[17]),
        decimals: getResult<number>(d?.[18]),
        userBalance: getResult<bigint>(d?.[19]),
      },
    } satisfies Record<string, TokenInfo>;
    return info;
  }, [collateral, nToken, pToken, tokenReads.data, usdc]);

  const status = useMemo(() => {
    if (settled) return 'Settled';
    if (maturity === undefined || exerciseDeadline === undefined) return '—';
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now < maturity) return 'Minting open';
    if (now < exerciseDeadline) return 'Exercise period';
    return 'Ready to settle';
  }, [exerciseDeadline, maturity, settled]);

  const collateralAmountRaw = parseHumanAmount(collateralAmount, tokenInfo.collateral.decimals);
  const pTransferRaw = parseHumanAmount(pTransferAmount, tokenInfo.p.decimals);
  const nExerciseRaw = parseHumanAmount(nExerciseAmount, tokenInfo.n.decimals);
  const pRedeemRaw = parseHumanAmount(pRedeemAmount, tokenInfo.p.decimals);

  const usdcOwedRead = useReadContract({
    address: vaultAddress,
    abi: SPLIT_VAULT_ABI,
    functionName: 'usdcOwed',
    args: nExerciseRaw !== undefined ? [nExerciseRaw] : undefined,
    query: { enabled: Boolean(vaultAddress && nExerciseRaw !== undefined) },
  });

  const previewRedeemRead = useReadContract({
    address: vaultAddress,
    abi: SPLIT_VAULT_ABI,
    functionName: 'previewRedeemP',
    args: pRedeemRaw !== undefined ? [pRedeemRaw] : undefined,
    query: { enabled: Boolean(vaultAddress && pRedeemRaw !== undefined) },
  });

  const refreshReads = async () => {
    await Promise.all([vaultReads.refetch(), tokenReads.refetch(), usdcOwedRead.refetch(), previewRedeemRead.refetch()]);
  };

  const runTx = async (label: string, action: () => Promise<`0x${string}`>) => {
    setTxError(undefined);
    try {
      const hash = await action();
      setTxs((existing) => [{ label, hash }, ...existing]);
      await waitForTransactionReceipt(config, { hash, chainId: base.id });
      await refreshReads();
    } catch (error) {
      setTxError(error instanceof Error ? error.message : String(error));
    }
  };

  const requireVault = () => {
    if (!vaultAddress) throw new Error('Enter a valid vault address.');
    return vaultAddress;
  };

  const requireAddress = (value: string, label: string) => {
    if (!isAddress(value)) throw new Error(`${label} must be a valid address.`);
    return value as Address;
  };

  const requireAmount = (value: bigint | undefined, label: string) => {
    if (value === undefined) throw new Error(`Enter a valid ${label} amount.`);
    return value;
  };

  const allVaultsLengthRead = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: 'allVaultsLength',
  });

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">Base Mainnet · SplitVault test console</p>
          <h1>Experimental options-backed lending primitive UI</h1>
          <p className="muted">Borrower locks collateral, receives P/N tokens, exercises N with USDC, and lets P holders redeem after the deadline.</p>
        </div>
        <div className="warning">Experimental unaudited test UI. Not a real lending product. P buyers can lose money. No oracle. No liquidation. Use tiny amounts only.</div>
      </header>

      <Section title="1. Wallet / network">
        <div className="grid two">
          <Info label="Connected address" value={address ?? 'Not connected'} />
          <Info label="Network" value={onBase ? 'Base Mainnet (8453)' : `Wrong or unknown network (${chainId})`} tone={onBase ? 'ok' : 'bad'} />
        </div>
        <div className="row wrap">
          {!isConnected ? (
            connectors.map((connector) => (
              <button key={connector.uid} onClick={() => connectAsync({ connector })}>
                Connect {connector.name}
              </button>
            ))
          ) : (
            <button className="secondary" onClick={() => disconnect()}>
              Disconnect
            </button>
          )}
          {!onBase && (
            <button onClick={() => switchChainAsync({ chainId: base.id })}>Switch to Base</button>
          )}
        </div>
        <Errors errors={[connectError?.message, switchError?.message]} />
      </Section>

      <Section title="2. Existing Vault Dashboard">
        <label>
          Vault address
          <input value={vaultInput} onChange={(event) => setVaultInput(event.target.value as Address)} />
        </label>
        <div className="grid three">
          <Info label="collateral()" value={collateral} />
          <Info label="usdc()" value={usdc} />
          <Info label="pToken()" value={pToken} />
          <Info label="nToken()" value={nToken} />
          <Info label="strikeWad()" value={strikeWad?.toString()} />
          <Info label="maturity()" value={unixToDate(maturity)} />
          <Info label="exerciseDeadline()" value={unixToDate(exerciseDeadline)} />
          <Info label="settled()" value={String(settled ?? '—')} />
          <Info label="Status" value={status} tone={status === 'Settled' ? 'ok' : undefined} />
        </div>
        <h3>Token metadata and balances</h3>
        <div className="table">
          <div className="tr head"><span>Token</span><span>Address</span><span>Decimals</span><span>Your balance</span><span>Vault balance</span><span>Allowance to vault</span></div>
          <TokenRow label="Collateral" token={tokenInfo.collateral} />
          <TokenRow label="USDC" token={tokenInfo.usdc} />
          <TokenRow label="P" token={tokenInfo.p} />
          <TokenRow label="N" token={tokenInfo.n} />
        </div>
      </Section>

      <Section title="3. Borrower flow">
        <p className="muted">Expected result: you deposit the collateral amount and receive the same raw amount of P and N tokens.</p>
        <div className="grid two">
          <label>
            Collateral amount ({tokenInfo.collateral.symbol ?? 'human units'})
            <input value={collateralAmount} onChange={(event) => setCollateralAmount(event.target.value)} placeholder="0.0" />
          </label>
          <Info label="Parsed raw amount" value={collateralAmountRaw?.toString() ?? '—'} />
        </div>
        <div className="row wrap">
          <button disabled={!collateral || !vaultAddress || isWriting} onClick={() => runTx('Approve collateral', () => writeContractAsync({ address: collateral!, abi: ERC20_ABI, functionName: 'approve', args: [requireVault(), requireAmount(collateralAmountRaw, 'collateral')] }))}>
            Approve collateral to vault
          </button>
          <button disabled={!vaultAddress || isWriting} onClick={() => runTx('Mint P/N', () => writeContractAsync({ address: requireVault(), abi: SPLIT_VAULT_ABI, functionName: 'mint', args: [requireAmount(collateralAmountRaw, 'collateral')] }))}>
            Mint P/N
          </button>
        </div>
        <h3>Transfer P off-app settlement token</h3>
        <div className="grid two">
          <label>Recipient address<input value={pRecipient} onChange={(event) => setPRecipient(event.target.value)} placeholder="0x…" /></label>
          <label>P amount<input value={pTransferAmount} onChange={(event) => setPTransferAmount(event.target.value)} placeholder="0.0" /></label>
        </div>
        <button disabled={!pToken || isWriting} onClick={() => runTx('Transfer P', () => writeContractAsync({ address: pToken!, abi: ERC20_ABI, functionName: 'transfer', args: [requireAddress(pRecipient, 'Recipient'), requireAmount(pTransferRaw, 'P transfer')] }))}>
          Transfer P
        </button>
      </Section>

      <Section title="4. Exercise flow">
        <p className="muted">Burn N + pay USDC → reclaim collateral.</p>
        <div className="grid two">
          <label>N amount<input value={nExerciseAmount} onChange={(event) => setNExerciseAmount(event.target.value)} placeholder="0.0" /></label>
          <Info label="USDC owed" value={`${formatAmount(usdcOwedRead.data, tokenInfo.usdc.decimals)} ${tokenInfo.usdc.symbol ?? ''}`} />
        </div>
        <div className="row wrap">
          <button disabled={!usdc || !vaultAddress || isWriting || usdcOwedRead.data === undefined} onClick={() => runTx('Approve USDC', () => writeContractAsync({ address: usdc!, abi: ERC20_ABI, functionName: 'approve', args: [requireVault(), usdcOwedRead.data ?? 0n] }))}>
            Approve USDC to vault
          </button>
          <button disabled={!vaultAddress || isWriting} onClick={() => runTx('Exercise N', () => writeContractAsync({ address: requireVault(), abi: SPLIT_VAULT_ABI, functionName: 'exercise', args: [requireAmount(nExerciseRaw, 'N exercise')] }))}>
            Exercise
          </button>
        </div>
      </Section>

      <Section title="5. Settlement / P holder flow">
        <p className="muted">Burn P → receive USDC if N was exercised, otherwise collateral.</p>
        <button disabled={!vaultAddress || isWriting} onClick={() => runTx('Settle vault', () => writeContractAsync({ address: requireVault(), abi: SPLIT_VAULT_ABI, functionName: 'settle' }))}>
          Settle
        </button>
        <div className="grid two top-space">
          <label>P amount<input value={pRedeemAmount} onChange={(event) => setPRedeemAmount(event.target.value)} placeholder="0.0" /></label>
          <div className="card subtle">
            <Info label="Expected collateralOut" value={`${formatAmount(previewRedeemRead.data?.[0], tokenInfo.collateral.decimals)} ${tokenInfo.collateral.symbol ?? ''}`} />
            <Info label="Expected usdcOut" value={`${formatAmount(previewRedeemRead.data?.[1], tokenInfo.usdc.decimals)} ${tokenInfo.usdc.symbol ?? ''}`} />
          </div>
        </div>
        <button disabled={!vaultAddress || isWriting} onClick={() => runTx('Redeem P', () => writeContractAsync({ address: requireVault(), abi: SPLIT_VAULT_ABI, functionName: 'redeemP', args: [requireAmount(pRedeemRaw, 'P redeem')] }))}>
          Redeem P
        </button>
      </Section>

      <Section title="6. Optional create vault panel">
        <details>
          <summary>Advanced: create a new vault from factory</summary>
          <div className="grid two top-space">
            <label>Collateral address<input value={createForm.collateral} onChange={(e) => setCreateForm({ ...createForm, collateral: e.target.value })} placeholder="0x…" /></label>
            <label>USDC address<input value={createForm.usdc} onChange={(e) => setCreateForm({ ...createForm, usdc: e.target.value as Address })} /></label>
            <label>strikeWad<input value={createForm.strikeWad} onChange={(e) => setCreateForm({ ...createForm, strikeWad: e.target.value })} placeholder="1000000000000000000" /></label>
            <label>maturity timestamp<input value={createForm.maturity} onChange={(e) => setCreateForm({ ...createForm, maturity: e.target.value })} placeholder="Unix seconds" /></label>
            <label>exerciseWindow<input value={createForm.exerciseWindow} onChange={(e) => setCreateForm({ ...createForm, exerciseWindow: e.target.value })} placeholder="Seconds" /></label>
            <label>namePrefix<input value={createForm.namePrefix} onChange={(e) => setCreateForm({ ...createForm, namePrefix: e.target.value })} placeholder="My Meme Vault" /></label>
            <label>symbolPrefix<input value={createForm.symbolPrefix} onChange={(e) => setCreateForm({ ...createForm, symbolPrefix: e.target.value })} placeholder="MME" /></label>
          </div>
          <button onClick={() => runTx('Create vault', () => writeContractAsync({ address: FACTORY_ADDRESS, abi: FACTORY_ABI, functionName: 'createVault', args: [requireAddress(createForm.collateral, 'Collateral'), requireAddress(createForm.usdc, 'USDC'), BigInt(createForm.strikeWad), BigInt(createForm.maturity), BigInt(createForm.exerciseWindow), createForm.namePrefix, createForm.symbolPrefix] }))}>
            createVault(...)
          </button>
          <p className="muted">After tx: Find new vault address from VaultCreated event or allVaults(index). Current allVaultsLength(): {allVaultsLengthRead.data?.toString() ?? '—'}</p>
        </details>
      </Section>

      <Section title="Transactions and errors">
        <Errors errors={[txError, writeError?.message]} />
        {txs.length === 0 ? <p className="muted">No transactions sent yet.</p> : txs.map((tx) => <p key={tx.hash}><strong>{tx.label}:</strong> <a href={`${BLOCKSCOUT_TX}${tx.hash}`} target="_blank" rel="noreferrer">{tx.hash}</a></p>)}
      </Section>

      <details className="debug">
        <summary>Debug: raw read data</summary>
        <pre>{JSON.stringify({ vaultInput, vaultReads: vaultReads.data, tokenReads: tokenReads.data, usdcOwed: usdcOwedRead.data?.toString(), previewRedeemP: previewRedeemRead.data?.map((x) => x.toString()) }, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2)}</pre>
      </details>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h2>{title}</h2>{children}</section>;
}

function Info({ label, value, tone }: { label: string; value?: string; tone?: 'ok' | 'bad' }) {
  return <div className={`info ${tone ?? ''}`}><span>{label}</span><strong>{value ?? '—'}</strong></div>;
}

function TokenRow({ label, token }: { label: string; token: TokenInfo }) {
  return (
    <div className="tr">
      <span><strong>{label}</strong> {token.symbol ? `(${token.symbol})` : ''}<small>{token.name}</small></span>
      <span title={token.address}>{displayAddress(token.address)}</span>
      <span>{token.decimals ?? '—'}</span>
      <span>{formatAmount(token.userBalance, token.decimals)}</span>
      <span>{formatAmount(token.vaultBalance, token.decimals)}</span>
      <span>{formatAmount(token.allowance, token.decimals)}</span>
    </div>
  );
}

function Errors({ errors }: { errors: Array<string | undefined> }) {
  const visible = errors.filter(Boolean);
  if (visible.length === 0) return null;
  return <div className="errors">{visible.map((error, index) => <pre key={index}>{error}</pre>)}</div>;
}
