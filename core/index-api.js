const crypto = require('crypto');

var CFG, SRV, log, ValidationError, Wallet, syncRequired;

/**
 * Tx construction method for all 3 cases
 * 
 * @param  {Ctx} ctx 	Koa context
 * @param  {Boolean} multipleInputs 	tx will have multiple inputs
 * @param  {Boolean} multipleOutputs	tx will have multiple outputs
 *
 * @throws {ValidationError} 	if supplied in request body parameters are invalid
 * @return {Tx}		tx object
 */
let createTx = async (ctx, multipleInputs, multipleOutputs) => {
	ctx.validateParam('wallet').check(SRV.wallet && SRV.wallet.status === Wallet.Status.Ready, 'Wallet is not ready yet, please try again later');
	ctx.validateBody('operationId').required('is required').isString('must be a string');
	ctx.validateBody('assetId').required('is required').isString('must be a string').eq(CFG.assetId, 'must be equal to "' + CFG.assetId + '"');

	let tx = new Wallet.Tx();
	tx.opid = ctx.vals.operationId;
	if (multipleInputs) {
		ctx.validateBody('toAddress').required('is required').isValidChainAddress();
		ctx.validateBody('inputs').required('is required').isArray('must be an array').isValidInputsList();

		if (ctx.vals.toAddress !== SRV.wallet.address()) {
			throw new ValidationError('toAddress', 'Only wallet-targeted transactions with multiple inputs supported');
		}

		log.info(`Constructing multiple inputs tx for ${ctx.vals.operationId}`);

		let to = SRV.Wallet.addressDecode(ctx.vals.toAddress);

		ctx.vals.inputs.forEach(input => {
			let from = SRV.Wallet.addressDecode(input.fromAddress);
			tx.addPayment(from.address, to.address, CFG.assetOpKey, input.amount, from.paymentId, to.paymentId);
		});

	} else if (multipleOutputs) {
		ctx.validateBody('fromAddress').required('is required').isValidChainAddress();
		ctx.validateBody('outputs').required('is required').isArray('must be an array').isValidOutputsList();

		if (ctx.vals.fromAddress !== SRV.wallet.address()) {
			throw new ValidationError('fromAddress', 'Only wallet-originated transactions with multiple outputs supported');
		}

		log.info(`Constructing multiple outputs tx for ${ctx.vals.operationId}`);
	
		let from = SRV.Wallet.addressDecode(ctx.vals.fromAddress);

		ctx.vals.outputs.forEach(output => {
			let to = SRV.Wallet.addressDecode(output.toAddress);
			tx.addPayment(from.address, to.address, CFG.assetOpKey, output.amount, from.paymentId, to.paymentId);
		});
	} else {
		ctx.validateBody('fromAddress').required('is required').isValidChainAddress();
		ctx.validateBody('toAddress').required('is required').isValidChainAddress();
		ctx.validateBody('amount').required('is required').toInt('must be an integer').gt(0, 'is too small');
		ctx.validateBody('includeFee').required('is required').isBoolean();
		
		if (SRV.Wallet.addressDecode(ctx.vals.fromAddress).address !== SRV.wallet.address()) {
			throw new ValidationError('fromAddress', 'Only wallet-originated transactions supported');
		}

		if (ctx.vals.includeFee) {
			throw new ValidationError('includeFee', 'Only added fees supported');
		}

		log.info(`Constructing 1-to-1 tx for ${ctx.vals.operationId}`);

		let from = SRV.Wallet.addressDecode(ctx.vals.fromAddress),
			to = SRV.Wallet.addressDecode(ctx.vals.toAddress);

		tx.addPayment(from.address, to.address, CFG.assetOpKey, ctx.vals.amount, from.paymentId, to.paymentId);
	}

	if (tx.operations.filter(op => op.amount <= 0).length) {
		throw new ValidationError('amountIsTooSmall', 'Amount must be greater than 0');
	}

	if ('txPriority' in CFG) {
		tx.priority = parseInt(CFG.txPriority);
	}

	if ('txUnlock' in CFG) {
		tx.unlock = parseInt(CFG.txUnlock);
	}

	if (tx.dwhw) {
		let dwhw = tx.operations.filter(o => !!o.sourcePaymentId);

		// find all balances to check amount & whether they're being observed at all
		let balances = await ctx.store.accountFind({paymentId: {$in: dwhw.map(s => s.sourcePaymentId)}}, {balance: 1, paymentId: 1});

		// not observed check
		if (!balances || balances.length !== dwhw.length) {
			throw new ValidationError('operations', 'addresses not observed: ' + JSON.stringify(dwhw.map(i => i.sourcePaymentId).filter(pid => balances.filter(b => b.paymentId === pid).length === 0).join(', ')));
		}

		// not enough amount check
		var error;
		balances.forEach(b => {
			let amount = dwhw.filter(s => s.sourcePaymentId === b.paymentId)[0].amount;
			if (amount > b.balance) {
				error = new ValidationError('notEnoughBalance', 'Amount for ' + b._id + ' is greater than address balance');
			}
		});

		if (error) {
			return error;
		}
	}

	return tx;
};


/**
 * Tx processing method: just save tx for DW => HW case, create tx using wallet otherwise.
 * Also handles Monero resync of key images if needed.
 * 
 * @param  {Ctx} ctx 	Koa context
 * @param  {Tx} tx 	transaction to process
 *
 * @throws {Wallet.Error} 	if supplied tx is invalid, connectivity errors to node, db issues, etc.
 * @return {Object}		response body object
 */
