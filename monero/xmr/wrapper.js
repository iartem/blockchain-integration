const xmr = require('./build/Release/xmr');

/**
 * Thin wrapper class encapsulating returned values transformation, errors processing & lifecycle logic: status, reconnections, periodical refreshes, etc.
 */

const Status = {
	Initial: 		1 << 0,
	Preparing:		1 << 1,
	Ready: 			1 << 2,
	Error: 			1 << 3
};

class XMRError extends Error {
	constructor(message) {
		super(message);
		this.name = 'XMRError';
	}
}

class Tx {
	constructor(sender, priority=1, mixins=4, unlock=0) {
		this.sender = sender;
		this.priority = priority;
		this.mixins = mixins;
		this.unlock = unlock;
		this.destinations = [];
	}

	addDestination(amount, address) {
		this.destinations.push({amount: '' + amount, address: address});
		return this;
	}
}

var log;

/**
 * Thin wrapper class encapsulating values transformation, errors processing & lifecycle logic: status, reconnections, periodical refreshes, etc.
 */
class XMRWrapper extends xmr.XMR {
	constructor(CFG, logger) {
		super(CFG.testnet, CFG.node, false);
		this.CFG = CFG;
		this.status = Status.Initial;
		this.balance = {
			balance: -1,
			unlocked: -1
		};
		log = logger;
	}

	/**
	 * Just create random wallet
	 * @return object with wallet data, should never fail
	 */
	createPaperWallet (lang) {
		let data = this.retry(super.createPaperWallet.bind(this, lang || 'English'), 'Cannot create wallet', 1); 
		if (data.length === 4) {
			return {
				spend: data[0],
				view: data[1],
				address: data[2],
				mnemonics: data[3]
			};
		} else {
			return data;
		}
	}

	/**
	 * Open offline wallet from spend key. Parses spendKey and does in-memory initialization of required structures.
	 *
	 * @throws {XMRError} If spendKey is invalid
	 * @param  {String} spendKey Monero spend key
	 * @return {Promise} which resolves to undefiend if succeeded and error if not
	 */
	async initFromSpendKey (spendKey) {
		await this.retry(super.openPaperWallet.bind(this, spendKey), 'Cannot open wallet using spendKey', 1);
		this.status = Status.Ready;
	}

	/**
	 * Initializes view wallet: opens from files if they exist or creates new ones if they don't.
	 * Then connects to the node.
	 * Then syncs blockchain, this can take a while. Updates {@link height} property when syncing.
	 * Then requests balance and returns.
	 *
	 * All the sequence is retried 3 times in a row in case of error.
	 *
	 * @throws {XMRError} [in promise] if cannot connect after 10 attempts each 3 seconds
	 * @throws {XMRError} [in promise] if retry failed after 3 attempts
	 * @throws {XMRError} [in promise] if failed to get balance
	 * @return {Promise} resolves to cuurent balance (String) or error if something is wrong
	 */
	initFromViewKey () {
		return this.backoff(async () => {
			log.info('Opening wallet');
			this.openViewWallet(this.CFG.monero.address, this.CFG.monero.viewKey);

			log.debug('Preparing connection');
			if (!this.connect()) {
				log.warn('Cannot connect to node');
				throw new XMRError('Cannot connect to node');
			}

			log.debug('Checking connection');
			if (!this.connected()) {
				log.warn('Not connected to node');
				throw new XMRError('Not connected to node');
			}

			log.debug('Refreshing');
			if (!this.refresh_and_store()) {
				log.warn('Cannot sync blockckain');
				throw new XMRError('Cannot sync blockckain');
			}

			log.debug('Requesting balance');
			this.balance = super.balances();
			if (!this.balance || this.balance.balance < 0) {
				log.warn('Cannot request balance');
				throw new XMRError('Cannot request balance');
			}

			this.status = Status.Ready;

			return this.balance;
		}, attempt => attempt >= 3 ? -1 : Math.pow(2, attempt + 1));
	}

