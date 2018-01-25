const xmr = require('../xmr/wrapper.js');

var CFG, wallet, log, utils, ValidationError;

// redis keys & prefixes
const K = {
	ADDRESS: 'a:',
	BALANCES: 'balances',
	TX: 'tx:',
	REVTX: 'revtx:',
};

// transaction statuses
const S = {
	INITIAL: '0',
	SENT: '1',
	COMPLETED: '2',
	FAILED: '3'
};

// redis transaction hash field names
const TX = {
	STATUS: 'status',
	FROM: 'from',
	TO: 'to',
	AMOUNT: 'amount',
	FEE: 'fee',
	INCLUDE_FEE: 'fee_inc',
	TIMESTAMP: 'timestamp',
	HASH: 'hash',
	ERROR: 'error',
	DWHW: 'dwhw'
};

module.exports = require('../../core/index.js')(process.env.SettingsUrl || (__dirname + '/defaults.json'), {
	GET: {
		/**
		 * Standard isalive endpoint
		 * @return {200 Object}
		 */
		'/api/isalive': ctx => {
			ctx.body = {
				name: CFG.serviceName,
				version: CFG.version,
				env: process.env.ENV_INFO || null,
				isDebug: CFG.testnet
			};
		},

		/**
		 * Returns single assetId - not applicable for Monero.
		 * @return {200 Object}
		 */
		'/api/assets/:assetId': ctx => {
			ctx.validateParam('assetId').required('is required').isString('must be a string');
			if (ctx.vals.assetId !== CFG.assetId) {
				ctx.status = 204;
			} else {
				ctx.body = {
					assetId: CFG.assetId,
					address: '',
					name: CFG.assetName,
					accuracy: 12
				};
			}
		},

		/**
		 * Returns single assetId - not applicable for Monero.
		 * @return {200 Object}
		 */
		'/api/assets': ctx => {
			ctx.validateQuery('take').required('is required').toInt('must be a number').gt(0).lt(1000);
			ctx.validateQuery('continuation').optional().isString('must be a string');

			ctx.body = {
				continuation: null,
				items: [{
					assetId: CFG.assetId,
					address: '',
					name: CFG.assetName,
					accuracy: 12
				}]
			};
		},

		/**
		 * Parses address string using cryptonote and returnes whether parsing succeeded or not
		 * @return {200 Object}
		 */
		'/api/addresses/:address/validity': ctx => {
			ctx.validateParam('address').required('is required').isValidMoneroAddress();
			
			let decoded = wallet.addressDecode(ctx.vals.address);
			
			ctx.body = {
				isValid: !!decoded
			};
		},

		/**
		 * Returns balances of addresses greater than 0.
		 * 
		 * @param  {Integer} query.take	maximum number or rows to return
		 * @param  {Integer} query.continuation	skip rows
		 * @return {200 Object}
		 */
		'/api/balances': async ctx => {
			ctx.validateQuery('take').required('is required').toInt('must be a number').gt(0, 'must be greater than 0').lt(1000, 'must be less than 1000');
			ctx.validateQuery('continuation').optional().toInt('must be a number').gt(0, 'must be greater than 0');

			let offset = ctx.vals.continuation || 0,
				limit = ctx.vals.take;

			// assuming there won't be much non-zero balances, so no need in zscan
			let data = await ctx.store.zrangebyscore(K.BALANCES, '(1', '+inf', 'WITHSCORES', 'LIMIT', offset, limit),
				count = await ctx.store.zcount(K.BALANCES, '(1', '+inf'),
				balances = [];

			// transform data to required form
			data.forEach((v, i) => {
				if (i % 2 === 0) {
					balances.push({address: v, assetId: CFG.assetId, balance: data[i + 1]});
				}
			});

			ctx.body = {
				continuation: count > (offset + limit) ? '' + (offset + limit) : null,
				items: balances
			};
		},

		/**
		 * Returns broadcasted transaction data by operationId.
		 * 
		 * @return {200 Object}	if transaction exists and has been already broadcasted 
		 * @return {204}	otherwise
		 */
		'/api/transactions/broadcast/:operationId': async ctx => {
			ctx.validateParam('operationId').required('is required').isString('must be a string');

			let tx = await ctx.store.hgetall(K.TX + ctx.vals.operationId);
			if (tx && tx[TX.STATUS] !== S.INITIAL) {
				tx[TX.FEE] = '1';
				await ctx.store.hset(K.TX + ctx.vals.operationId, TX.FEE, tx[TX.FEE]);
				ctx.body = {
					operationId: ctx.vals.operationId,
					state: tx[TX.STATUS] === S.ERROR ? 'failed' : tx[TX.STATUS] === S.COMPLETED ? 'completed' : 'inProgress',
					timestamp: new Date(),
					amount: tx[TX.AMOUNT],
					fee: tx[TX.FEE],
					hash: tx[TX.HASH],
					error: tx[TX.ERROR]
				};
			} else {
				ctx.status = 204;
			}
		}
	},
	
	POST: {
		/**
		 * Starts observation of balance of a particular address.
		 * 
		 * @return {200}	if started observing
		 * @return {409}	if already observing
		 */
		'/api/balances/:address/observation': async ctx => {
			ctx.validateParam('address').required('is required').isValidMoneroAddress();

			let set = await ctx.store.zadd(K.BALANCES, 'NX', 0, ctx.params.address);

			if (set) {
				ctx.status = 200;
			} else {
				ctx.status = 409;
			}
		},

		/**
		 * Create new transaction: parse data, validate amounts & fees, return blob to sign by SignService
		 * 
		 * @return {200 Object}	if succeeded
		 * @return {406}	if not enough funds
		 */
		'/api/transactions': async ctx => {
			ctx.validateBody('operationId').required('is required').isString('must be a string');
			ctx.validateBody('fromAddress').required('is required').isValidMoneroAddress();
			ctx.validateBody('toAddress').required('is required').isValidMoneroAddress();
			ctx.validateBody('assetId').required('is required').isString('must be a string').eq(CFG.assetId, 'must be equal to "' + CFG.assetId + '"');
			ctx.validateBody('amount').required('is required').toInt('must be an integer').gt(0, 'is too small');
			ctx.validateBody('includeFee').required('is required').isBoolean();

			let exists = await ctx.store.exists(K.TX + ctx.vals.operationId);
			if (exists) {
				ctx.status = 400;
				ctx.body = {
					errorMessage: 'Transaction with this operationId already exists'
				};
				return;
			}

			if (ctx.vals.amount > 100) {
				ctx.status = 406;
				ctx.body = {
					errorMessage: 'Not enough funds'
				};
				return;
			}

			let from = wallet.addressDecode(ctx.vals.fromAddress),
				to = wallet.addressDecode(ctx.vals.toAddress);

			if (!from) {
				throw new ValidationError('fromAddress', 'not a valid Monero address');
			}

			if (!to) {
				throw new ValidationError('toAddress', 'not a valid Monero address');
			}

			await ctx.store.hmset(K.TX + ctx.vals.operationId, 
				TX.STATUS, S.INITIAL, 
				TX.FROM, ctx.vals.fromAddress, 
				TX.TO, ctx.vals.toAddress, 
				TX.AMOUNT, ctx.vals.amount, 
				TX.INCLUDE_FEE, ctx.request.body.includeFee,
				TX.DWHW, from.address === to.address);

			if (from.address === to.address) {
				ctx.body = {
					transactionContext: 'won\'t run this nice transaction'
				};

			} else {
				wallet.refresh();

				let balances = wallet.balances();

				if (parseInt(balances.unlocked) < ctx.vals.amount) {
					ctx.status = 406;
					ctx.body = {
						errorMessage: 'Not enough funds',
					};
					return;
				}

				let tx = new xmr.Tx(ctx.vals.fromAddress).addDestination(ctx.request.body.amount, ctx.vals.toAddress);
				let data = wallet.createUnsignedTransaction(tx);

				ctx.body = {
					transactionContext: data
				};
			}

			// if (false) {
			// }

			// try {
			// 	let xmr = new XMR();

			// 	// load from viewKey, that allows address generation
			// 	xmr.loadViewKey(CFG.monero.address, CFG.monero.viewKey);

			// 	// sign txData
			// 	let txData = xmr.createTransaction();

			// 	if (txData) {
			// 		ctx.body = {
			// 			transactionContext: txData
			// 		};
			// 	} else {
			// 		ctx.status = 400;
			// 		ctx.body = {
			// 			errorMessage: 'Transaction cannot be created - invalid data provided',
			// 		};
			// 	}
			// } catch (e) {
			// 	if (e instanceof XMR.Error) {
			// 		ctx.status = 400;
			// 		ctx.body = {
			// 			errorMessage: 'Transaction cannot be created - invalid data provided',
			// 			modelErrors: {
			// 				amount: e.message
			// 			}
			// 		};
			// 	} else {
			// 		throw e;
			// 	}
			// }
		},

		/**
		 * Broadcast given transaction to the blockchain. Only updates balances for transactions between DW & HW,
		 * since there's no need in such transactions in Monero.
		 * 
		 * @return {200}	if succeeded
		 * @return {409}	if transaction has been already broadcasted
		 * @return {204}	if no such transaction was cretated using POST /api/transactions
		 */
		'/api/transactions/broadcast': async ctx => {
			ctx.validateBody('operationId').required('is required').isString('must be a string');
			ctx.validateBody('signedTransaction').required('is required').isString('must be a string');

			let tx = await ctx.store.hmget(K.TX + ctx.vals.operationId, TX.STATUS, TX.DWHW, TX.FROM, TX.AMOUNT);

			if (tx === null) {
				ctx.status = 204;
			} else if (tx[0] === S.INITIAL) {
				let [, dwhw, from, amount] = tx;

				if (dwhw === 'true') {
					// DW to HW case 
					await ctx.store.zincrby(K.BALANCES, from, -parseInt(amount));
					await ctx.store.hmset(K.TX + ctx.vals.operationId, TX.STATUS, S.COMPLETED, TX.HASH, '', TX.FEE, 0, TX.TIMESTAMP, Date.now());
				} else {
					// common cash-out
					let info = wallet.submitSignedTransaction(ctx.request.body.signedTransaction);
					await ctx.store.hmset(K.TX + ctx.vals.operationId, TX.STATUS, S.SENT, TX.HASH, info.id, TX.FEE, info.fee, TX.TIMESTAMP, info.timestamp);
					await ctx.store.set(K.REVTX + info.id, ctx.vals.operationId);
				}

				ctx.status = 200;
			} else {
				ctx.status = 409;
			}
		},

	},

	DELETE: {
		/**
		 * Stops observation of balance of a particular address.
		 * 
		 * @return {200}	if stopped observing
		 * @return {204}	if no such address is on observe list
		 */
		'/api/balances/:address/observation': async ctx => {
			ctx.validateParam('address').required('is required').isValidMoneroAddress();

			let del = await ctx.store.zrem(K.BALANCES, ctx.params.address);

			if (del) {
				ctx.status = 200;
			} else {
				ctx.status = 204;
			}
		},

		/**
		 * Removes transaction from broadcast observing list.
		 * 
		 * @return {200}	if stopped observing
		 * @return {204}	if no such transaction is on observe list
		 */
		'/api/transactions/broadcast/:operationId': async ctx => {
			ctx.validateParam('operationId').required('is required').isString('must be a string');

			let hash = await ctx.store.hget(K.TX + ctx.params.operationId, TX.HASH);

			if (hash) {
				await ctx.store.del(K.TX + ctx.params.operationId);
				await ctx.store.del(K.REVTX + hash);
				ctx.status = 200;
			} else {
				ctx.status = 204;
			}
		},
	},

	PUT: {
		/**
		 * Transaction replacements are not supported in Monero
		 * @return {501}
		 */
		'/api/transactions': ctx => {
			ctx.status = 501;
		}
	}
}).then(async srv => {
	CFG = srv.CFG;
	utils = srv.utils;
	log = srv.log('api');

	ValidationError = srv.ValidationError;
	srv.Validator.addMethod('isValidMoneroAddress', function () {
		this.isString('must be a string').trim().match(/^[a-z0-9]+$/i, 'is not valid monero address');
		this.checkPred(val => val.length === 95 || val.length === 106, 'must be of length 95 or 106');
		return this;
	});

	// initialize & refresh view wallet right away
	try {
		wallet = srv.wallet = new xmr.XMR(srv.CFG);
		wallet.initFromViewKey();
	} catch (e) {
		log.error(`Error while opening or refreshing wallet: ${e.message || 'Unknown error'}`);
		throw e;
	}

	// all good, set up periodical refreshing & callbacks
	
	return srv;
});
