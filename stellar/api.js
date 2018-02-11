// Uses standard endpoints, all differences are within Wallet implementation
let init = () => {
	return require('../core/index-api.js')(process.env.SettingsUrl, {
		GET: {
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
