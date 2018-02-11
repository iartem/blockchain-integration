// Uses standard endpoints, all differences are within Wallet implementation
let init = () => {
	return require('../core/index-api.js')(process.env.SettingsUrl, {
		GET: {
			/**
			 * Overriding standard capabilities endpoint to return {@code areManyOutputsSupported = false}
			 * @return {200 Object}
			 */
			'/api/capabilities': ctx => {
				ctx.body = {
					isTransactionsRebuildingSupported: false,
					areManyInputsSupported: true,
					areManyOutputsSupported: false
				};
			},
		},
		
		POST: {
		},

		DELETE: {
		},

		PUT: {
		}
	}, require('./wallet.js'));
};

module.exports = init();
module.exports.reset = init;
