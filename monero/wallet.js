const xmr = require('./xmr/index.js'),
	Wallet = require('../core/wallet.js');

/**
 * Thin wrapper class over c++ XMR implementation encapsulating values transformation, errors processing & lifecycle logic: status, reconnections, periodical refreshes, etc.
 */
class XMRWallet extends Wallet {
	constructor(testnet, node, logger, onTx, refreshEach, pending) {
		super(testnet, node, logger, onTx, refreshEach);
		this.log = logger;

		// hash of transactions being watched (statuses are updated on each refresh, callback is called each status update)
		this.pending = {};
		(pending || []).forEach(tx => {
			this.pending[tx.hash] = tx.status;
		});

		try {
			this.xmr = new xmr.XMR(testnet, node || '', false);
		} catch (e) {
			this.log.error(e, 'Error in XMR constructor');
			throw new Wallet.Error(Wallet.Errors.EXCEPTION, e.message);
		}
	}

	/**
	 * Initializes view wallet: opens from files if they exist or creates new ones if they don't.
	 * Then connects to the node.
	 * Then syncs blockchain, this can take a while. Updates {@link height} property when syncing.
	 * Then requests balance and returns.
	 *
	 * All the sequence is retried 3 times in a row in case of error.
	 *
	 * @throws {Wallet.Error} [in promise] if cannot connect after 10 attempts each 3 seconds
	 * @throws {Wallet.Error} [in promise] if retry failed after 3 attempts
	 * @throws {Wallet.Error} [in promise] if failed to get balance
	 * @return {Promise} resolves to cuurent balance (String) or error if something is wrong
	 */
	initViewWallet(address, viewKey) {
		return this.backoff(async () => {
			this.log.info(`Loading view wallet for address ${address}`);
			this.xmr.setCallbacks(this._onTx.bind(this), this._onBlock.bind(this));
			this.xmr.openViewWallet(address, viewKey);

			this.log.debug('Preparing connection');
			if (!this.xmr.connect()) {
				this.log.warn('Cannot connect to node');
				throw new Wallet.Error(Wallet.Errors.CONNECTION, 'Cannot connect to node');
			}

			this.log.debug('Checking connection');
			if (!this.xmr.connected()) {
				this.log.warn('Not connected to node');
				throw new Wallet.Error(Wallet.Errors.CONNECTION, 'Not connected to node');
			}

			let current = this.xmr.height();
			this.initialRefresh = true;
			this.log.debug(`Refreshing from height ${this.height} to ${current}`);
			if (!this.xmr.refresh_and_store()) {
				this.log.warn('Cannot sync blockckain');
				throw new Wallet.Error(Wallet.Errors.CONNECTION, 'Cannot sync blockckain');
			}
			this.initialRefresh = false;
			this.log.debug('Refreshed to height ' + this.height);

			this.log.debug('Requesting balance');
			this.balance = this.xmr.balances();
			if (!this.balance || this.balance.balance < 0) {
				this.log.warn('Cannot request balance');
				throw new Wallet.Error(Wallet.Errors.CONNECTION, 'Cannot request balance');
			}

			this.status = Wallet.Status.Ready;

			this.refreshTimeout = setTimeout(this.refresh.bind(this), this.refreshEach);

			this.log.info(`Done loading view wallet for address ${address}`);
			return this.balance;
		}, attempt => attempt >= 3 ? -1 : Math.pow(2, attempt + 1));
	}

	refresh () {
		if (this.refreshing) {
			return;
		}
		this.refreshing = true;
		try {
			clearTimeout(this.refreshTimeout);
			this.refreshTimeout = 0;

			this.log.info(`Refreshing      (${this.height})...`);
			let ok = this.xmr.refresh();
			if (ok) {
				this.balance = this.xmr.balances();
			}
		} catch (e) {
			this.log.error(e, 'Error in refresh');
			throw new Wallet.Error(Wallet.Errors.EXCEPTION, e.message);
		} finally {
			this.refreshTimeout = setTimeout(this.refresh.bind(this), this.refreshEach);
			this.refreshing = false;
			this.log.info(`Refreshing done (${this.height}), ${Object.keys(this.pending).length} pending tx.`);
			Object.keys(this.pending).forEach(hash => {
				this._onTx(this.pending[hash][0], hash);
			});

			if (!this.lastSaved || (Date.now() - this.lastSaved) > 5 * 60000) {
				this.lastSaved = Date.now();
				this.xmr.store();
			}
		}
	}