let processTx = async (ctx, tx) => {
	var ret, bounces, bouncingTxs;

	if (tx instanceof ValidationError) {
		if (tx.bouncer.key === 'notEnoughBalance' || tx.bouncer.key === 'amountIsTooSmall') {
			return {
				errorCode: tx.bouncer.key
			};
		} else {
			throw tx;
		}
	}

	// DW => HW
	if (tx.dwhw) {
		log.debug(`DWHW case for ${tx._id}`);
		ret = {
			transactionContext: Wallet.Errors.NOPE_TX
		};
	} else if (!syncRequired) {
		log.debug(`Sync not required for ${tx._id}`);

		if (CFG.bounce) {
			bouncingTxs = await SRV.store.txFind({bounced: false});
			let existingBounces, existingAddresses;
			if (bouncingTxs.length) {
				log.info(`Going to bounce ${bouncingTxs.length} transactions: ${bouncingTxs.map(tx => tx.hash).join(',')}`);
				bouncingTxs = bouncingTxs.map(Wallet.Tx.fromJSON);

				// generate unique source tags to prevent inifite bounces
				do {
					bounces = bouncingTxs.map(tx => {
						let bounce = new Wallet.Tx();
						bounce.bounce = crypto.randomBytes(4).readUInt32BE(0, true);
						tx.bounced = bounce.bounce;
						tx.operations.forEach(op => {
							bounce.addPayment(op.to, op.from, op.asset, op.amount, bounce.bounce, op.sourcePaymentId);
						});
						return bounce;
					});

					existingBounces = await SRV.store.txFind({bounce: {$in: bounces.map(b => b.bounce)}});
					existingAddresses = await SRV.store.accountFind({paymentId: {$in: bounces.map(b => b.bounce)}});

					existingBounces = existingBounces ? existingBounces.length : 0 || 0;
					existingAddresses = existingAddresses ? existingAddresses.length : 0 || 0;

				} while (existingBounces > 0 || existingAddresses > 0);

				// create bounce txses
				await Promise.all(bounces.map(async b => {
					let json = b.toJSON();
					await SRV.store.txCreate(json);
					b._id = json._id;
				}));

				// update bounced to reflect bounce tx is created
				await Promise.all(bouncingTxs.map(t => SRV.store.tx(t._id, {bounced: t.bounced}, false)));
			}
		}
	
		// sync not required, creating tx
		let result = await SRV.wallet.createUnsignedTransaction(tx, bounces);

		if (result.tx) {
			tx.operations.forEach(o => {
				let x = result.tx.operations.filter(xo => o.eq(xo))[0];
				if (x) {
					if (x.id) { o.id = x.id; }
					if (x.fee) { o.fee = x.fee; }
				}
			});
		}

		// sync is required, get outputs
		if (result.error && result.error.type === Wallet.Errors.SYNC_REQUIRED) {
			log.warn('Sync of wallets required');
			result = SRV.wallet.constructFullSyncData();

			if (result.error) {
				throw result.error;
			}

			syncRequired = false;

			ret = {
				transactionContext: result.outputs
			};
		} else if (result.error) {
			log.warn(result.error, `Error when creating tx ${tx._id}`);
			if (bounces) {
				await SRV.store.tx({_id: {$in: bouncingTxs.map(b => b._id)}}, {bounced: false});
				await Promise.all(bounces.map(b => SRV.store.txDelete(b._id)));
			}
			// other errors
			if (result.error.type === Wallet.Errors.NOT_ENOUGH_FUNDS || result.error.type === Wallet.Errors.NOT_ENOUGH_AMOUNT) {
				return {
					errorCode: result.error.type === Wallet.Errors.NOT_ENOUGH_FUNDS ? 'notEnoughBalance' : 'amountIsTooSmall'
				};
			} else {
				throw result.error;
			}
		} else {
			// no errors, returning constructed tx
			log.debug(`Created tx ${tx._id}`);
			if (bounces) {
				try {
					await Promise.all(bounces.map(b => SRV.store.tx(b._id, b.toJSON(), false)));
				} catch (e) {
					log.warn(e, `Error when updating bounced txs operations after construction`);
				}
			}
			ret = {
				transactionContext: result.unsigned
			};
		}
	} else {
		log.debug(`Syncing for tx ${tx._id}`);
		// sync required
		let result = SRV.wallet.constructFullSyncData();

		if (result.error) {
			throw result.error;
		}
		
		syncRequired = false;

		ret = {
			transactionContext: result.outputs
		};
	}

	let json = tx.toJSON();
	// json.observing = true;

	// by default we create new object, but according to requirements it's possible to reuse the same operationId
	// thus we clear-up existing object and overwrite it with newly constructed one, resetting hash
	let created = await ctx.store.txCreate(json);
	if (!created) {
		let existing = await ctx.store.tx({opid: json.opid});
		if (existing) {
			delete json._id;
			json.hash = null;
			log.warn(`Updating existing tx ${JSON.stringify(existing)} with new data instead of creating new tx: ${JSON.stringify(json)}`);
			let updated = await ctx.store.tx(existing._id, json, false);
			if (updated) {
				return ret;
			}
		}
		throw new Wallet.Error(Wallet.Errors.DB, 'failed to create transaction');
	}

	return ret;
};

/**
 * Find tx for all 3 cases
 * 
 * @param  {Ctx} ctx 	Koa context
 * @return {Object} 	response body
 */
