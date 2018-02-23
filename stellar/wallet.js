const StellarSdk = require('stellar-sdk'),
	Wallet = require('../core/wallet.js'),
	utils = require('../core/utils.js'),
	Big = require('big.js'),
	crypto = require('crypto'),
	SEPARATOR = '+',	// separator for user addresses
	PRECISION = 1e7,
	DECIMALS = 7,
	RESERVE = 1;

class XLMWallet extends Wallet {
	constructor(testnet, node, logger, onTx, refreshEach, pending, page) {
		super(testnet, node, logger, onTx, refreshEach);
		if (testnet) {
			StellarSdk.Network.useTestNetwork();
			StellarSdk.Config.setAllowHttp(true);
		}
		if (node) {
			this.server = new StellarSdk.Server(node);
		}
		this.lastPage = page;
	}

	/**
	 * Initializes view wallet: connects to node, syncs unknown payments & balances.
	 * All the sequence is retried 3 times in a row in case of error.
	 *
	 * @throws {Wallet.Error} [in promise] if cannot connect after 10 attempts each 3 seconds
	 * @throws {Wallet.Error} [in promise] if retry failed after 3 attempts
	 * @throws {Wallet.Error} [in promise] if failed to get balance
	 * @return {Promise} resolves to cuurent balance (String) or error if something is wrong
	 */
	initViewWallet(account) {
		if (!this.server) {
			throw new Wallet.Error(Wallet.Errors.EXCEPTION, 'No node in conig');
		} 
		this.account = account;
		return this.backoff(async () => {
			this.log.info(`Loading view wallet for account ${account}`);
			
			this.balance = await this.balances();

			let payments = this.server.payments().forAccount(account);
			if (this.lastPage) {
				payments.cursor(this.lastPage);
			}

			this.closePaymentStream = payments.stream({
				onmessage: (payment) => {
					// console.log(payment);
					try {
						// skip unsupported operations
						if (['create_account', 'payment'].indexOf(payment.type) === -1) {
							return;
						}

						// skip non-native operations
						if (payment.asset_type !== 'native') {
							return;
						}

						let incoming = payment.source_account !== this.account,
							amount = parseInt(Big(payment.amount || payment.starting_balance).times(PRECISION).toFixed(0)),
							info = new Wallet.Tx();

						try {
							info.block = parseInt(payment.id);
						} catch (ignored) {
							info.block = payment.id;
						}
						info.timestamp = new Date(payment.created_at).getTime();
						info.status = Wallet.Tx.Status.Completed;
						info.hash = payment.transaction_hash;
						info.page = payment.paging_token;
						info.incoming = incoming;

						this.backoff(async () => {
							let tx = await payment.transaction(), op;
							// console.log(tx);

							if (incoming) {
								op = info.addPayment(payment.source_account, this.account, payment.asset_type, amount, undefined, tx.memo);
							} else {
								op = info.addPayment(this.account, payment.to || payment.account, payment.asset_type, amount, tx.memo, undefined);
							}

							op.fee = incoming ? 0 : (tx.fee_paid || 0);
							op.id = info.block;

							if (tx.paging_token) {
								info.page = tx.paging_token;
							}
							
							this.log.info(`New payment in ${this.account}: ${info}`);
							this.onTx(info);

						}, attempt => attempt >= 3 ? -1 : Math.pow(2, attempt + 1)).catch(e => {
							this.log.error(e, `Error while retreiving transaction for payment ${info.id}`);
						});
					} catch (e) {
						this.log.error(e, 'Error during tx info construction');
					}
				},
				onerror: error => {
					this.log.error(error, 'Error when streaming payments');
				}
			});

			this.status = Wallet.Status.Ready;

			this.log.info(`Done loading view wallet for account ${account}`);

			return this.balance;
		}, attempt => attempt >= 3 ? -1 : Math.pow(2, attempt + 1));
	}

	/**
	 * Open offline wallet from seed. Parses seed and stores keypair in a property, must be cleared after use.
	 *
	 * @throws {Wallet.Error} If seed is invalid
	 * @param  {String} seed Monero spend key
	 * @return {Promise} which resolves to undefined if succeeded and error if not
	 */
	initSignWallet (account, seed) {
		try {
			this.log.info(`Loading sign wallet for account ${account}`);
			this.account = account;
			this.keypair = StellarSdk.Keypair.fromSecret(seed);
			this.status = Wallet.Status.Ready;
			return Promise.resolve();
		} catch (e) {
			this.log.error(e, 'Error in sign wallet initialization');
			return Promise.reject(new Wallet.Error(Wallet.Errors.EXCEPTION, e.message || e.code || 'Cannot init sign wallet'));
		}
	}

