import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
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
type VaultStatus = 'Minting open' | 'Exercise period' | 'Ready to settle' | 'Settled' | 'Loading';

function getResult<T>(item: unknown): T | undefined {
  if (!item || typeof item !== 'object' || !('result' in item)) return undefined;
  return (item as { result?: T }).result;
}

function formatAmount(value?: bigint, decimals?: number, fallback = '—') {
  if (value === undefined || decimals === undefined) return fallback;
  const formatted = formatUnits(value, decimals);
  const [whole, fraction] = formatted.split('.');
  if (!fraction) return whole;
  const trimmedFraction = fraction.replace(/0+$/, '').slice(0, 6);
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

function unixToDate(value?: bigint) {
  if (value === undefined) return '—';
  return `${new Date(Number(value) * 1000).toLocaleString()} · ${value.toString()}`;
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

function toFiniteNumber(value?: bigint, decimals?: number) {
  if (value === undefined || decimals === undefined) return 0;
  const parsed = Number(formatUnits(value, decimals));
  return Number.isFinite(parsed) ? parsed : 0;
}

function percent(part: number, total: number) {
  if (!total || !Number.isFinite(total)) return 0;
  return Math.max(0, Math.min(100, (part / total) * 100));
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

  const status = useMemo<VaultStatus>(() => {
    if (settled) return 'Settled';
    if (maturity === undefined || exerciseDeadline === undefined) return 'Loading';
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
    if (value === undefined || value <= 0n) throw new Error(`Enter a valid ${label} amount greater than zero.`);
    return value;
  };

  const allVaultsLengthRead = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: 'allVaultsLength',
  });

  const collateralVault = toFiniteNumber(tokenInfo.collateral.vaultBalance, tokenInfo.collateral.decimals);
  const usdcVault = toFiniteNumber(tokenInfo.usdc.vaultBalance, tokenInfo.usdc.decimals);
  const vaultCompositionTotal = collateralVault + usdcVault;
  const collateralVaultPercent = percent(collateralVault, vaultCompositionTotal);
  const usdcVaultPercent = percent(usdcVault, vaultCompositionTotal);
  const previewCollateralOut = previewRedeemRead.data?.[0];
  const previewUsdcOut = previewRedeemRead.data?.[1];
  const userReady = isConnected && onBase;

  return (
    <main>
      <header className="hero pro-card">
        <div className="hero-copy">
          <div className="pill-row">
            <span className="pill success-dot">Base Mainnet</span>
            <span className="pill">No backend</span>
            <span className="pill">Test console</span>
          </div>
          <p className="eyebrow">SplitVault</p>
          <h1>Options-backed lending, explained step by step.</h1>
          <p className="hero-subtitle">
            Lock collateral, mint two claim tokens, sell P off-app for USDC, keep N to reclaim collateral, and let P holders redeem after expiry.
          </p>
          <div className="hero-actions">
            <a className="button ghost" href="#borrow">Start borrower flow</a>
            <a className="button ghost" href="#redeem">Redeem P</a>
          </div>
        </div>
        <div className="risk-panel">
          <span className="risk-icon">!</span>
          <div>
            <h2>Experimental unaudited test UI</h2>
            <p>Not a real lending product. P buyers can lose money. No oracle. No liquidation. Use tiny amounts only.</p>
          </div>
        </div>
      </header>

      <section className="quick-grid" aria-label="Current setup summary">
        <MetricCard label="Wallet" value={address ? displayAddress(address) : 'Not connected'} detail={userReady ? 'Ready on Base' : 'Connect and switch to Base'} tone={userReady ? 'good' : 'warn'} />
        <MetricCard label="Vault status" value={status} detail={statusHelp(status)} tone={status === 'Ready to settle' ? 'warn' : 'good'} />
        <MetricCard label="Strike" value={strikeWad ? formatAmount(strikeWad, 18) : '—'} detail="USDC owed is calculated by the vault" />
        <MetricCard label="Latest tx" value={txs[0] ? displayAddress(txs[0].hash) : 'None'} detail={txs[0]?.label ?? 'Transactions appear here'} />
      </section>

      <Section eyebrow="How it works" title="A beginner-friendly map of the product">
        <FlowDiagram />
        <div className="education-grid">
          <ExplainerCard number="01" title="Borrower locks collateral" text="The vault takes the meme token and mints two matching ERC20 tokens: P and N." />
          <ExplainerCard number="02" title="P is the lender claim" text="The borrower can transfer or sell P off-app. Holding P gives redemption rights after the exercise deadline." />
          <ExplainerCard number="03" title="N is the reclaim option" text="The borrower keeps N. Exercising N burns it, pays USDC, and returns collateral before the deadline." />
        </div>
      </Section>

      <Section eyebrow="Wallet" title="1. Connect and confirm Base Mainnet">
        <div className="wallet-panel">
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
            {!onBase && <button onClick={() => switchChainAsync({ chainId: base.id })}>Switch to Base</button>}
          </div>
        </div>
        <Errors errors={[connectError?.message, switchError?.message]} />
      </Section>

      <Section eyebrow="Vault" title="2. Existing vault dashboard">
        <label>
          Vault address
          <input value={vaultInput} onChange={(event) => setVaultInput(event.target.value as Address)} />
        </label>

        <div className="dashboard-grid top-space">
          <div className="pro-card status-card">
            <span className={`status-badge ${statusClass(status)}`}>{status}</span>
            <h3>{statusHeadline(status)}</h3>
            <p className="muted">{statusHelp(status)}</p>
            <LifecycleTimeline maturity={maturity} exerciseDeadline={exerciseDeadline} settled={settled} />
          </div>
          <VaultCompositionChart
            collateralSymbol={tokenInfo.collateral.symbol ?? 'Collateral'}
            usdcSymbol={tokenInfo.usdc.symbol ?? 'USDC'}
            collateralPercent={collateralVaultPercent}
            usdcPercent={usdcVaultPercent}
            collateralAmount={`${formatAmount(tokenInfo.collateral.vaultBalance, tokenInfo.collateral.decimals)} ${tokenInfo.collateral.symbol ?? ''}`}
            usdcAmount={`${formatAmount(tokenInfo.usdc.vaultBalance, tokenInfo.usdc.decimals)} ${tokenInfo.usdc.symbol ?? ''}`}
          />
        </div>

        <div className="grid four top-space">
          <Info label="collateral()" value={collateral} />
          <Info label="usdc()" value={usdc} />
          <Info label="pToken()" value={pToken} />
          <Info label="nToken()" value={nToken} />
          <Info label="strikeWad()" value={strikeWad?.toString()} />
          <Info label="maturity()" value={unixToDate(maturity)} />
          <Info label="exerciseDeadline()" value={unixToDate(exerciseDeadline)} />
          <Info label="settled()" value={String(settled ?? '—')} />
        </div>

        <h3>Your wallet and vault balances</h3>
        <div className="balance-cards">
          <TokenBalanceCard label="Collateral" token={tokenInfo.collateral} />
          <TokenBalanceCard label="USDC" token={tokenInfo.usdc} />
          <TokenBalanceCard label="P token" token={tokenInfo.p} description="P = lender redemption claim" />
          <TokenBalanceCard label="N token" token={tokenInfo.n} description="N = borrower reclaim option" />
        </div>
      </Section>

      <Section id="borrow" eyebrow="Borrower" title="3. Lock collateral and mint P/N">
        <div className="split-layout">
          <div>
            <StepHeader step="A" title="Approve collateral" text="This permits the vault to pull only the amount you enter. Approval is required before minting." />
            <label>
              Collateral amount ({tokenInfo.collateral.symbol ?? 'human units'})
              <input value={collateralAmount} onChange={(event) => setCollateralAmount(event.target.value)} placeholder="0.0" />
            </label>
            <Info label="Raw amount sent to contract" value={collateralAmountRaw?.toString() ?? '—'} />
            <div className="row wrap top-space">
              <button disabled={!collateral || !vaultAddress || isWriting} onClick={() => runTx('Approve collateral', () => writeContractAsync({ address: collateral!, abi: ERC20_ABI, functionName: 'approve', args: [requireVault(), requireAmount(collateralAmountRaw, 'collateral')] }))}>
                Approve collateral
              </button>
              <button disabled={!vaultAddress || isWriting} onClick={() => runTx('Mint P/N', () => writeContractAsync({ address: requireVault(), abi: SPLIT_VAULT_ABI, functionName: 'mint', args: [requireAmount(collateralAmountRaw, 'collateral')] }))}>
                Mint P + N
              </button>
            </div>
          </div>
          <ResultPreview
            title="Expected mint result"
            rows={[
              ['You deposit', `${collateralAmount || '0'} ${tokenInfo.collateral.symbol ?? 'collateral'}`],
              ['You receive', `${collateralAmount || '0'} P + ${collateralAmount || '0'} N`],
              ['What happens next', 'Transfer/sell P off-app; keep N to exercise'],
            ]}
          />
        </div>

        <div className="pro-card top-space">
          <StepHeader step="B" title="Transfer P to a lender" text="Use this after an off-app agreement. The app only transfers P; it does not handle the USDC sale." />
          <div className="grid two">
            <label>Recipient address<input value={pRecipient} onChange={(event) => setPRecipient(event.target.value)} placeholder="0x…" /></label>
            <label>P amount<input value={pTransferAmount} onChange={(event) => setPTransferAmount(event.target.value)} placeholder="0.0" /></label>
          </div>
          <button className="top-space" disabled={!pToken || isWriting} onClick={() => runTx('Transfer P', () => writeContractAsync({ address: pToken!, abi: ERC20_ABI, functionName: 'transfer', args: [requireAddress(pRecipient, 'Recipient'), requireAmount(pTransferRaw, 'P transfer')] }))}>
            Transfer P
          </button>
        </div>
      </Section>

      <Section eyebrow="Exercise" title="4. Burn N + pay USDC → reclaim collateral">
        <div className="split-layout">
          <div>
            <StepHeader step="C" title="Quote USDC owed" text="Enter the amount of N to exercise. The vault returns the exact USDC owed before you approve or transact." />
            <label>N amount<input value={nExerciseAmount} onChange={(event) => setNExerciseAmount(event.target.value)} placeholder="0.0" /></label>
            <div className="quote-box">
              <span>USDC owed</span>
              <strong>{formatAmount(usdcOwedRead.data, tokenInfo.usdc.decimals)} {tokenInfo.usdc.symbol ?? ''}</strong>
              <small>Exact value from usdcOwed(amount)</small>
            </div>
            <div className="row wrap top-space">
              <button disabled={!usdc || !vaultAddress || isWriting || usdcOwedRead.data === undefined} onClick={() => runTx('Approve USDC', () => writeContractAsync({ address: usdc!, abi: ERC20_ABI, functionName: 'approve', args: [requireVault(), usdcOwedRead.data ?? 0n] }))}>
                Approve USDC
              </button>
              <button disabled={!vaultAddress || isWriting} onClick={() => runTx('Exercise N', () => writeContractAsync({ address: requireVault(), abi: SPLIT_VAULT_ABI, functionName: 'exercise', args: [requireAmount(nExerciseRaw, 'N exercise')] }))}>
                Exercise N
              </button>
            </div>
          </div>
          <PayoffSketch />
        </div>
      </Section>

      <Section id="redeem" eyebrow="P holder" title="5. Settle and redeem P after the deadline">
        <div className="split-layout">
          <div>
            <StepHeader step="D" title="Settle vault" text="After the exercise deadline, anyone can call settle once. Then P holders can redeem." />
            <button disabled={!vaultAddress || isWriting} onClick={() => runTx('Settle vault', () => writeContractAsync({ address: requireVault(), abi: SPLIT_VAULT_ABI, functionName: 'settle' }))}>
              Settle vault
            </button>
            <label className="top-space">P amount<input value={pRedeemAmount} onChange={(event) => setPRedeemAmount(event.target.value)} placeholder="0.0" /></label>
            <button className="top-space" disabled={!vaultAddress || isWriting} onClick={() => runTx('Redeem P', () => writeContractAsync({ address: requireVault(), abi: SPLIT_VAULT_ABI, functionName: 'redeemP', args: [requireAmount(pRedeemRaw, 'P redeem')] }))}>
              Redeem P
            </button>
          </div>
          <ResultPreview
            title="Preview redemption"
            rows={[
              ['collateralOut', `${formatAmount(previewCollateralOut, tokenInfo.collateral.decimals)} ${tokenInfo.collateral.symbol ?? ''}`],
              ['usdcOut', `${formatAmount(previewUsdcOut, tokenInfo.usdc.decimals)} ${tokenInfo.usdc.symbol ?? ''}`],
              ['Rule of thumb', 'Burn P → receive USDC if N exercised; otherwise collateral'],
            ]}
          />
        </div>
      </Section>

      <Section eyebrow="Advanced" title="6. Create a new vault">
        <details className="advanced-panel">
          <summary>Advanced factory controls</summary>
          <p className="muted">Only use this if you understand the contract parameters. Base USDC is pre-filled.</p>
          <div className="grid two top-space">
            <label>Collateral address<input value={createForm.collateral} onChange={(e) => setCreateForm({ ...createForm, collateral: e.target.value })} placeholder="0x…" /></label>
            <label>USDC address<input value={createForm.usdc} onChange={(e) => setCreateForm({ ...createForm, usdc: e.target.value as Address })} /></label>
            <label>strikeWad<input value={createForm.strikeWad} onChange={(e) => setCreateForm({ ...createForm, strikeWad: e.target.value })} placeholder="1000000000000000000" /></label>
            <label>maturity timestamp<input value={createForm.maturity} onChange={(e) => setCreateForm({ ...createForm, maturity: e.target.value })} placeholder="Unix seconds" /></label>
            <label>exerciseWindow<input value={createForm.exerciseWindow} onChange={(e) => setCreateForm({ ...createForm, exerciseWindow: e.target.value })} placeholder="Seconds" /></label>
            <label>namePrefix<input value={createForm.namePrefix} onChange={(e) => setCreateForm({ ...createForm, namePrefix: e.target.value })} placeholder="My Meme Vault" /></label>
            <label>symbolPrefix<input value={createForm.symbolPrefix} onChange={(e) => setCreateForm({ ...createForm, symbolPrefix: e.target.value })} placeholder="MME" /></label>
          </div>
          <button className="top-space" onClick={() => runTx('Create vault', () => writeContractAsync({ address: FACTORY_ADDRESS, abi: FACTORY_ABI, functionName: 'createVault', args: [requireAddress(createForm.collateral, 'Collateral'), requireAddress(createForm.usdc, 'USDC'), BigInt(createForm.strikeWad), BigInt(createForm.maturity), BigInt(createForm.exerciseWindow), createForm.namePrefix, createForm.symbolPrefix] }))}>
            createVault(...)
          </button>
          <p className="muted">After tx: Find new vault address from VaultCreated event or allVaults(index). Current allVaultsLength(): {allVaultsLengthRead.data?.toString() ?? '—'}</p>
        </details>
      </Section>

      <Section eyebrow="Activity" title="Transactions and errors">
        <Errors errors={[txError, writeError?.message]} />
        <div className="tx-list">
          {txs.length === 0 ? <p className="muted">No transactions sent yet. Your hashes will appear here with Base Blockscout links.</p> : txs.map((tx) => <p key={tx.hash}><strong>{tx.label}:</strong> <a href={`${BLOCKSCOUT_TX}${tx.hash}`} target="_blank" rel="noreferrer">{tx.hash}</a></p>)}
        </div>
      </Section>

      <details className="debug">
        <summary>Debug: raw read data</summary>
        <pre>{JSON.stringify({ vaultInput, vaultReads: vaultReads.data, tokenReads: tokenReads.data, usdcOwed: usdcOwedRead.data?.toString(), previewRedeemP: previewRedeemRead.data?.map((x) => x.toString()) }, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2)}</pre>
      </details>
    </main>
  );
}

function Section({ id, eyebrow, title, children }: { id?: string; eyebrow: string; title: string; children: ReactNode }) {
  return <section id={id} className="pro-card"><p className="section-eyebrow">{eyebrow}</p><h2>{title}</h2>{children}</section>;
}

function Info({ label, value, tone }: { label: string; value?: string; tone?: 'ok' | 'bad' }) {
  return <div className={`info ${tone ?? ''}`}><span>{label}</span><strong>{value ?? '—'}</strong></div>;
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: 'good' | 'warn' }) {
  return <article className={`metric-card ${tone ?? ''}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function TokenBalanceCard({ label, token, description }: { label: string; token: TokenInfo; description?: string }) {
  return (
    <article className="token-card">
      <div className="token-card-head">
        <div><span>{label}</span><strong>{token.symbol ?? '—'}</strong></div>
        <code title={token.address}>{displayAddress(token.address)}</code>
      </div>
      <p>{description ?? token.name ?? 'Token used by this vault'}</p>
      <div className="token-stats">
        <Info label="Your balance" value={formatAmount(token.userBalance, token.decimals)} />
        <Info label="Vault balance" value={formatAmount(token.vaultBalance, token.decimals)} />
        <Info label="Allowance" value={formatAmount(token.allowance, token.decimals)} />
        <Info label="Decimals" value={token.decimals?.toString() ?? '—'} />
      </div>
    </article>
  );
}

function FlowDiagram() {
  return (
    <div className="flow-diagram" aria-label="SplitVault flow diagram">
      <div className="flow-node borrower"><span>Borrower</span><strong>locks meme collateral</strong></div>
      <div className="flow-arrow">→</div>
      <div className="flow-node vault"><span>SplitVault</span><strong>mints P + N</strong></div>
      <div className="flow-arrow">→</div>
      <div className="flow-node split"><span>P token</span><strong>sell/transfer to lender</strong></div>
      <div className="flow-node split"><span>N token</span><strong>keep to exercise</strong></div>
    </div>
  );
}

function ExplainerCard({ number, title, text }: { number: string; title: string; text: string }) {
  return <article className="explainer-card"><span>{number}</span><h3>{title}</h3><p>{text}</p></article>;
}

function StepHeader({ step, title, text }: { step: string; title: string; text: string }) {
  return <div className="step-header"><span>{step}</span><div><h3>{title}</h3><p>{text}</p></div></div>;
}

function ResultPreview({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return <aside className="result-preview"><h3>{title}</h3>{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</aside>;
}

function LifecycleTimeline({ maturity, exerciseDeadline, settled }: { maturity?: bigint; exerciseDeadline?: bigint; settled?: boolean }) {
  const now = Math.floor(Date.now() / 1000);
  const maturityNumber = maturity ? Number(maturity) : undefined;
  const deadlineNumber = exerciseDeadline ? Number(exerciseDeadline) : undefined;
  const progress = maturityNumber && deadlineNumber && deadlineNumber > maturityNumber
    ? percent(now - maturityNumber, deadlineNumber - maturityNumber)
    : settled ? 100 : 0;

  return (
    <div className="timeline-card">
      <div className="timeline-track"><span style={{ width: `${progress}%` }} /></div>
      <div className="timeline-labels">
        <span>Mint</span>
        <span>Maturity</span>
        <span>Deadline</span>
        <span>Settle</span>
      </div>
    </div>
  );
}

function VaultCompositionChart({ collateralSymbol, usdcSymbol, collateralPercent, usdcPercent, collateralAmount, usdcAmount }: { collateralSymbol: string; usdcSymbol: string; collateralPercent: number; usdcPercent: number; collateralAmount: string; usdcAmount: string }) {
  const collateralStyle = { '--pct': `${collateralPercent}%` } as CSSProperties;
  const usdcStyle = { '--pct': `${usdcPercent}%` } as CSSProperties;
  return (
    <div className="pro-card chart-card">
      <div><p className="section-eyebrow">Vault composition</p><h3>What P holders can eventually receive</h3></div>
      <div className="donut" style={{ background: `conic-gradient(#6d5dfc 0 ${collateralPercent}%, #00b894 ${collateralPercent}% ${collateralPercent + usdcPercent}%, #e8edf7 0)` }}>
        <span>{Math.round(collateralPercent + usdcPercent)}%</span>
      </div>
      <div className="chart-legend">
        <div><i className="purple" /><span>{collateralSymbol}</span><strong>{collateralAmount}</strong><div className="mini-bar"><span style={collateralStyle} /></div></div>
        <div><i className="green" /><span>{usdcSymbol}</span><strong>{usdcAmount}</strong><div className="mini-bar"><span style={usdcStyle} /></div></div>
      </div>
    </div>
  );
}

function PayoffSketch() {
  return (
    <aside className="payoff-card">
      <h3>Exercise intuition</h3>
      <p className="muted">Exercising N swaps a fixed USDC payment for collateral return.</p>
      <svg viewBox="0 0 320 180" role="img" aria-label="Simple exercise payoff sketch">
        <path d="M32 148H292" className="axis" />
        <path d="M44 160V24" className="axis" />
        <path d="M48 136 C92 136 118 136 140 120 C178 92 202 52 282 40" className="curve" />
        <path d="M52 136 H140 V120" className="strike-line" />
        <text x="42" y="174">Low collateral value</text>
        <text x="178" y="174">High collateral value</text>
        <text x="146" y="116">Strike</text>
      </svg>
      <p className="caption">This chart is educational only; the contract uses its own fixed strike math and no oracle.</p>
    </aside>
  );
}

function statusClass(status: VaultStatus) {
  if (status === 'Ready to settle') return 'warn';
  if (status === 'Settled') return 'done';
  if (status === 'Loading') return 'loading';
  return 'live';
}

function statusHeadline(status: VaultStatus) {
  switch (status) {
    case 'Minting open': return 'Borrowers can mint new P/N pairs.';
    case 'Exercise period': return 'N holders can exercise to reclaim collateral.';
    case 'Ready to settle': return 'Exercise is closed. Settle can be called.';
    case 'Settled': return 'Vault is settled. P redemption is active.';
    default: return 'Loading vault state from Base.';
  }
}

function statusHelp(status: VaultStatus) {
  switch (status) {
    case 'Minting open': return 'Before maturity, borrowers can deposit collateral and mint P/N.';
    case 'Exercise period': return 'After maturity and before the deadline, N can be burned with USDC to reclaim collateral.';
    case 'Ready to settle': return 'The deadline has passed and settle() has not been called yet.';
    case 'Settled': return 'P holders can redeem according to final vault balances.';
    default: return 'Connect and wait for contract reads to resolve.';
  }
}

function Errors({ errors }: { errors: Array<string | undefined> }) {
  const visible = errors.filter(Boolean);
  if (visible.length === 0) return null;
  return <div className="errors">{visible.map((error, index) => <pre key={index}>{error}</pre>)}</div>;
}