let findTx = async (ctx) => {
	ctx.validateParam('wallet').check(SRV.wallet && SRV.wallet.status === Wallet.Status.Ready, 'Wallet is not ready yet, please try again later');
	ctx.validateParam('operationId').required('is required').isString('must be a string');

	let tx = await ctx.store.tx({opid: ctx.vals.operationId, observing: true, bounce: {$exists: false}});

	if (tx && tx.status !== Wallet.Tx.Status.Initial) {
		log.info(`Found tx ${ctx.vals.operationId}`);
		tx = Wallet.Tx.fromJSON(tx);
		
		let status = 'inProgress';
		
		if (!tx.status || tx.status === Wallet.Tx.Status.Failed) {
			status = 'failed';
		} else if (tx.status === Wallet.Tx.Status.Locked) {
			status = 'inProgress';
		} else if (tx.status === Wallet.Tx.Status.Completed) {
			status = 'completed';
		}

		ctx.body = {
			operationId: ctx.vals.operationId,
			state: status,
			timestamp: tx.timestamp || undefined,
			amount: '' + tx.amount,
			fee: (tx.fees || 0) + '',
			hash: tx.hash,
			error: tx.error || undefined
		};
		
		if (tx.error) {
			ctx.body.errorCode = 'unknown';
		}
	} else {
		log.warn(`Didn't find tx ${ctx.vals.operationId}`);
		log.debug(`Found ${tx}`);
		ctx.status = 204;
	}
};


/**
 * Callback from blockchain called on new transactions or status updates
 * 
 * @param  {Tx} info transaction instance
 */
let onTxCallback = async info => {
	// async callback, thus capturing all errors
	try {
		log.info(`new tx hash ${info.hash}`);
		log.debug(`new tx info: ${info}`);

		// shouldn't happen
		if (info.status === Wallet.Tx.Status.Initial || info.status === Wallet.Tx.Status.Sent) {
			return;
		}

		// just failing tx out
		if (info.status === Wallet.Tx.Status.Failed) {
			return await SRV.store.tx({hash: info.hash}, {status: info.status}, false);
		}

		// just update status if it exists
		if (info.status === Wallet.Tx.Status.Locked) {
			return await SRV.store.tx({hash: info.hash}, {status: info.status}, false);
		}

		if (info.incoming) {

			let created = await SRV.store.txCreate(info.toJSON()), tx;
			if (created) {
				tx = info;
			} else {
				log.info(`Already processed tx hash ${info.hash}`);
				return;
			}

			if (CFG.bounce && tx.operations.filter(op => !op.paymentId && op.to === SRV.wallet.address()).length) {
				// mark tx as bounce-required
				let updated = await SRV.store.tx(created._id, {bounced: false}, false);
				if (!updated) {
					log.warn(`New bounce required for ${JSON.stringify(created)}, but failed to update db`);
				}
			} else {
				// processing only operaions with paymentId, that is identifiable cash-ins
				let ops = tx.operations.filter(op => op.paymentId && op.to === SRV.wallet.address()),
					// updating account balances
					updates = await Promise.all(ops.map(op => SRV.store.account({paymentId: op.paymentId}, {$inc: {balance: op.amount}, $set: {block: info.block}}, false)));

				updates.forEach((upd, i) => {
					let op = ops[i];
					if (upd) {
						log.info(`New cash-in to ${op.to} / ${op.paymentId} (${SRV.wallet.addressCreate(op.paymentId)}) for ${op.amount} ${op.asset}`);
					} else {
						log.warn(`Didn't increment ${op.to} / ${op.paymentId} (${SRV.wallet.addressCreate(op.paymentId)}) for ${op.amount} ${op.asset} - no such account observed`);
						if (CFG.bounce && CFG.bounce !== op.paymentId) {
							log.warn(`New bounce required for ${JSON.stringify(created)}`);
							if (ops.length === 1) {
								log.warn(`Marking tx as bounce-required ${JSON.stringify(created)}`);
								SRV.store.tx(created._id, {bounced: false}, false);
							}
						}
					}
				});
			}

		} else {
			// update tx status
			let updated = await SRV.store.tx(
					{hash: info.hash, status: Wallet.Tx.Status.Sent}, 
					{status: Wallet.Tx.Status.Completed, timestamp: info.timestamp, block: info.block || undefined, page: info.page},
					false, true
				), tx;

			if (updated) {
				log.debug(`Updated tx hash ${info.hash} with completed status`);
				tx = info.toJSON();
				// now complete transaction by incrementing corresponding account balances
				// let updates = tx.operations.map(op => SRV.store.account({paymentId: op.paymentId}, {$inc: {balance: -op.amount}}));
			} else {
				log.debug(`Already updated tx hash ${info.hash} with completed status`);
				tx = await SRV.store.tx({hash: info.hash});

				if (!tx) {
					log.warn(`No transaction with hash ${info.hash} found, storing for history`);
					await SRV.store.txCreate(info.toJSON());
					tx = info;
					if (!tx) {
						log.error(`Failed to create outgoing tx hash ${info.hash}`);
					}
					return;
				}
			}

			let update = {};

			tx = Wallet.Tx.fromJSON(tx);

			// for each operaion we haven't processed yet go and set fees & ids
			info.operations.forEach(op => {
				let index = -1;
				tx.operations.forEach((ex, i) => {
					if (!ex.id && ex.eq(op)) { index = i; }
				});

				if (index !== -1) {
					if (op.fee) {
						update[`operations.${index}.fee`] = op.fee;
					}
					if (op.id) {
						update[`operations.${index}.id`] = op.id;
					}
				}
			});

			if (Object.keys(update).length) {
				updated = await SRV.store.tx({hash: info.hash}, update, false);
				if (!updated) {
					log.warn(`Failed to update tx hash ${info.hash} with operations: ${JSON.stringify(update)}`);
				}
			}
		}
	} catch (e) {
		log.error(e, 'Error in tx callback');
	}	
};

