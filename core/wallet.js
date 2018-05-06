
const WalletStatus = {
	Initial: 'initial',
	Loading: 'loading',
	Ready: 'ready',
	Error: 'error',
};

const WalletErrors = {
	EXCEPTION: 'Exception: ',
	VALIDATION: 'Validation error: ',
	DB: 'DB: ',
	CONNECTION: 'Cannot connect to node: ',
	NOT_ENOUGH_FUNDS: 'Not enough funds',
	NOT_ENOUGH_OUTPUTS: 'Not enough outputs',
	NOT_ENOUGH_AMOUNT: 'Amount is too low',
	SYNC_REQUIRED: 'Syncronization of view & spend wallets required: ',
	RETRY_REQUIRED: 'Retry of transaction required: ',

	NOPE_TX: 'nope'
};

/**
 * Wallet contract class
 */
class Wallet {
	/**
	 * Wallet constructor
	 * 
	 * @param  {Logger} log  logger to use
	 * @param  {function} onTx on new tx / on tx update callback
	 * @return {[type]}      [description]
	 */
	constructor(testnet, node, log, onTx, refreshEach=60000) {
		this.testnet = testnet;
		this.node = node;
		this.log = log;
		this.onTx = onTx;
		this.refreshEach = refreshEach;
		this.status = WalletStatus.Initial;
		this.height = 0;
		this.balance = {
			balance: -1,
			unlocked: -1
		};
	}

	/**
	 * Initialize wallet as view wallet: connect to node, refresh blockchain
	 *
	 * @return {Promise} 	resolves when done refreshing, fails with error if unable to initialize
	 */
	async initViewWallet(/* address, viewKey */) {
		throw new Error('Not implemented');
	}

	/**
	 * Initialize wallet as spend wallet: check & set keys
	 *
	 * @return {Promise} 	resolves when done initializing, fails with error if unable to initialize
	 */
	async initSignWallet(/* address, spendKey */) {
		throw new Error('Not implemented');
	}

	/**
	 * Graceful shutdown
	 */
	async close () {
		throw new Error('Not implemented');
	}

	/**
	 * Return current wallet address
	 *
	 * @return {String} 	address string
	 */
	address() {
		throw new Error('Not implemented');
	}

	/**
	 * Returns current balance.
	 * 
	 * @return {Promise} which resolves to int balance
	 */
	currentBalance() {
		throw new Error('Not implemented');
	}

	/**
	 * Returns current block number.
	 * 
	 * @return {Promise} which resolves to int balance
	 */
	currentBlock() {
		throw new Error('Not implemented');
	}

	/**
	 * Decode address from string. 
	 *
	 * @param {String} str 	address string
	 * @return {Object} 	of {address: 'addr', paymentId: 'pid'} kind if succeeded
	 * @return undeifned 	if argument is not a vaild address
	 */
	static addressDecode(/* str, testnet */) {
		throw new Error('Not implemented');
	}

	/**
	 * Encode address to string. 
	 *
	 * @param {String} address 	address string
	 * @param {String} paymentId 	paymentId string
	 * @return {String} 	of address encoded with paymentId in blockchain-specific format
	 */
	static addressEncode(/* address, paymentId, testnet */) {
		throw new Error('Not implemented');
	}

	/**
	 * Create random user address
	 *
	 * @return {String} 	string which represents user address
	 */
	addressCreate() {
		throw new Error('Not implemented');
	}

	/**
	 * Current block height or other blockchain time thing.
	 *
	 * @throw {Wallet.Error} 	if not connected or cannot get height
	 * @return {Integer} 	current blockchain
	 */
	block () {
		throw new Error('Not implemented');
	}

	/**
	 * Create unsigned transaction & return data as string
	 *
	 * @param {Tx} tx 	transaction to create
	 * @return {Object} 	object of kind {unsigned: 'txdata', error: Wallet.Error, fees: '123'}
	 */
	async createUnsignedTransaction (/* tx */) {
		throw new Error('Not implemented');
	}