	/**
	 * Open offline wallet from spend key. Parses seed and does in-memory initialization of required structures.
	 *
	 * @throws {Wallet.Error} If seed is invalid
	 * @param  {String} seed Monero spend key
	 * @return {Promise} which resolves to undefiend if succeeded and error if not
	 */
	initSignWallet (address, seed) {
		try {
			this.log.info(`Loading sign wallet for address ${address}`);
			this.xmr.openPaperWallet(address, seed);
			this.status = Wallet.Status.Ready;
			return Promise.resolve();
		} catch (e) {
			this.log.error(e, 'Error in sign wallet initialization');
			return Promise.reject(new Wallet.Error(Wallet.Errors.EXCEPTION, e.message || e.code || 'Cannot init sign wallet'));
		}
	}

	close () {
		try {
			this.log.info('Closing wallet');
			if (this.refreshTimeout) {
				clearTimeout(this.refreshTimeout);
			}
			return this.xmr.close();
		} catch (e) {
			this.log.error(e, 'Error in wallet close');
			throw new Wallet.Error(Wallet.Errors.EXCEPTION, e.message || e.code || 'Cannot close wallet');
		}
	}

	address() {
		try {
			return this.xmr.address();
		} catch (e) {
			this.log.error(e, 'Error in address retrieval');
			throw new Wallet.Error(Wallet.Errors.EXCEPTION, e.message);
		}
	}

	addressDecode(str) {
		try {
			let [address, paymentId] = this.xmr.addressDecode(str);
			if (address) {
				return {
					address: address,
					paymentId: paymentId
				};
			}
		} catch (e) {
			this.log.error(e, 'Error in address decode');
			throw new Wallet.Error(Wallet.Errors.EXCEPTION, e.message);
		}
	}

	addressEncode(address, paymentId) {
		try {
			if (paymentId) {
				return this.xmr.addressEncode(address, paymentId);
			} else {
				return address;
			}
		} catch (e) {
			this.log.error(e, 'Error in address encode');
			throw new Wallet.Error(Wallet.Errors.EXCEPTION, e.message);
		}
	}

	addressCreate (paymentId) {
		var address;
		try {
			address = this.xmr.createIntegratedAddress(paymentId);
		} catch (e) {
			this.log.error(e, 'Error in address creation');
			throw new Wallet.Error(Wallet.Errors.EXCEPTION, e.message);
		}
		if (!address) {
			throw new Wallet.Error(Wallet.Errors.EXCEPTION, 'Wrong paymentId: must be 8-byte long hex sting');
		}
		this.log.info(`Created new address ${address}`);
		return address;
	}

	async balances () {
		await this.refresh();
		this.log.info(`Balance of ${this.address()} is ${JSON.stringify(this.balance)}`);
		return this.balance;
	}

	async currentBalance () {
		return parseInt((await this.balances()).unlocked);
	}

	async createUnsignedTransaction (tx) {
		if (!(tx instanceof Wallet.Tx)) {
			throw new Wallet.Error(Wallet.Errors.VALIDATION, 'createUnsignedTransaction argument must be Tx instance');
		}

		if (tx.priority !== -1 && (tx.priority > 4 || tx.priority < 1)) {
			throw new Wallet.Error(Wallet.Errors.VALIDATION, 'Invalid priority');
		}

		if (tx.priority === -1) {
			tx.priority = 1;
		}

		if (tx.operations.filter(o => o.amount <= 0).length) {
			return {error: new Wallet.Error(Wallet.Errors.NOT_ENOUGH_AMOUNT, 'Operation amount must be greater than 0')};
		}

		try {
			if ((await this.currentBalance()) < tx.amount) {
				return {error: new Wallet.Error(Wallet.Errors.NOT_ENOUGH_FUNDS)};
			}

			let json = tx.toJSON();
			json.destinations = json.operations.map(op => {
				if (op.paymentId && json.paymentId && op.paymentId !== json.paymentId) {
					throw new Wallet.Error(Wallet.Errors.EXCEPTION, 'Multiple paymentIds in operations');
				} 
				json.paymentId = op.paymentId;
				return ['' + op.amount, op.to];
			});
			delete json.operations;

			// let hasPid = false;
			// json.operations.forEach(op => {
			// 	if (hasPid) {
			// 		throw new Wallet.Error(Wallet.Errors.VALIDATION, 'Cannot have more than 1 paymentId in 1 transaction');
			// 	} else if (op.paymentId) {
			// 		hasPid = true;
			// 		json.
			// 	}
			// });

			this.log.debug(`Creating tx ${tx._id} in ${this.address()}: ${JSON.stringify(json)}`);
			let result = this.xmr.createUnsignedTransaction(json, true);
			this.log.debug(`Transaction creation returned ${Object.keys(result)}`);

			if (result.error) {
				if (result.error in Wallet.Errors) {
					result.error = new Wallet.Error(Wallet.Errors[result.error]);
				} else {
					result.error = new Wallet.Error(Wallet.Errors.EXCEPTION, result.error);
				}
			}
			return result;
		} catch (e) {
			this.log.error(e, 'Error in tx creation');
			throw new Wallet.Error(Wallet.Errors.EXCEPTION, e.message);
		}
	}