	close () {
		try {
			this.account = this.keypair = undefined;
			if (this.closePaymentStream) {
				this.closePaymentStream();
				this.closePaymentStream = undefined;
			}
			this.status = Wallet.Status.Initial;
			return utils.wait(2000);
		} catch (e) {
			this.log.error(e, 'Error in wallet close');
			throw new Wallet.Error(Wallet.Errors.EXCEPTION, e.message || e.code || 'Cannot close wallet');
		}
	}

	async balances (account) {
		if (!this.server) {
			throw new Wallet.Error(Wallet.Errors.EXCEPTION, 'No node in conig');
		}
		let acc = account || await this.server.loadAccount(this.account);
		let bal = {};
		acc.balances.forEach(b => {
			bal[b.asset_type] = parseInt(Big(b.balance).times(PRECISION).toFixed(0));
		});
		this.log.info(`Balance of ${this.account} is ${JSON.stringify(bal)}`);
		return bal;
	}

	async currentBalance () {
		return (await this.balances()).native;
	}

	address() {
		return this.account;
	}

	addressDecode(str) {
		if (str) {
			let [address, memo] = str.split(SEPARATOR);
			if (address) {
				try {
					if (StellarSdk.StrKey.isValidEd25519PublicKey(address) && (!memo || memo.length === 28)) {
						return {
							address: address,
							paymentId: memo
						};
					} else {
						return undefined;
					}
				} catch (e) {
					return undefined;
				}
			}
		}
	}

	addressEncode(address, paymentId) {
		if (paymentId) {
			return address + SEPARATOR + paymentId;
		}
		return address;
	}

	addressCreate (paymentId) {
		return this.addressEncode(this.account, paymentId || crypto.randomBytes(14).toString('hex'));
	}

	async createUnsignedTransaction (tx) {
		if (!(tx instanceof Wallet.Tx)) {
			return {error: new Wallet.Error(Wallet.Errors.VALIDATION, 'createUnsignedTransaction argument must be Tx instance')};
		}

		if (!this.server) {
			return {error: new Wallet.Error(Wallet.Errors.EXCEPTION, 'no node in config')};
		}

		try {
			this.log.debug(`Creating tx ${tx._id} in ${this.account}: ${JSON.stringify(tx.toJSON())}`);
			let account = await this.server.loadAccount(this.account);

			// check we have enough funds
			let total = Big(tx.operations.map(o => o.amount).reduce((a, b) => a + b)).div(PRECISION),
				current = Big((await this.balances()).native).div(PRECISION);

			if (tx.operations.filter(o => o.amount <= 0).length) {
				return {error: new Wallet.Error(Wallet.Errors.NOT_ENOUGH_AMOUNT, 'Operation amount must be greater than 0')};
			}

			if (tx.operations.filter(o => o.asset !== 'native').length) {
				return {error: new Wallet.Error(Wallet.Errors.VALIDATION, 'Only \'native\' asset supported by Stellar wallet')};
			}

			if (current.cmp(total.plus(RESERVE)) === -1) {
				this.log.error(`Not enough funds: have ${current.toString()} while requested to transfer ${total.toString()}, yet need a reserve of ${RESERVE}`);
				return {error: new Wallet.Error(Wallet.Errors.NOT_ENOUGH_FUNDS)};
			}


			// check destination accounts exist
			let exists = await Promise.all(tx.operations.map(async o => {
				try {
					await this.server.loadAccount(o.to);
					return 1;
				} catch (ignored) {
					return 0;
				}
			}));

			if (exists.filter((exists, i) => !exists && Big(tx.operations[i].amount).div(PRECISION).cmp(RESERVE) === -1).length) {
				this.log.error(`Minimum tx amount for non-existent accounts is reserve, that is ${RESERVE}`);
				return {error: new Wallet.Error(Wallet.Errors.NOT_ENOUGH_FUNDS)};
			}

			// if (exists.reduce((a, b) => a + b) !== exists.length) {
			// 	return {error: new Wallet.Error(Wallet.Errors.EXCEPTION, 'Operation destination account doesn\'t exist')};
			// }


			let transaction = new StellarSdk.TransactionBuilder(account);
			exists.forEach((exists, i) => {
				let op = tx.operations[i];

				if (exists) {
					transaction.addOperation(StellarSdk.Operation.payment({
						destination: op.to, 
						asset: StellarSdk.Asset.native(), 
						amount: Big(op.amount).div(PRECISION).toFixed(DECIMALS)
					}));
				} else {
					transaction.addOperation(StellarSdk.Operation.createAccount({
						destination: op.to,
						startingBalance: Big(op.amount).div(PRECISION).toFixed(DECIMALS)
					}));
				}
			});

			// tx.operations.forEach(o => {
			// 	transaction.addOperation(StellarSdk.Operation.payment({
			// 		destination: o.to, 
			// 		asset: 'native', 
			// 		amount: Big(o.amount).div(PRECISION).toFixed(DECIMALS)
			// 	}));
			// });

			let memo = tx.operations.length === 1 && tx.operations[0].paymentId;
			if (memo) {
				this.log.info(`Adding memo ${memo}`);
				transaction.addMemo(StellarSdk.Memo.text(memo));
			}

			this.log.debug(`tx ${tx._id} created in ${this.account}`);
			return {unsigned: transaction.build().toEnvelope().toXDR().toString('base64')};
		} catch (e) {
			this.log.error(e, 'Error whhen creating transaction');
			return {error: new Wallet.Error(Wallet.Errors.EXCEPTION, e.message || e.code || 'Cannot create transaction')};
		}
	}

