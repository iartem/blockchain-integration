var CFG, SRV, log, Wallet, viewWallet;

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
		'/api/wallets': ctx => {
			ctx.check(viewWallet.status === Wallet.Status.Ready, 'Wallet is not ready yet, please try again later');
			ctx.validateBody('paymentId').optional().isString('must be a string');
			
			let address = viewWallet.addressCreate(ctx.vals.paymentId || undefined);
			ctx.body = {
				privateKey: 'nope',
				publicAddress: address
			};
		},

		'/api/sign': async ctx => {
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
			let wallet;
			try {
				wallet = new Wallet(CFG.testnet, null, SRV.log('sign-wallet'), () => {});
				await wallet.initSignWallet(CFG.wallet.address, ctx.vals.privateKeys[0]);

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
			} finally {
				try {
					await wallet.close();
				} catch (e) {
					log.error(e, 'Exception while closing sign wallet');
				}
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

		// initialize dummy wallet for addresses generation
		SRV.resetWallet = () => {
			viewWallet = new Wallet(CFG.testnet, null, SRV.log('view-wallet-offline'), () => {});
			return viewWallet.initViewWalletOffline(CFG.wallet.address, CFG.wallet.view);
		};
		SRV.resetWallet();

		// graceful shutdown
		let _close = SRV.close.bind(SRV);
		SRV.close = async () => {
			if (viewWallet) {
				await viewWallet.close();
			}
			await _close();
		};

		return SRV;
	});
};

module.exports = index;