/**
 * Some deffault routes for API service implemented according to one wallet scheme.
 * @type {Object}
 */
let API_ROUTES = {
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
				isDebug: CFG.testnet,
				contractVersion: '1.1.0'
			};
		},

		/**
		 * Standard isalive endpoint
		 * @return {200 Object}
		 */
		'/api/capabilities': ctx => {
			ctx.body = {
				isTransactionsRebuildingSupported: false,
				areManyInputsSupported: true,
				areManyOutputsSupported: !!Wallet.MANY_OUTPUTS,
				isTestingTransfersSupported: true,
				isPublicAddressExtensionRequired: !!Wallet.SEPARATOR
			};
		},

		/**
		 * Standard constants endpoint
		 * @return {200 Object}
		 */
		'/api/constants': ctx => {
			if (Wallet.SEPARATOR) {
				ctx.body = {
					publicAddressExtension: {
						separator: Wallet.SEPARATOR,
						displayName: Wallet.EXTENSION_NAME
					}
				};
			} else {
				throw new ValidationError('publicAddressExtension', 'Not applicable for blockchains without address extensions');
			}
		},

		/**
		 * Returns single assetId - not applicable.
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
					accuracy: CFG.assetAccuracy,
				};
			}
		},

		/**
		 * Returns single assetId - not applicable.
		 * @return {200 Object}
		 */
		'/api/assets': ctx => {
			ctx.validateQuery('take').required('is required').toInt('must be a number').gt(0).lt(1000);
			ctx.validateQuery('continuation').optional().isString('must be a string');

			if (ctx.vals.continuation) {
				throw new ValidationError('continuation', 'is invalid');
			} else {
				ctx.body = {
					continuation: null,
					items: [{
						assetId: CFG.assetId,
						address: '',
						name: CFG.assetName,
						accuracy: CFG.assetAccuracy
					}]
				};
			}
		},

		/**
		 * Parses address string using cryptonote and returnes whether parsing succeeded or not
		 * @return {200 Object}
		 */
		'/api/addresses/:address/validity': ctx => {
			ctx.validateParam('address').required('is required').isString('must be a string');
			
			let decoded = SRV.Wallet.addressDecode(ctx.vals.address);

			log.info(`Address ${ctx.vals.address} is ${decoded ? 'valid' : 'invalid'}`);
			
			ctx.body = {
				isValid: !!decoded
			};
		},

		/**
		/**
		 * Returns balances of addresses greater than 0.
		 * 
		 * @param  {Integer} query.take	maximum number or rows to return
		 * @param  {Integer} query.continuation	skip rows
		 * @return {200 Object}
		 */
		'/api/balances': async ctx => {
			ctx.validateParam('wallet').check(SRV.wallet && SRV.wallet.status === Wallet.Status.Ready, 'Wallet is not ready yet, please try again later');
			ctx.validateQuery('take').required('is required').toInt('must be a number').gt(0, 'must be greater than 0').lt(1000, 'must be less than 1000');
			ctx.validateQuery('continuation').optional().toInt('must be an int-in-string').gt(0, 'must be greater than 0');

			let offset = ctx.vals.continuation || 0,
				limit = ctx.vals.take;

			let data = await ctx.store.accountFind({balance: {$gt: 0}}, {}, offset, limit, {_id: 1}),
				balances = data.map(o => {
					return {address: o._id, assetId: CFG.assetId, balance: '' + o.balance, block: o.block ? '' + o.block : undefined};
				});

			offset = data.length === limit ? '' + (offset + limit) : null;

			log.info(`Found ${balances.length} for take ${ctx.vals.take} & continuation ${ctx.vals.continuation}; next continuation ${offset}`);

			ctx.body = {
				continuation: offset,
				items: balances
			};
		},

		/**
		 * Returns broadcasted transaction data by operationId.
		 * 
		 * @return {200 Object}	if transaction exists and has been already broadcasted 
		 * @return {204}	otherwise
		 */
		'/api/transactions/broadcast/single/:operationId': findTx,
		'/api/transactions/broadcast/many-inputs/:operationId': findTx,
		'/api/transactions/broadcast/many-outputs/:operationId': findTx,

		/**
		 * Returns history of outgoing transactions from the address specified
		 * 
		 * @return {200 Array}	of transactions
		 */
		'/api/transactions/history/from/:address': async ctx => {
			ctx.validateParam('wallet').check(SRV.wallet && SRV.wallet.status === Wallet.Status.Ready, 'Wallet is not ready yet, please try again later');
			ctx.validateParam('address').required('is required').isValidChainAddress();
			ctx.validateQuery('take').required('is required').toInt('must be a number').gt(0, 'must be greater than 0').lt(1000, 'must be less than 1000');
			ctx.validateQuery('afterHash').optional().isString('must be a string');
			ctx.validateQuery('bounces').optional().toBoolean('must be a boolean string');

			let parts = SRV.Wallet.addressDecode(ctx.params.address);
			let query = {status: Wallet.Tx.Status.Completed, bounce: {$exists: false}, bounced: {$exists: false}}, query2 = {};
			if (ctx.vals.bounces) {
				delete query.bounce;
				delete query.bounced;
			}
			if (parts.paymentId) {
				query['operations.from'] = parts.address;
				query['operations.sourcePaymentId'] = parts.paymentId;
				query2['sourcePaymentId'] = parts.paymentId;
			} else {
				query['operations.from'] = parts.address;
				query2['from'] = parts.address;
			}
			if (ctx.vals.afterHash) {
				let prev = await ctx.store.tx({hash: ctx.vals.afterHash});
				if (!prev) {
					throw new ValidationError('afterHash', 'No transaction with such hash found in history');
				}
				query.timestamp = {$gt: prev.timestamp};
			}

			let data = await ctx.store.txHistory(query, query2, ctx.vals.take);
			ctx.body = data.map(tx => {
				return {
					operationId: tx.opid || '',
					timestamp: new Date(tx.timestamp).toISOString(),
					fromAddress: ctx.vals.address,
					toAddress: SRV.Wallet.addressEncode(tx.to, tx.paymentId),
					assetId: CFG.assetId,
					amount: '' + tx.amount,
					hash: tx.hash,
					bounce: ctx.vals.bounces ? tx.bounce : undefined,
					bounced: ctx.vals.bounces ? tx.bounced : undefined
				};
			});
		},

		'/api/transactions/history/to/:address': async ctx => {
			ctx.validateParam('wallet').check(SRV.wallet && SRV.wallet.status === Wallet.Status.Ready, 'Wallet is not ready yet, please try again later');
			ctx.validateParam('address').required('is required').isValidChainAddress();
			ctx.validateQuery('take').required('is required').toInt('must be a number').gt(0, 'must be greater than 0').lt(1000, 'must be less than 1000');
			ctx.validateQuery('afterHash').optional().isString('must be a string');
			ctx.validateQuery('bounces').optional().toBoolean('must be a boolean string');

			let parts = SRV.Wallet.addressDecode(ctx.params.address);
			let query = {status: Wallet.Tx.Status.Completed, bounce: {$exists: false}, bounced: {$exists: false}}, query2 = {};
			if (ctx.vals.bounces) {
				delete query.bounce;
				delete query.bounced;
			}
			if (parts.paymentId) {
				query['operations.to'] = parts.address;
				query['operations.paymentId'] = parts.paymentId;
				query2['paymentId'] = parts.paymentId;
			} else {
				query['operations.to'] = parts.address;
				query2['to'] = parts.address;
			}
			if (ctx.vals.afterHash) {
				let prev = await ctx.store.tx({hash: ctx.vals.afterHash});
				if (!prev) {
					throw new ValidationError('afterHash', 'No transaction with such hash found in history');
				}
				query.timestamp = {$gt: prev.timestamp};
			}

			let data = await ctx.store.txHistory(query, query2, ctx.vals.take);
			ctx.body = data.map(tx => {
				return {
					operationId: tx.opid || '',
					timestamp: new Date(tx.timestamp).toISOString(),
					fromAddress: SRV.Wallet.addressEncode(tx.from, tx.sourcePaymentId),
					toAddress: ctx.vals.address,
					assetId: CFG.assetId,
					amount: '' + tx.amount,
					hash: tx.hash,
					bounce: ctx.vals.bounces ? tx.bounce : undefined,
					bounced: ctx.vals.bounces ? tx.bounced : undefined
				};
			});
		}
	},
	
	POST: {
		/**
		 * Initializing wallet without env & settings. Initialization can only be done once.
		 * If needed preferences exist in settings and env, this endpoint returns 400.
		 * Until wallet is initialized, wallet-related endpoints return 503.
		 * 
		 * @return {200} on success
		 * @return {400} when already initialized or wrong parameters sent
		 */
		'/api/initialize': async ctx => {
			if (SRV.wallet) {
				throw new ValidationError('api', 'Already initialized, remove related keys from json settings & env to use this endpoint');
			}

			ctx.validateBody('WalletAddress').required('is required').isString('must be a string');
			if (Wallet.VIEWKEY_NEEDED) {
				ctx.validateBody('WalletViewKey').required('is required').isString('must be a string');
			}

			SRV.resetWallet(ctx.vals.WalletAddress, ctx.vals.WalletViewKey);

			await SRV.utils.wait(2000);

			ctx.status = 200;
		},

		/**
		 * Starts observation of balance of a particular address.
		 * 
		 * @return {200}	if started observing
		 * @return {409}	if already observing
		 */
		'/api/balances/:address/observation': async ctx => {
			ctx.validateParam('wallet').check(SRV.wallet && SRV.wallet.status === Wallet.Status.Ready, 'Wallet is not ready yet, please try again later');
			ctx.validateParam('address').required('is required').isValidChainAddress();

			let addr = SRV.Wallet.addressDecode(ctx.params.address);

			if (addr.address !== SRV.wallet.address()) {
				throw new ValidationError('address', 'Only wallet address & subaddresses supported');
			}

			let set = await ctx.store.accountCreate({_id: ctx.params.address, paymentId: addr.paymentId, balance: 0});

			if (set) {
				log.info(`Started observing ${ctx.vals.address}`);
				ctx.status = 200;
			} else {
				log.warn(`Didn't start observing address ${ctx.vals.address}`);
				ctx.status = 409;
			}
		},

		/**
		 * Create unsigned 1-to-1 transaction
		 * 
		 * @return {200}	if succeeded
		 */
		'/api/transactions/single': async ctx => {
			// validate request body, construct Tx object from request & perform some consistency validation
			let tx = await createTx(ctx, false, false);

			// call wallet for tx data or resync data if needed
			ctx.body = await processTx(ctx, tx);
		},

		/**
		 * Create unsigned transaction with multiple inputs
		 * 
		 * @return {200}	if succeeded
		 */
		'/api/transactions/many-inputs': async ctx => {
			// validate request body, construct Tx object from request & perform some consistency validation
			let tx = await createTx(ctx, true, false);

			// call wallet for tx data or resync data if needed
			ctx.body = await processTx(ctx, tx);
		},

		/**
		 * Create unsigned transaction with multiple inputs
		 * 
		 * @return {200}	if succeeded
		 */
		'/api/transactions/many-outputs': async ctx => {
			// validate request body, construct Tx object from request & perform some consistency validation
			let tx = await createTx(ctx, false, true);

			// call wallet for tx data or resync data if needed
			ctx.body = await processTx(ctx, tx);
		},

		/**
		 * Broadcast given transaction to the blockchain. Only updates balances for transactions between DW & HW,
		 * since there's no need in such transactions in this implementation.
		 * 
		 * @return {200}	if succeeded
		 * @return {409}	if transaction has been already broadcasted
		 * @return {204}	if no such transaction was cretated using POST /api/transactions
		 */
		'/api/transactions/broadcast': async ctx => {
			ctx.validateParam('wallet').check(SRV.wallet && SRV.wallet.status === Wallet.Status.Ready, 'Wallet is not ready yet, please try again later');
			ctx.validateBody('operationId').required('is required').isString('must be a string');
			ctx.validateBody('signedTransaction').required('is required').isString('must be a string');

			let tx = await ctx.store.tx({opid: ctx.vals.operationId});
			if (!tx) {
				log.warn(`Won't broadcast tx ${ctx.vals.operationId} - no such tx`);
				ctx.status = 204;
			} else if (tx.status === Wallet.Tx.Status.Initial) {
				tx = Wallet.Tx.fromJSON(tx);

				if (tx.dwhw) {
					log.info(`Skipping broadcasting tx ${ctx.vals.operationId} - DW => HW`);

					// update balances
					let updates = await Promise.all(tx.operations.map(op => ctx.store.account({paymentId: op.sourcePaymentId}, {$inc: {balance: -op.amount}}, false)));

					if (updates.length !== updates.reduce((a, b) => a + b)) {
						throw new Wallet.Error(Wallet.Errors.DB, `failed to inc balances: ${tx.operations.map(op => op.from + ' / ' + op.sourcePaymentId + ' to -' + op.amount).filter((s, i) => !updates[i]).join(', ')}`);
					}

					// mark tx as completed right away
					await ctx.store.tx(tx._id, {hash: '' + Date.now(), status: Wallet.Tx.Status.Completed, timestamp: Date.now(), observing: true}, false);
					log.info(`Successfully completed tx ${ctx.vals.operationId}`);
				} else {
					// common cash-out
					let result = await SRV.wallet.submitSignedTransaction(ctx.request.body.signedTransaction),
						bounces;

					bounces = typeof result === 'object' && result.length ? result.slice(1) : [];
					result = typeof result === 'object' && result.length ? result[0] : result;

					// next time we need to do full sync of wallets
					if (result.error && result.error.type === Wallet.Errors.SYNC_REQUIRED) {
						log.warn('Sync of wallets required');
						syncRequired = true;
					}

					if (result.hash) {
						// got a hash = tx has been submitted to blockchain
						let update = {hash: result.hash, status: Wallet.Tx.Status.Sent, observing: true};
						update.timestamp = result.timestamp || Date.now();
						if (result.page) {
							update.page = result.page;
						}
						if (result.block) {
							update.block = result.block;
						}
						if (await ctx.store.tx(tx._id, update, false)) {
							log.info(`Successfully submitted tx ${ctx.vals.operationId}`);
						} else {
							log.error(`Couldn't update tx ${ctx.vals.operationId} with update status, please restart server for tx to update it's status: ${result}`);
						}
					} else if (result.error) {
						// error when submitting
						log.warn(result.error, `Error submitting tx ${ctx.vals.operationId}`);

						// special types of errors
						if (result.error.type === Wallet.Errors.NOT_ENOUGH_FUNDS || result.error.type === Wallet.Errors.NOT_ENOUGH_AMOUNT) {
							await ctx.store.tx(tx._id, {
								error: result.error.type === Wallet.Errors.NOT_ENOUGH_FUNDS ? 'notEnoughBalance' : 'amountIsTooSmall', 
								status: Wallet.Tx.Status.Failed, 
								timestamp: Date.now(), 
								observing: true
							}, false);

							ctx.body = {
								errorCode: result.error.type === Wallet.Errors.NOT_ENOUGH_FUNDS ? 'notEnoughBalance' : 'amountIsTooSmall' 
							};
						} else {
							// all other errors
							await ctx.store.tx(tx._id, {error: result.error.message, status: Wallet.Tx.Status.Failed, timestamp: Date.now(), observing: true}, false);
							throw result.error;
						}
					} else if (result.status) {
						ctx.status = 499;
						ctx.body = {
							errorCode: 'unknown',
							errorMessage: result.error || 'Please retry transaction later'
						};
					} else {
						throw new Wallet.Error(Wallet.Errors.EXCEPTION, 'neither hash, nor error returned by submitSignedTransaction');
					}

					if (bounces.length) {
						let errors = bounces.filter(b => !!b.error).map(b => b.error.message || b.error.code || b.error);

						if (errors.length) {
							log.error(`Errors during bounces submission: ${JSON.stringify(errors.join(', '))}`);
						}

						try {
							await Promise.all(bounces.map(b => {
								if (!b._id) {
									return Promise.resolve();
								}
								let update = {timestamp: b.timestamp || Date.now()};
								if (b.page) {
									update.page = b.page;
								}
								if (b.block) {
									update.block = b.block;
								}
								if (b.error) {
									update.error = b.error;
									update.status = Wallet.Tx.Status.Failed;
									update.error = b.error.message || 'Unknown bounce error';
								} else {
									update.hash = b.hash;
									update.status = Wallet.Tx.Status.Sent;
									update.observing = true;
								}
								return SRV.store.tx({_id: SRV.store.oid(b._id)}, update, false);
							}));
						} catch (e) {
							log.error(e, 'Errors during bounces saving');
						}
					}
				}

				ctx.status = 200;
				ctx.body = ctx.body || {};
			} else {
				ctx.status = 409;
			}
		},

		/**
		 * Start observing history of transactions from this address.
		 * This implementation only supports wallet address, therefore does nothing.
		 * 
		 * @return {200}	always
		 */
		'/api/transactions/history/from/:address/observation': ctx => {
			ctx.status = 200;
		},

		/**
		 * Start observing history of transactions to this address.
		 * This implementation only supports wallet address, therefore does nothing.
		 * 
		 * @return {200}	always
		 */
		'/api/transactions/history/to/:address/observation': ctx => {
			ctx.status = 200;
		},

		/**
		 * Endpoint used in tests to fill test wallets with some coins.
		 * Stellar & Ripple also support creating test wallets (Monero doesn't). 
		 * Leave fromAddress, toAddress & amount empty in order to create test wallet, it will be returned in response:
		 * {address: '', seed: '', balance: 123}.
		 * 
		 * @return {200}     in case of success
		 */
		'/api/testing/transfers': async ctx => {
			if (ctx.request.body && ctx.request.body.fromAddress && ctx.request.body.toAddress) {
				ctx.validateBody('fromAddress').required('is required').isValidChainAddress();
				ctx.validateBody('fromPrivateKey').required('is required').isString('must be a string');
				ctx.validateBody('toViewKey').optional().isString('must be a string');
				ctx.validateBody('assetId').required('is required').isString('must be a string').eq(CFG.assetId, 'must be equal to "' + CFG.assetId + '"');

				let lg = SRV.log('testwallet'),
					txes = {},
					createWallet = () => new Wallet(CFG.testnet, CFG.node, SRV.log('testwallet'), (tx) => {
						txes[tx.hash] = tx;
						lg.debug(`got tx ${JSON.stringify(tx)}`);
					}, 10000);

				let view, sign;
				try {
					view = createWallet();
					sign = createWallet();

					let amount = Array.isArray(ctx.request.body.amount) ? ctx.request.body.amount : [ctx.request.body.amount],
						address = Array.isArray(ctx.request.body.toAddress) ? ctx.request.body.toAddress : [ctx.request.body.toAddress],
						fr = SRV.Wallet.addressDecode(ctx.vals.fromAddress);

					await view.initViewWallet(fr.address);
					await sign.initSignWallet(fr.address, ctx.vals.fromPrivateKey);

					let gogogo = async tx => {
						let unsigned = await view.createUnsignedTransaction(tx);
						if (unsigned.error) {
							log.error(`Error during tx creation: ${JSON.stringify(unsigned.error)}`);
							throw unsigned.error;
						}
						log.info(`Created tx: ${JSON.stringify(unsigned)}`);

						let signed = sign.signTransaction(unsigned.unsigned);
						if (signed.error) {
							log.error(`Error during tx signing: ${JSON.stringify(signed.error)}`);
							throw signed.error;
						}
						log.info(`Signed tx: ${JSON.stringify(signed)}`);

						let sent = await view.submitSignedTransaction(signed.signed);
						if (sent.error) {
							log.error(`Error during tx sending: ${JSON.stringify(sent.error)}`);
							throw sent.error;
						}
						log.info(`Sent tx: ${JSON.stringify(sent)}`);

						return sent;
					};

					let results = [];
					if (Wallet.MANY_OUTPUTS) {
						let tx = new Wallet.Tx('someid', 1, 0);
						address.forEach((addr, i) => {
							let to = SRV.Wallet.addressDecode(addr);
							tx.addPayment(fr.address, to.address, CFG.assetOpKey, amount[i], fr.paymentId, to.paymentId);
						});

						let res = await gogogo(tx);
						results.push(res.hash);
					} else {
						results = await SRV.utils.promiseSerial(address.map((addr, i) => {
							return () => {
								let tx = new Wallet.Tx('someid', 1, 0),
									to = SRV.Wallet.addressDecode(addr);
								
								tx.addPayment(fr.address, to.address, CFG.assetOpKey, amount[i], fr.paymentId, to.paymentId);

								return gogogo(tx);
							};
						}));

						results = results.map(r => r.hash);

						await SRV.utils.wait(3000);
					}

					let start = Date.now(),
						waiting = results.slice();

					while (Date.now() - start < (CFG.socketTimeout || 600000)) {
						waiting = waiting.filter(hash => !txes[hash] || (txes[hash].status !== Wallet.Tx.Status.Completed && txes[hash].status !== Wallet.Tx.Status.Failed));
						if (waiting.length === 0) {
							break;
						}
						await SRV.utils.wait(10000);
					}

					ctx.body = results.map(hash => txes[hash] || hash);
				} finally {
					try { view.close(); } catch (e) { log.error(e, 'when tried to close test view wallet'); }
					try { sign.close(); } catch (e) { log.error(e, 'when tried to close test sign wallet'); }
				}

			} else {
				if (typeof Wallet.createTestWallet === 'function') {
					ctx.body = await Wallet.createTestWallet();
				} else {
					throw new ValidationError('fromAddress', 'is required');
				}
			}

		}
	},

	DELETE: {
		/**
		 * Stops observation of balance of a particular address.
		 * 
		 * @return {200}	if stopped observing
		 * @return {204}	if no such address is on observe list
		 */
		'/api/balances/:address/observation': async ctx => {
			ctx.validateParam('address').required('is required').isValidChainAddress();

			let del = await ctx.store.accountDelete({_id: ctx.params.address});

			if (del) {
				log.info(`Removed address ${ctx.params.address}`);
				ctx.status = 200;
			} else {
				log.warn(`Didn't remove address ${ctx.params.address}`);
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

			let updated = await ctx.store.tx({opid: ctx.params.operationId}, {observing: false}, false);

			if (updated) {
				log.info(`Not observing tx ${ctx.params.operationId}`);
				ctx.status = 200;
			} else {
				log.warn(`Didn't remove tx ${ctx.params.operationId} from observing list`);
				ctx.status = 204;
			}
		},

		/**
		 * Stop observing history of transactions from this address.
		 * This implementation only supports wallet address, therefore does nothing.
		 * 
		 * @return {200}	always
		 */
		'/api/transactions/history/from/:address/observation': ctx => {
			ctx.status = 200;
		},

		/**
		 * Stop observing history of transactions to this address.
		 * This implementation only supports wallet address, therefore does nothing.
		 * 
		 * @return {200}	always
		 */
		'/api/transactions/history/to/:address/observation': ctx => {
			ctx.status = 200;
		},
	},

	PUT: {
		/**
		 * Transaction replacements are not supported
		 * @return {501}
		 */
		'/api/transactions': ctx => {
			ctx.status = 501;
		}
	}
};

