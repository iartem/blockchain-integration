var CFG, SRV, log, ValidationError, Wallet, wallet, AD, VK, PK;

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
				isDebug: CFG.testnet
			};
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
			if (wallet) {
				throw new ValidationError('api', 'Already initialized, remove related keys from json settings & env to use this endpoint');
			}

			ctx.validateBody('WalletAddress').required('is required').isString('must be a string');
			ctx.validateBody('WalletPrivateKey').required('is required').isString('must be a string');
			if (Wallet.VIEWKEY_NEEDED) {
				ctx.validateBody('WalletViewKey').required('is required').isString('must be a string');
			}

			await SRV.resetWallet(ctx.vals.WalletAddress, ctx.vals.WalletViewKey, ctx.vals.WalletPrivateKey);

			await SRV.utils.wait(2000);

			ctx.status = 200;
		},

		'/api/wallets': ctx => {
			log.info(`wallet ${typeof wallet}, status ${wallet && wallet.status}`);
			ctx.validateParam('wallet').check(wallet && wallet.status === Wallet.Status.Ready, 'Wallet is not ready yet, please try again later');
			ctx.validateBody('paymentId').optional().isString('must be a string');
			
			let address = wallet.addressCreate(ctx.vals.paymentId || undefined);
			ctx.body = {
				privateKey: PK,
				publicAddress: address
			};
		},

		'/api/sign': async ctx => {
			ctx.validateParam('wallet').check(wallet && wallet.status === Wallet.Status.Ready, 'Wallet is not ready yet, please try again later');
			ctx.validateBody('privateKeys').required('is required').isArray('must be an array').isLength(1, 1, 'must have 1 private key');
			ctx.validateBody('transactionContext').required('is required').isString('must be a string');

			// DW => HW
			if (ctx.vals.transactionContext === Wallet.Errors.NOPE_TX) {
				ctx.body = {
					signedTransaction: Wallet.Errors.NOPE_TX
				};
				return;
			}

			// regular transaction
			// let wallet;
			try {
				// wallet = new Wallet(CFG.testnet, null, SRV.log('sign-wallet'), () => {});
				// await wallet.initSignWallet(AD, ctx.vals.privateKeys[0]);

				let result = wallet.signTransaction(ctx.vals.transactionContext);
				if (result.error) {
					throw result.error;
				}
				if (!result.signed) {
					throw new Wallet.Error(Wallet.Errors.EXCEPTION, 'Wallet returned no signed transaction data');
				}

				ctx.body = {
					signedTransaction: result.signed
				};
			} catch (e) {
				log.error(e, 'Exception in sign wallet');
				if (e instanceof Wallet.Error) {
					throw e;
				}
				throw new Wallet.Error(Wallet.Errors.EXCEPTION, e.message || e.code || 'Unexpected exception in sign wallet');
			// } finally {
			// 	try {
			// 		await wallet.close();
			// 	} catch (e) {
			// 		log.error(e, 'Exception while closing sign wallet');
			// 	}
			}
		}
	},
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

	return require('./index.js')(settings, merged).then(server => {
		// here we already have config, db is not needed for sign service
		SRV = server;
		CFG = SRV.CFG;
		log = SRV.log('core-sign');
		Wallet = WalletClass;
		ValidationError = SRV.ValidationError;

		// initialize dummy wallet for addresses generation
		SRV.resetWallet = (address, view, privat) => {
			log.info('Preparing wallet');
			AD = address || process.env.WalletAddress || CFG.WalletAddress;
			PK = privat || process.env.WalletPrivateKey || CFG.WalletPrivateKey;
			wallet = new Wallet(CFG.testnet, null, SRV.log('sign-wallet'), () => {});
			return wallet.initSignWallet(AD, PK);
		};
		if ((CFG.WalletAddress && CFG.WalletPrivateKey) ||
			(process.env.WalletAddress && process.env.WalletPrivateKey)) {
			SRV.resetWallet();
		}


		// graceful shutdown
		let _close = SRV.close.bind(SRV);
		SRV.close = async () => {
			if (wallet) {
				await wallet.close();
				wallet = null;
			}
			await _close();
		};

		return SRV;
	});
};

module.exports = index;