	signTransaction (data) {
		if (typeof data !== 'string') {
			throw new Wallet.Error(Wallet.Errors.VALIDATION, 'signTransaction argument must be a string');
		}

		try {
			let result = this.xmr.signTransaction(data);
			this.log.debug(`Transaction signing returned ${Object.keys(result)}`);

			if (result.error) {
				if (result.error in Wallet.Errors) {
					result.error = new Wallet.Error(Wallet.Errors[result.error]);
				} else {
					result.error = new Wallet.Error(Wallet.Errors.EXCEPTION, result.error);
				}
			}
			return result;
		} catch (e) {
			this.log.error(e, 'Error in tx signing');
			throw new Wallet.Error(Wallet.Errors.EXCEPTION, e.message);
		}

	}

	async submitSignedTransaction (data) {
		if (typeof data !== 'string') {
			throw new Wallet.Error(Wallet.Errors.VALIDATION, 'submitSignedTransaction argument must be a string');
		}

		try {
			let result = this.xmr.submitSignedTransaction(data);
			this.log.debug(`Transaction submission returned ${Object.keys(result)}`);

			if (result.info) {
				this.log.debug(`Transaction info: ${JSON.stringify(result.info)}`);
				result.hash = result.info.id;
				result.timestamp = result.info.timestamp;
			}
			if (result.error) {
				if (result.error in Wallet.Errors) {
					result.error = new Wallet.Error(Wallet.Errors[result.error]);
				} else {
					result.error = new Wallet.Error(Wallet.Errors.EXCEPTION, result.error);
				}
			}
			return result;
		} catch (e) {
			this.log.error(e, 'Error in tx submission');
			throw new Wallet.Error(Wallet.Errors.EXCEPTION, e.message);
		}
	}

	async transactions (txid, incoming, outgoing) {
		try {
			return this.xmr.transactions(txid, incoming, outgoing);
		} catch (e) {
			this.log.error(e, 'Error in tx listing');
			throw new Wallet.Error(Wallet.Errors.EXCEPTION, e.message);
		}
	}

	_onTx (incoming, id) {
		try {
			this.log.debug(`_onTx ${incoming} ${id}`);
		
			let info = this.xmr.transactions(id, incoming, !incoming);
			// let tx = this.xmr.transactions(id, incoming, !incoming);

			if (this.initialRefresh) {
				this.log.debug(`_onTx initial refresh, storing for later ${incoming} ${id}`);
				this.pending[id] = [incoming, 'no status'];
				return;
			} else {
				this.log.debug(`In tx callback for ${incoming ? 'incoming' : 'outgoing'} ${id}: ${info.length} txs`);
			}

			this.log.debug(`_onTx ${incoming} ${id} ${JSON.stringify(info)}`);

			if (info.length) {
				info = info[0];

				let status = Wallet.Tx.Status.Initial;

				if (!info.state) {
					status = Wallet.Tx.Status.Initial;
				} else if (info.state === 'pending' || info.state === 'unconfirmed') {
					status = Wallet.Tx.Status.Sent;
				} else if (info.state === 'confirmed') {
					if (info.lock) {
						status = Wallet.Tx.Status.Locked;
					} else {
						status = Wallet.Tx.Status.Completed;
					}
				} else if (info.state === 'failed') {
					status = Wallet.Tx.Status.Failed;
				} else {
					throw new Wallet.Error(Wallet.Errors.EXCEPTION, 'Invalid state of transaction ' + info.state);
				}

				if (info.id in this.pending && status === this.pending[info.id][1]) {
					this.log.debug(`Won't call onTx callback since last call was for this tx ${info.id}`);
				} else {
					this.pending[info.id] = [info.in, status];

					let tx = new Wallet.Tx();
					tx.hash = info.id;
					tx.timestamp = parseInt(info.timestamp) * 1000;
					tx.incoming = info.in;
					tx.error = info.error;
					tx.block = parseInt(info.height);
					tx.status = status;

					if (info.destinations && info.destinations.length) {
						info.destinations.forEach(d => {
							tx.addPayment(tx.incoming ? d.address : this.address(), tx.incoming ? this.address() : d.address, 'monero', parseInt(d.amount), undefined, info.paymentId);
						});

						if (info.fee && parseInt(info.fee)) {
							let total = tx.amount, fees = parseInt(info.fee);
							tx.operations.forEach(op => {
								op.fee = Math.ceil(fees * op.amount / total);
							});
							if (tx.fees !== fees) {
								tx.operations[tx.operations.length - 1].fee += fees - tx.fees;
							}
						}
					} else if (tx.incoming && info.paymentId) {
						let op = tx.addPayment('unknown', this.address(), 'monero', parseInt(info.amount), undefined, info.paymentId);
						if (info.fee && parseInt(info.fee)) {
							op.fee = parseInt(info.fee);
						}
					}

					this.log.debug(`tx ${tx.hash} status ${status}: ${JSON.stringify(tx)}`);

					if (status === Wallet.Tx.Status.Completed) {
						delete this.pending[info.id];
					}

					this.onTx(tx);
				}
			} else {
				// callback, won't throw
				if (!this.initialRefresh) {
					this.log.warn(`Cannot find tx ${id} in ${incoming ? 'incoming' : 'outgoing'} transactions list`);
					if (!this.pending[id][2]) {
						this.pending[id][2] = height;
					}
					if (this.height > this.pending[id][2] + 20) {
						delete this.pending[id];
					}
				}
			}
		} catch (e) {
			// callback, won't throw
			this.log.error(e, `Error in _onTx for tx ${id} in ${incoming ? 'incoming' : 'outgoing'} transactions list`);
		}
	}

