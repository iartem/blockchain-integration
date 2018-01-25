// const XMR = {};
const xmr = require('../xmr/wrapper.js');

var CFG, viewWallet, log;

// init sequence:
// - set up core (load config, start web server)
// - create single view wallet instance
module.exports = require('../../core/index.js')(process.env.SettingsUrl || (__dirname + '/defaults.json'), {
	GET: {
		/**
		 * Standard isalive endpoint
		 * @return {200 Object}     with following keys: spend, view, address, mnemonics
		 */
		'/api/isalive': ctx => {
			ctx.body = {
				// Name of the service
				name: CFG.serviceName,
				// Version of the service
				version: CFG.version,
				// ENV_INFO environment variable value
				env: process.env.ENV_INFO || null,
				// Flag, which indicates if the service is built 
				// in the debug configuration or not
				isDebug: CFG.testnet
			};
		},

		/**
		 * Optional endpoint for wallet generation. Used only for tests, probably useful for Lykke as well.
		 * @return {200 Object}     with following keys: spend, view, address, mnemonics
		 */
		'/api/generate': ctx => {
			ctx.body = viewWallet.createPaperWallet('English');
		}
	},
	
	POST: {
		/**
		 * Creates an integrated address with random payment id (which can optionally be specified as paymentId in request body)
		 * @param  {String} body.paymentId 	paymentId to use in address
		 * @return {200 Object} 	{publicAddress: 'address'}, not supposed to fail
		 */
		'/api/wallets': ctx => {
			ctx.validateBody('paymentId').optional().isString('must be a string');

			// make new address with null payment id = random payment id, 
			// allow optional paymentId parameter to be set in JSON request body
			try {
				// we don't generate privateKey for Monero
				ctx.body = {
					// privateKey: address,
					publicAddress: viewWallet.createIntegratedAddress(ctx.request.body.paymentId || undefined)
				};
			} catch (e) {
				log.warn(`Error when generating address: ${e.message || 'Unknown error'}`)
				ctx.status = 400;
				ctx.body = {
					errorMessage: 'Cannot generate address: ' + (e.message || 'Unknown error'),
					modelErrors: {
						paymentId: 'invalid payment id'
					}
				};
			}
		},

		/**
		 * Sign transaction using first private key in request body.
		 * 
		 * @param  {Array[String]} body.privateKeys 	first key from array is used to sign transaction
		 * @param  {String} body.transactionContext 	unsigned transaction data to sign
		 * @return {200 Object} 	{signedTransaction: 'txSigned'}	with base64-encoded transaction on success
		 * @return {400 ErrorObject} 	if privateKeys array contains more than 1 or 0 keys
		 * @return {400 ErrorObject} 	if private key is invalid
		 * @return {400 ErrorObject} 	if transactionContext is wrong
		 */
		'/api/sign': ctx => {
			ctx.validateBody('privateKeys').required('must be provided').isArray('must be an array').isLength(1, 1, 'must be an array of length 1');
			ctx.validateBody('transactionContext').required('must be provided').isString('must be a string');

			let privateKey = ctx.request.body.privateKeys[0],
				txData = ctx.request.body.transactionContext,
				wallet;

			try {
				wallet = new xmr.XMR(CFG.testnet, '', false);

				// open wallet & check privateKey is correct
				if (!wallet.openPaperWallet(privateKey)) {
					ctx.status = 400;
					ctx.body = {
						errorMessage: 'Cannot open wallet',
						modelErrors: {
							privateKey: 'invalid private key'
						}
					};
					return;
				}

				// // in case destination address equals to the one defined by privateKey, return success
				// // we don't need to process such payments in Monero
				// if (wallet.address() === )

				// sign txData
				let txSigned = wallet.signTransaction(txData);

				if (txSigned) {
					ctx.body = {
						signedTransaction: txSigned
					};
				} else {
					ctx.status = 400;
					ctx.body = {
						errorMessage: 'Transaction cannot be signed - invalid data provided',
						modelErrors: {
							transactionContext: 'invalid data'
						}
					};
				}

			} catch (e) {
				if (e instanceof XMR.Error) {
					ctx.status = 400;
					ctx.body = {
						errorMessage: 'Transaction cannot be signed - invalid data provided',
						modelErrors: {
							transactionContext: e.message || 'invalid data'
						}
					};
				} else {
					// pass 500 through
					throw e;
				}
			} finally {
				if (wallet) {
					wallet.cleanup();
				}
			}
		}
	}
}).then(srv => {
	CFG = srv.CFG;
	log = srv.log('sign');
	// view wallet is the one used for address generation - laoded from address & viewKey
	// load it here once to skip expensive wallet instantiation in address generation
	viewWallet = new xmr.XMR(CFG);
	viewWallet.initOfflineFromViewKey();
	return srv;
});