	/**
	 * Initializes view wallet in offline mode. Neither uses, nor stores any files. Doesn't connect to node. 
	 *
	 * @throws {XMRError}	if failed to open wallet
	 * @return {undefined}	in case of success
	 */
	initOfflineFromViewKey () {
		try {
			this.openViewWalletOffline(this.CFG.monero.address, this.CFG.monero.viewKey);
			this.status = Status.Ready;
		} catch (e) {
			throw new XMRError(e.message || 'Cannot initialize wallet from viewKey');
		}
	}

	createIntegratedAddress (paymentId) {
		let address = super.createIntegratedAddress(paymentId);
		if (!address) {
			throw new XMRError('Wrong paymentId: must be 8-byte long hex sting');
		}
		return address;
	}

	addressDecode (addressString) {
		let [address, paymentId] = super.addressDecode(addressString);
		if (address) {
			return {
				address: address,
				paymentId: paymentId
			};
		}
	}

	createUnsignedTransaction (tx) {
		if (!(tx instanceof Tx)) {
			throw new XMRError('createUnsignedTransaction argument must be Tx instance');
		}

		if (tx.priority && (tx.priority > 4 || tx.priority < 1)) {
			throw new XMRError('Invalid priority');
		}

		log.debug(`Creating transaction ${JSON.stringify(tx)}`);

		let result = super.createUnsignedTransaction(tx, true);
		log.debug(`Creating transaction returned ${Object.keys(result)}`);
		if (result.error) {
			if (result.outputs) {
				log.warn(`Silently ignoring ${result.error} and returning outputs in ${result.outputs.length}b instead`);
			} else {
				log.error(`Cannot even export outputs: ${result.error}`);
				throw new XMRError(result.error);
			}
		} else if (result.unsigned) {
			log.info(`Created transaction in ${result.unsigned.length}b`);
		}
		return result;
	}

	signTransaction (data) {
		if (typeof data !== 'string') {
			throw new XMRError('signTransaction argument must be a string');
		}

		let result = super.signTransaction(data);
		log.debug(`Sign transaction returned ${Object.keys(result)}`);
		if (result.error) {
			if (result.keyImages) {
				log.warn(`Silently ignoring ${result.error} and returning key images in ${result.keyImages.length}b instead`);
			} else {
				log.error(`Cannot even export key images: ${result.error}`);
				throw new XMRError(result.error);
			}
		} else if (result.signed) {
			log.info(`Signed transaction in ${result.signed.length}b`);
		}
		return result;
	}

	submitSignedTransaction (data) {
		if (typeof data !== 'string') {
			throw new XMRError('submitSignedTransaction argument must be a string');
		}

		let result = super.submitSignedTransaction(data);
		log.debug(`Submit transaction returned ${Object.keys(result)}`);
		if (result.error) {
			if (result.outputs) {
				log.warn(`Silently ignoring ${result.error} and returning outputs in ${result.outputs.length}b instead`);
			} else if (result.status) {
				log.warn(`Silently ignoring ${result.error} because just imported key images: ${result.status}`);
			} else {
				log.error(`Cannot even export outputs: ${result.error}`);
				throw new XMRError(result.error);
			}
		} else if (result.info) {
			log.info(`Submitted transaction ${result.info.id}`);
		}
		return result;
	}

	refresh () {
		try {
			return super.refresh();
		} catch (e) {
			throw new XMRError(e.message);
		}
	}

	retry (f, error='Cannot perform operation', times=1) {
		var code;
		while (times >= 0) {
			try {
				code = f();
				if (typeof code !== 'number' || code >= 0) {
					return typeof code === 'number' ? undefined : code;
				} else {
					code = error;
				}
			} catch (e) {
				code = e.message || error;
			}
			log.warn(error);
			times--;
		}
		throw new XMRError(code);
	}

	backoff (promise, rule) {
		return new Promise((resolve, reject) => {
			var attempt = (attempts) => {
				promise().then(resolve, err => {
					let wait = rule(attempts);
					if (wait === -1) {
						reject(err);
					} else {
						setTimeout(attempt.bind(null, attempts + 1), wait * 1000);
					}
				});
			};

			attempt(0);
		});
	}
}

module.exports = {
	Tx: Tx,
	XMR: XMRWrapper,
	XMRError: XMRError
};