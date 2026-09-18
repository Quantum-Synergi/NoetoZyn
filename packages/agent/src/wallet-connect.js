import { getWallets } from '@wallet-standard/app';

const walletApi = getWallets();
const state = {
  wallets: [],
  connectedWallet: null,
  connectedAccount: null,
};

const elements = {
  button: document.getElementById('wallet-button'),
  chooser: document.getElementById('wallet-chooser'),
  state: document.getElementById('wallet-state'),
  connected: document.getElementById('wallet-connected'),
  name: document.getElementById('wallet-name'),
  address: document.getElementById('wallet-address'),
  copy: document.getElementById('copy-address'),
  disconnect: document.getElementById('disconnect-wallet'),
};

function setStatus(message, kind = 'muted') {
  elements.state.textContent = message;
  elements.state.className = `muted ${kind}`;
}

function compatibleWallets() {
  return walletApi.get().filter((wallet) => typeof wallet.features?.['standard:connect']?.connect === 'function');
}

function renderChooser() {
  elements.chooser.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose a detected wallet';
  elements.chooser.append(placeholder);
  state.wallets.forEach((wallet, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = wallet.name;
    elements.chooser.append(option);
  });
  elements.chooser.hidden = true;
}

function refreshWallets() {
  state.wallets = compatibleWallets();
  if (!state.connectedWallet) renderChooser();
}

function shortenAddress(address) {
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-6)}` : address;
}

function showConnected(wallet, account) {
  state.connectedWallet = wallet;
  state.connectedAccount = account;
  elements.name.textContent = wallet.name;
  elements.address.textContent = shortenAddress(account.address);
  elements.address.title = account.address;
  elements.connected.hidden = false;
  elements.button.hidden = true;
  elements.chooser.hidden = true;
  setStatus('Identity only — no signing enabled.', 'success');
}

function clearConnected(message = 'Disconnected from this dashboard.') {
  state.connectedWallet = null;
  state.connectedAccount = null;
  elements.connected.hidden = true;
  elements.button.hidden = false;
  elements.chooser.value = '';
  elements.chooser.hidden = true;
  setStatus(message);
}

async function connectWallet(wallet) {
  setStatus(`Connecting to ${wallet.name}...`);
  try {
    const result = await wallet.features['standard:connect'].connect();
    const account = result?.accounts?.[0] || wallet.accounts?.[0];
    if (!account?.address) {
      setStatus('The selected wallet returned no account.', 'error');
      return;
    }
    showConnected(wallet, account);
  } catch (error) {
    const message = error?.message?.toLowerCase().includes('reject') || error?.message?.toLowerCase().includes('cancel')
      ? 'Wallet connection was cancelled.'
      : 'Wallet connection failed.';
    setStatus(message, 'error');
  }
}

async function disconnectWallet() {
  const disconnect = state.connectedWallet?.features?.['standard:disconnect']?.disconnect;
  try {
    if (typeof disconnect === 'function') await disconnect();
  } catch {
    clearConnected('Disconnected from this dashboard.');
    return;
  }
  clearConnected();
}

async function copyAddress() {
  const address = state.connectedAccount?.address;
  if (!address) return;
  if (!navigator.clipboard?.writeText) {
    setStatus('Clipboard unavailable; copy the address manually.', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(address);
    setStatus('Full wallet address copied.', 'success');
  } catch {
    setStatus('Clipboard access was unavailable; copy the address manually.', 'error');
  }
}

elements.button.addEventListener('click', () => {
  refreshWallets();
  if (!state.wallets.length) {
    setStatus('No compatible Wallet Standard wallet detected.', 'error');
    return;
  }
  setStatus('Select a detected wallet to continue.');
  elements.chooser.hidden = false;
  elements.chooser.focus();
});
elements.chooser.addEventListener('change', () => {
  const wallet = state.wallets[Number(elements.chooser.value)];
  if (wallet) connectWallet(wallet);
});
elements.copy.addEventListener('click', copyAddress);
elements.disconnect.addEventListener('click', disconnectWallet);
walletApi.on('register', refreshWallets);
refreshWallets();
