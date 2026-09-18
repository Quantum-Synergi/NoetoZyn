// node_modules/@wallet-standard/app/lib/esm/wallets.js
var __classPrivateFieldGet = function(receiver, state2, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state2 === "function" ? receiver !== state2 || !f : !state2.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state2.get(receiver);
};
var __classPrivateFieldSet = function(receiver, state2, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state2 === "function" ? receiver !== state2 || !f : !state2.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state2.set(receiver, value), value;
};
var _AppReadyEvent_detail;
var wallets = void 0;
var registeredWalletsSet = /* @__PURE__ */ new Set();
function addRegisteredWallet(wallet) {
  cachedWalletsArray = void 0;
  registeredWalletsSet.add(wallet);
}
function removeRegisteredWallet(wallet) {
  cachedWalletsArray = void 0;
  registeredWalletsSet.delete(wallet);
}
var listeners = {};
function getWallets() {
  if (wallets)
    return wallets;
  wallets = Object.freeze({ register, get, on });
  if (typeof window === "undefined")
    return wallets;
  const api = Object.freeze({ register });
  try {
    window.addEventListener("wallet-standard:register-wallet", ({ detail: callback }) => callback(api));
  } catch (error) {
    console.error("wallet-standard:register-wallet event listener could not be added\n", error);
  }
  try {
    window.dispatchEvent(new AppReadyEvent(api));
  } catch (error) {
    console.error("wallet-standard:app-ready event could not be dispatched\n", error);
  }
  return wallets;
}
function register(...wallets2) {
  wallets2 = wallets2.filter((wallet) => !registeredWalletsSet.has(wallet));
  if (!wallets2.length)
    return () => {
    };
  wallets2.forEach((wallet) => addRegisteredWallet(wallet));
  listeners["register"]?.forEach((listener) => guard(() => listener(...wallets2)));
  return function unregister() {
    wallets2.forEach((wallet) => removeRegisteredWallet(wallet));
    listeners["unregister"]?.forEach((listener) => guard(() => listener(...wallets2)));
  };
}
var cachedWalletsArray;
function get() {
  if (!cachedWalletsArray) {
    cachedWalletsArray = [...registeredWalletsSet];
  }
  return cachedWalletsArray;
}
function on(event, listener) {
  listeners[event]?.push(listener) || (listeners[event] = [listener]);
  return function off() {
    listeners[event] = listeners[event]?.filter((existingListener) => listener !== existingListener);
  };
}
function guard(callback) {
  try {
    callback();
  } catch (error) {
    console.error(error);
  }
}
var AppReadyEvent = class extends Event {
  get detail() {
    return __classPrivateFieldGet(this, _AppReadyEvent_detail, "f");
  }
  get type() {
    return "wallet-standard:app-ready";
  }
  constructor(api) {
    super("wallet-standard:app-ready", {
      bubbles: false,
      cancelable: false,
      composed: false
    });
    _AppReadyEvent_detail.set(this, void 0);
    __classPrivateFieldSet(this, _AppReadyEvent_detail, api, "f");
  }
  /** @deprecated */
  preventDefault() {
    throw new Error("preventDefault cannot be called");
  }
  /** @deprecated */
  stopImmediatePropagation() {
    throw new Error("stopImmediatePropagation cannot be called");
  }
  /** @deprecated */
  stopPropagation() {
    throw new Error("stopPropagation cannot be called");
  }
};
_AppReadyEvent_detail = /* @__PURE__ */ new WeakMap();

// src/wallet-connect.js
var walletApi = getWallets();
var state = {
  wallets: [],
  connectedWallet: null,
  connectedAccount: null
};
var elements = {
  button: document.getElementById("wallet-button"),
  chooser: document.getElementById("wallet-chooser"),
  state: document.getElementById("wallet-state"),
  connected: document.getElementById("wallet-connected"),
  name: document.getElementById("wallet-name"),
  address: document.getElementById("wallet-address"),
  copy: document.getElementById("copy-address"),
  disconnect: document.getElementById("disconnect-wallet")
};
function setStatus(message, kind = "muted") {
  elements.state.textContent = message;
  elements.state.className = `muted ${kind}`;
}
function compatibleWallets() {
  return walletApi.get().filter((wallet) => typeof wallet.features?.["standard:connect"]?.connect === "function");
}
function renderChooser() {
  elements.chooser.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a detected wallet";
  elements.chooser.append(placeholder);
  state.wallets.forEach((wallet, index) => {
    const option = document.createElement("option");
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
  setStatus("Identity only \u2014 no signing enabled.", "success");
}
function clearConnected(message = "Disconnected from this dashboard.") {
  state.connectedWallet = null;
  state.connectedAccount = null;
  elements.connected.hidden = true;
  elements.button.hidden = false;
  elements.chooser.value = "";
  elements.chooser.hidden = true;
  setStatus(message);
}
async function connectWallet(wallet) {
  setStatus(`Connecting to ${wallet.name}...`);
  try {
    const result = await wallet.features["standard:connect"].connect();
    const account = result?.accounts?.[0] || wallet.accounts?.[0];
    if (!account?.address) {
      setStatus("The selected wallet returned no account.", "error");
      return;
    }
    showConnected(wallet, account);
  } catch (error) {
    const message = error?.message?.toLowerCase().includes("reject") || error?.message?.toLowerCase().includes("cancel") ? "Wallet connection was cancelled." : "Wallet connection failed.";
    setStatus(message, "error");
  }
}
async function disconnectWallet() {
  const disconnect = state.connectedWallet?.features?.["standard:disconnect"]?.disconnect;
  try {
    if (typeof disconnect === "function") await disconnect();
  } catch {
    clearConnected("Disconnected from this dashboard.");
    return;
  }
  clearConnected();
}
async function copyAddress() {
  const address = state.connectedAccount?.address;
  if (!address) return;
  if (!navigator.clipboard?.writeText) {
    setStatus("Clipboard unavailable; copy the address manually.", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(address);
    setStatus("Full wallet address copied.", "success");
  } catch {
    setStatus("Clipboard access was unavailable; copy the address manually.", "error");
  }
}
elements.button.addEventListener("click", () => {
  refreshWallets();
  if (!state.wallets.length) {
    setStatus("No compatible Wallet Standard wallet detected.", "error");
    return;
  }
  setStatus("Select a detected wallet to continue.");
  elements.chooser.hidden = false;
  elements.chooser.focus();
});
elements.chooser.addEventListener("change", () => {
  const wallet = state.wallets[Number(elements.chooser.value)];
  if (wallet) connectWallet(wallet);
});
elements.copy.addEventListener("click", copyAddress);
elements.disconnect.addEventListener("click", disconnectWallet);
walletApi.on("register", refreshWallets);
refreshWallets();