	_onBlock (height) {
		if (!this.initialRefresh || height % 1000 === 0) {
			this.log.debug(`In block callback for ${height}`);
		}

		this.height = height;
	}


	/**
	 * Just create random wallet
	 * @return object with wallet data, should never fail
	 */
	createPaperWallet () {
		let data = this.xmr.createPaperWallet('English'); 
		if (data.length === 4) {
			let ret = {
				seed: data[0],
				view: data[1],
				address: data[2],
				mnemonics: data[3]
			};

			// if (fillSourceAddress && fillSourceSpendKey) {
			// 	let seed = new XMRWallet(this.testnet, this.node, log, console.log, 10000);
			// 	await seed.initSignWallet(fillSourceAddress, fillSourceSpendKey);

			// 	seed.connect();
			// 	seed.refresh();

			// 	let tx = new Wallet.Tx('id', 1, 0);
			// 	tx.addPayment(seed.address(), ret.address, 'monero', 100);

			// 	let result = seed.createUnsignedTransaction(tx);
			// 	console.log('fill unsigned', Object.keys(result));
				
			// 	result = seed.signTransaction(result.unsigned);
			// 	console.log('fill signed', Object.keys(result));
				
			// 	result = seed.submitSignedTransaction(result.signed);
			// 	console.log('fill sent', Object.keys(result));

			// 	let wallet = new XMRWallet(this.testnet, this.node, log, console.log, 10000);
			// 	await wallet.initViewWallet(ret.address, ret.view);

			// 	while (true) {
			// 		console.log('created wallet balance', wallet.balance);
			// 		if (wallet.balance.unlocked !== 0) {
			// 			return ret;
			// 		}
			// 		await utils.wait(60000);
			// 	}
			// 	// let seedView = new XMRWallet(this.testnet, this.node, log, console.log, 10000);
			// 	// let seedSpend = new XMRWallet(this.testnet, this.node, log, console.log, 10000);

			// 	// await seedView.initViewWallet(fillSourceAddress, fillSourceViewKey);
			// 	// await seedSpend.initSignWallet(fillSourceAddress, fillSourceSpendKey);

			// 	// let tx = new Wallet.Tx('id', 1, 0);
			// 	// tx.addPayment(seedView.address(), ret.address, 'monero', 100);

			// 	// let result = seedView.createUnsignedTransaction(tx);
			// 	// console.log('fill unsigned', Object.keys(result));
				
			// 	// result = seedSpend.signTransaction(result.unsigned);
			// 	// console.log('fill signed', Object.keys(result));
				
			// 	// result = seedView.submitSignedTransaction(result.signed);
			// 	// console.log('fill sent', Object.keys(result));
			// }
			return ret;
		} else {
			return data;
		}
	}

	/**
	 * Initializes view wallet in offline mode. Neither uses, nor stores any files. Doesn't connect to node. 
	 *
	 * @throws {Wallet.Error}	if failed to open wallet
	 * @return {undefined}	in case of success
	 */
	initViewWalletOffline (address, viewKey) {
		try {
			this.xmr.openViewWalletOffline(address, viewKey);
			this.status = Wallet.Status.Ready;
		} catch (e) {
			this.log.error(e, 'Error in initViewWalletOffline');
			throw new Wallet.Error(Wallet.Errors.EXCEPTION, e.message || 'Cannot initialize wallet from viewKey');
		}
	}

	connect() {
		return this.xmr.connect();
	}
}

XMRWallet.Tx = Wallet.Tx;
XMRWallet.Status = Wallet.Status;
XMRWallet.Error = Wallet.Error;
XMRWallet.Errors = Wallet.Errors;
XMRWallet.Account = Wallet.Account;
XMRWallet.Tx = Wallet.Tx;


module.exports = XMRWallet;