	signTransaction (data) {
		if (typeof data !== 'string') {
			return {error: new Wallet.Error(Wallet.Errors.VALIDATION, 'signTransaction argument must be a string')};
		}

		try {
			this.log.debug(`signing tx in ${this.account}`);
			
			let transaction = new StellarSdk.Transaction(data);
			transaction.sign(this.keypair);

			this.log.debug(`tx signed in ${this.account}`);
			return {signed: transaction.toEnvelope().toXDR().toString('base64')};
		} catch (e) {
			this.log.error(e, 'Error in sign tx');
			return {error: new Wallet.Error(Wallet.Errors.EXCEPTION, e.message || e.code || 'Cannot sign transaction')};
		}

	}

	async submitSignedTransaction (data) {
		if (typeof data !== 'string') {
			return {error: new Wallet.Error(Wallet.Errors.VALIDATION, 'submitSignedTransaction argument must be a string')};
		}

		if (!this.server) {
			return {error: new Wallet.Error(Wallet.Errors.EXCEPTION, 'no node in config')};
		}

		try {
			this.log.debug(`submitting tx in ${this.account}`);
			let transaction = new StellarSdk.Transaction(data);
			let result = await this.server.submitTransaction(transaction);
			this.log.debug(`tx submission returned ${Object.keys(result)}`);
			
			return result;
		} catch (e) {
			this.log.error(e, 'Error when submitting tx');
			if (e.name === 'BadResponseError' && e.data && e.data.extras && e.data.extras.result_codes) {
				if (e.data.extras.result_codes.indexOf('op_underfunded') !== -1) {
					return {error: new Wallet.Error(Wallet.Errors.NOT_ENOUGH_FUNDS)};
				}
				if (e.data.extras.result_codes.indexOf('op_low_reserve') !== -1) {
					return {error: new Wallet.Error(Wallet.Errors.NOT_ENOUGH_AMOUNT)};
				}
			}
			return {error: new Wallet.Error(Wallet.Errors.EXCEPTION, e.message || e.code || 'Cannot submit transaction')};
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

	/**
	 * Just create random wallet
	 * @return object with wallet data, should never fail
	 */
	createPaperWallet () {
		let keypair = StellarSdk.Keypair.random(),
			ret = {
				address: keypair.publicKey(),
				seed: keypair.secret()
			};

		return ret;
	}

	/**
	 * Initializes view wallet in offline mode. Doesn't connect to node. 
	 *
	 * @throws {Wallet.Error}	if failed to open wallet
	 * @return {undefined}	in case of success
	 */
	initViewWalletOffline (address) {
		this.account = address;
		this.status = Wallet.Status.Ready;
	}
}

XLMWallet.Tx = Wallet.Tx;
XLMWallet.Status = Wallet.Status;
XLMWallet.Error = Wallet.Error;
XLMWallet.Errors = Wallet.Errors;
XLMWallet.Account = Wallet.Account;
XLMWallet.Tx = Wallet.Tx;


module.exports = XLMWallet;