	/**
	 * Create full sync data which will go through regular sign - submit path to sync view wallet
	 *
	 * @return {Object} 	object of kind {outputs: 'outputsdata', error: Wallet.Error}
	 */
	constructFullSyncData () {
		throw new Error('Not implemented');
	}

	/**
	 * Sign transaction & return data as string
	 *
	 * @param {String} unsigned 	unsigned tx data to sign
	 * @return {Object} 	object of kind {signed: 'txdata', error: Wallet.Error}
	 */
	signTransaction (/* unsigned */) {
		throw new Error('Not implemented');
	}

	/**
	 * Submit signed transaction
	 *
	 * @param {String} signed 	signed tx data to submit
	 * @return {Promise[Object]} 	object of kind {hash: 'abc123', error: Wallet.Error, fees: '123'}
	 */
	async submitSignedTransaction (/* signed */) {
		throw new Error('Not implemented');
	}

	/**
	 * Get transactions from blockchain, filtered by properties.
	 * 
	 * @param  {String} txid  transaction id to retrieve
	 * @param  {Boolean} in   search incoming transactions
	 * @param  {Boolean} out  search outgoing transactions
	 * @return {Promise[Array]}        array of transaction info objects: {id: 'txid', key: 'tx key if any', payment_id: '', 
	 *                              amount: '', fee: '', timestamp: '', in: bool, state: '', error: '', destinations: [{amount: '', address: ''}]}
	 */
	async transactions (/* txid, in, out */) {
		throw new Error('Not implemented');
	}

	/**
	 * Utility method to execute some function several times synchronously before failing
	 * 
	 * @param  {function} f     function to call, must return negative number in case of error
	 * @param  {String} error 	Error description when afiled
	 * @param  {Number} times	how much times to retry before failing
	 */
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
			this.log.warn(error);
			times--;
		}
		throw new WalletError(WalletErrors.EXCEPTION, code);
	}

	/**
	 * Utility method to execute some function several times with exponential backoff delays before failing
	 * 
	 * @param  {function} promise   function to call, must return promise
	 * @param  {function} rule		rule function of int attempts that returns int of seconds to wait until next attempts or negative number if done trying
	 * @param  {Number} times	how much times to retry before failing
	 */
	backoff (promise, rule) {
		return new Promise((resolve, reject) => {
			var attempt = (attempts) => {
				promise().then(resolve, err => {
					this.log.debug(`Error in attempt ${err.message || JSON.stringify(err)}`);
					let wait = rule(attempts);
					if (wait === -1) {
						this.log.error(err, 'Error in attempt');
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

/**
 * Standard error class for all blockchain-specific errors. Has {@code type} attribute which must contain value from {@link WalletErrors}.
 */
class WalletError extends Error {
	constructor(type, what) {
		if (Object.values(WalletErrors).indexOf(type) === -1) {
			throw new Error(`Invalid error: ${type}, ${what}`);
		}
		super(type + (what || ''));
		this.type = type;
		this.what = what;
		this.name = 'WalletError';
		this.message = type + (what || '');
	}
	
	toString() {
		return `${this.name}: ${this.message}`;
	}
}

/**
 * Just a contract class for address to keep field names
 */
class Account {
	constructor (id) {
		this._id = id;
		this.paymentId = null;
		this.balance = 0;
		this.observed = false;
	}
}

Account.fromJSON = (data) => {
	let a = new Account(data._id);
	a.paymentId = data.paymentId || 0;
	a.balance = data.balance || 0;
	a.observed = data.observed || false;
	return a;
};

Wallet.Status = WalletStatus;
Wallet.Error = WalletError;
Wallet.Errors = WalletErrors;
Wallet.Account = Account;
Wallet.Tx = require('./tx.js');

module.exports = Wallet;