const index = (settings, routes, WalletClass) => {
	// merge all endpoints given in `routes` with standard ones
	let merged = {GET: {}, POST: {}, PUT: {}, DELETE: {}},
		putAll = (routes) => {
			Object.keys(routes).forEach(method => {
				Object.keys(routes[method]).forEach(path => {
					merged[method][path] = routes[method][path];
				});
			});
		};

	putAll(API_ROUTES);
	putAll(routes);

	return require('./index.js')(settings, merged).then(async server => {
		// here we already have config & db
		SRV = server;
		CFG = SRV.CFG;
		log = SRV.log('core-api');
		Wallet = SRV.Wallet = WalletClass;

		// find all pending transactions so wallet could refresh their status
		let pending = await SRV.store.txFind({status: {$in: [Wallet.Tx.Status.Initial, Wallet.Tx.Status.Sent, Wallet.Tx.Status.Locked]}}, {hash: 1, status: 1});
		log.info(`${pending.length} pending transactions`);
		log.debug(`pending: ${JSON.stringify(pending)}`);
		
		// this is last transaction known to the server, let wallet skip already known transactions
		let last = await SRV.store.txFind({page: {$exists: true, $ne: null}}, {page: 1}, 0, 1, {timestamp: -1});
		log.info(`Last tx ${last.length && last[0].page}`);

		// view wallet initialization
		SRV.resetWallet = (address, view) => {
			SRV.wallet = new Wallet(CFG.testnet, CFG.node, SRV.log('view-wallet'), onTxCallback, CFG.refreshEach, pending, last.length && last[0].page);
			return SRV.wallet.initViewWallet(address || process.env.WalletAddress || CFG.WalletAddress, view || process.env.WalletViewKey || CFG.WalletViewKey);
		};
		if ((CFG.WalletAddress && (!Wallet.VIEWKEY_NEEDED || CFG.WalletViewKey)) ||
			(process.env.WalletAddress && (!Wallet.VIEWKEY_NEEDED || process.env.WalletViewKey))) {
			SRV.resetWallet();
		}

		// graceful shutdown
		let _close = SRV.close.bind(SRV);
		SRV.close = async () => {
			if (SRV.wallet) {
				await SRV.wallet.close();
				SRV.wallet = null;
			}
			await _close();
		};

		// standard validation methods
		ValidationError = SRV.ValidationError;
		SRV.Validator.addMethod('isValidChainAddress', function () {
			this.checkPred(val => !!SRV.Wallet.addressDecode(val), `must be valid ${CFG.chain} address`);
			return this;
		});

		SRV.Validator.addMethod('isValidInputsList', function () {
			this.checkPred(arr => !arr.filter(input => !input.fromAddress || !SRV.Wallet.addressDecode(input.fromAddress)).length, 'must have valid addresses');
			this.checkPred(arr => !arr.filter(input => !(typeof input.amount === 'string') || (parseInt(input.amount) + '') !== input.amount).length, 'must have valid amounts');
			return this;
		});

		SRV.Validator.addMethod('isValidOutputsList', function () {
			this.checkPred(arr => !arr.filter(output => !output.toAddress || !SRV.Wallet.addressDecode(output.toAddress)).length, 'must have valid addresses');
			this.checkPred(arr => !arr.filter(output => !(typeof output.amount === 'string') || (parseInt(output.amount) + '') !== output.amount).length, 'must have valid amounts');
			return this;
		});

		return SRV;
	});
};

module.exports = index;